/**
 * Smoke test: host routes + client bundle registration.
 * Run with: node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/* ---------- client bundle: registers the Settings row ---------- */

let boot
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(entry) {
        boot = entry
      },
    },
  },
  navigator: { language: 'zh-CN' },
  fetch: async () => ({ json: async () => ({ ok: true, widthRatio: 0.5, heightRatio: 0.5 }) }),
  console,
}
vm.runInNewContext(readFileSync(join(root, 'client.js'), 'utf8'), sandbox, { filename: 'client.js' })

assert.equal(boot?.id, 'dsh-window-fit', 'client bundle id must equal the package name')
const hooks = boot.factory((name) => {
  assert.equal(name, 'react', 'only react may be required')
  return {
    createElement: (...args) => ({ args }),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useState: (value) => [value, () => {}],
  }
})
assert.equal(JSON.stringify(hooks.inject), '["slots"]', 'client injects the slots service')

let registered
hooks.apply({
  slots: {
    inject: (_slot, run) => run(),
    register: (options) => {
      registered = options
    },
  },
})
assert.equal(registered?.name, 'settings.general.item')
assert.equal(registered?.id, 'window-fit')
console.log('client: ok — registers settings.general.item as "window-fit"')

/* ---------- host: routes, validation and persistence ---------- */

const { apply, pickRatios, isSameOriginRequest } = await import(pathToFileURL(join(root, 'index.js')).href)

/* "Apply now" must use the values currently in the inputs, not the saved ones. */
assert.deepEqual(
  pickRatios({ widthRatio: 0.6, heightRatio: 0.55 }, { widthRatio: 0.9, heightRatio: 0.9 }),
  { widthRatio: 0.6, heightRatio: 0.55 },
  'apply uses the requested values',
)
assert.deepEqual(
  pickRatios({}, { widthRatio: 0.9, heightRatio: 0.9 }),
  { widthRatio: 0.9, heightRatio: 0.9 },
  'apply falls back to the saved configuration',
)
assert.deepEqual(
  pickRatios({ widthRatio: 5, heightRatio: 0.05 }, { widthRatio: 0.9, heightRatio: 0.9 }),
  { widthRatio: 0.9, heightRatio: 0.9 },
  'out-of-range values fall back instead of being applied',
)
console.log('host: ok — apply picks requested ratios with a saved fallback')

const routes = new Map()
const edits = []
const services = {
  webServer: {
    register: ({ path, handler }) => {
      routes.set(path, handler)
      return () => {}
    },
  },
  configEditor: {
    edit: async (entry, change) => {
      edits.push(change({ widthRatio: 0.7875, heightRatio: 0.8144 }))
    },
  },
}

/** Build a context whose `inject` hands the requested services to a child scope. */
function makeCtx() {
  const ctx = {
    effect: (fn) => fn(),
    get: (name) => services[name],
    inject: (deps, run) => {
      const child = makeCtx()
      for (const name of deps) child[name] = services[name]
      return run(child)
    },
    fiber: { entry: { id: 'window-fit' } },
  }
  return ctx
}

apply(makeCtx(), { widthRatio: 0.7875, heightRatio: 0.8144, timeoutSeconds: 5 })

assert.deepEqual(
  [...routes.keys()].sort(),
  ['/api/window-fit/apply', '/api/window-fit/save', '/api/window-fit/state'],
  'all three routes must be registered',
)

/** Minimal response double that records status and body. */
function respond() {
  const res = { status: 0, body: undefined }
  res.writeHead = (status) => {
    res.status = status
  }
  res.end = (buffer) => {
    res.body = JSON.parse(buffer.toString('utf8'))
  }
  return res
}

/** A request double from this application's own page. */
function ownedRequest(method, payload) {
  return {
    method,
    headers: { host: '127.0.0.1:5000', origin: 'http://127.0.0.1:5000' },
    on(type, fn) {
      if (type === 'data' && payload !== undefined) fn(Buffer.from(JSON.stringify(payload)))
      if (type === 'end') fn()
    },
  }
}

/* Cross-origin callers are refused before anything runs. */
let res = respond()
await routes.get('/api/window-fit/apply')(
  {
    method: 'POST',
    headers: { host: '127.0.0.1:5000', origin: 'https://evil.example' },
    on(type, fn) {
      if (type === 'data') fn(Buffer.from(JSON.stringify({ widthRatio: 0.5, heightRatio: 0.5 })))
      if (type === 'end') fn()
    },
  },
  res,
)
assert.equal(res.status, 403, 'a foreign Origin must be refused')

res = respond()
await routes.get('/api/window-fit/save')(ownedRequest('POST'), respond())
let crossSave = respond()
await routes.get('/api/window-fit/save')(
  {
    method: 'POST',
    headers: { host: '127.0.0.1:5000', origin: 'https://evil.example' },
    on(type, fn) {
      if (type === 'data') fn(Buffer.from(JSON.stringify({ widthRatio: 0.5, heightRatio: 0.5 })))
      if (type === 'end') fn()
    },
  },
  crossSave,
)
assert.equal(crossSave.status, 403, 'a foreign Origin must not save')
console.log('host: ok — cross-origin apply/save refused with 403')

res = respond()
await routes.get('/api/window-fit/state')({ method: 'GET' }, res)
assert.equal(res.status, 200)
assert.equal(res.body.widthRatio, 0.7875)
console.log('host: ok — state route returns', JSON.stringify(res.body))

res = respond()
await routes.get('/api/window-fit/save')(ownedRequest('POST'), res)
assert.equal(res.status, 400, 'a save without ratios must be rejected')

res = respond()
await routes.get('/api/window-fit/save')(
  {
    method: 'POST',
    headers: { host: '127.0.0.1:5000', origin: 'http://127.0.0.1:5000' },
    on(type, fn) {
      if (type === 'data') fn(Buffer.from('{not json'))
      if (type === 'end') fn()
    },
  },
  res,
)
assert.equal(res.status, 400, 'invalid JSON must be rejected')
console.log('host: ok — invalid saves rejected with 400')

res = respond()
await routes.get('/api/window-fit/save')(ownedRequest('POST', { widthRatio: 0.7, heightRatio: 0.75 }), res)
assert.equal(res.status, 200, 'a valid save must succeed')
assert.deepEqual(edits.at(-1), { widthRatio: 0.7, heightRatio: 0.75 })
console.log('host: ok — valid save persisted', JSON.stringify(edits.at(-1)))

/* Same-origin helper covers the header shapes a real request can carry. */
assert.equal(isSameOriginRequest({ headers: { origin: 'http://127.0.0.1:5000' } }, '127.0.0.1:5000'), true)
assert.equal(isSameOriginRequest({ headers: { origin: 'http://127.0.0.1:5001' } }, '127.0.0.1:5000'), false)
assert.equal(isSameOriginRequest({ headers: {} }, '127.0.0.1:5000'), false)
assert.equal(isSameOriginRequest({ headers: { origin: 'not a url' } }, '127.0.0.1:5000'), false)
console.log('host: ok — same-origin check handles missing, foreign and malformed origins')

console.log('smoke: all checks passed')

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

const { apply } = await import(pathToFileURL(join(root, 'index.js')).href)

const routes = new Map()
const edits = []
const ctx = {
  effect: (fn) => fn(),
  get: (name) => {
    if (name === 'webServer') {
      return {
        register: ({ path, handler }) => {
          routes.set(path, handler)
          return () => {}
        },
      }
    }
    if (name === 'configEditor') {
      return {
        edit: async (entry, change) => {
          edits.push(change({ widthRatio: 0.7875, heightRatio: 0.8144 }))
        },
      }
    }
    return undefined
  },
  fiber: { entry: { id: 'window-fit' } },
}

apply(ctx, { widthRatio: 0.7875, heightRatio: 0.8144, timeoutSeconds: 5 })

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

let res = respond()
await routes.get('/api/window-fit/state')({ method: 'GET' }, res)
assert.equal(res.status, 200)
assert.equal(res.body.widthRatio, 0.7875)
console.log('host: ok — state route returns', JSON.stringify(res.body))

res = respond()
await routes.get('/api/window-fit/save')({ method: 'POST', on(type, fn) { if (type === 'end') fn() } }, res)
assert.equal(res.status, 400, 'a save without ratios must be rejected')

res = respond()
const badBody = {
  method: 'POST',
  on(type, fn) {
    if (type === 'data') fn(Buffer.from('{not json'))
    if (type === 'end') fn()
  },
}
await routes.get('/api/window-fit/save')(badBody, res)
assert.equal(res.status, 400, 'invalid JSON must be rejected')
console.log('host: ok — invalid saves rejected with 400')

const goodReq = {
  method: 'POST',
  on(type, fn) {
    if (type === 'data') fn(Buffer.from(JSON.stringify({ widthRatio: 0.7, heightRatio: 0.75 })))
    if (type === 'end') fn()
  },
}
res = respond()
await routes.get('/api/window-fit/save')(goodReq, res)
assert.equal(res.status, 200, 'a valid save must succeed')
assert.deepEqual(edits.at(-1), { widthRatio: 0.7, heightRatio: 0.75 })
console.log('host: ok — valid save persisted', JSON.stringify(edits.at(-1)))

console.log('smoke: all checks passed')

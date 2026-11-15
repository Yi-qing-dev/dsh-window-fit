import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
const helper = join(directory, 'helper.ps1')
const launcher = join(directory, 'helper.vbs')
const logPath = join(tmpdir(), 'dsh-window-fit.log')
const ROUTE = '/api/window-fit'

const DEFAULT_WIDTH = 0.7875
const DEFAULT_HEIGHT = 0.8144
const DEFAULT_TIMEOUT = 60

/** Append one diagnostic line; a failed log write must never fail the plugin. */
function log(message) {
  try {
    appendFileSync(logPath, `[${new Date().toISOString()}] plugin: ${message}\n`)
  } catch {
    // ignore
  }
}

/** Accept a fraction of the screen and fall back to the packaged default. */
function share(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0.1 || parsed > 1) return fallback
  return parsed
}

/** Seconds the helper keeps looking for the window before giving up. */
function timeout(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 300) return fallback
  return Math.round(parsed)
}

/**
 * Run the resize helper with no visible console: wscript.exe hosts a hidden
 * PowerShell (window style 0) instead of a cmd/powershell console that flashes.
 */
export function fitWindow(widthRatio, heightRatio, timeoutSeconds) {
  try {
    const child = spawn(
      'wscript.exe',
      ['//nologo', launcher, helper, String(widthRatio), String(heightRatio), String(timeoutSeconds)],
      { detached: true, stdio: 'ignore', windowsHide: true },
    )
    child.on('error', (error) => log(`spawn error: ${error.message}`))
    child.unref()
  } catch (error) {
    log(`spawn threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Read one bounded JSON request body. */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let settled = false
    let size = 0
    const chunks = []
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req?.on?.('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) finish({ ok: false, error: 'request body too large' })
      else chunks.push(chunk)
    })
    req?.on?.('end', () => {
      if (settled) return
      if (chunks.length === 0) return finish({ ok: true, value: {} })
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        finish({ ok: true, value: parsed !== null && typeof parsed === 'object' ? parsed : {} })
      } catch {
        finish({ ok: false, error: 'invalid JSON body' })
      }
    })
    req?.on?.('error', () => finish({ ok: false, error: 'request stream error' }))
  })
}

/** Answer one JSON response. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Pick the ratios a request asks for, falling back to the saved configuration. */
export function pickRatios(input, current) {
  const width = Number(input?.widthRatio)
  const height = Number(input?.heightRatio)
  return {
    widthRatio: Number.isFinite(width) && width > 0.1 && width <= 1 ? width : current.widthRatio,
    heightRatio: Number.isFinite(height) && height > 0.1 && height <= 1 ? height : current.heightRatio,
  }
}

export function apply(ctx, config) {
  if (process.platform !== 'win32') return
  const current = {
    widthRatio: share(config?.widthRatio, DEFAULT_WIDTH),
    heightRatio: share(config?.heightRatio, DEFAULT_HEIGHT),
    timeoutSeconds: timeout(config?.timeoutSeconds, DEFAULT_TIMEOUT),
  }

  ctx.effect(() => {
    log(`apply ratios=${current.widthRatio}/${current.heightRatio}`)
    fitWindow(current.widthRatio, current.heightRatio, current.timeoutSeconds)
    return () => {}
  })

  const state = () => ({
    ok: true,
    widthRatio: current.widthRatio,
    heightRatio: current.heightRatio,
    timeoutSeconds: current.timeoutSeconds,
  })

  // Services are only reachable from a context that injected them, so the
  // Settings routes live in a `webServer` child scope.
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer
    if (server === undefined || typeof server.register !== 'function') {
      log('webServer unavailable; the Settings row has nothing to talk to')
      return
    }

    const register = (suffix, handler) =>
      webCtx.effect(
        () => server.register({ kind: 'exact', path: `${ROUTE}/${suffix}`, handler }),
        `window-fit route ${suffix}`,
      )

    register('state', async (req, res) => {
      sendJson(res, 200, state())
    })
    log(`routes registered under ${ROUTE} (scoped=${webCtx !== ctx})`)

    register('apply', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      const body = await readJsonBody(req)
      if (body.ok !== true) return sendJson(res, 400, { ok: false, error: body.error })
      const { widthRatio, heightRatio } = pickRatios(body.value, current)
      fitWindow(widthRatio, heightRatio, current.timeoutSeconds)
      sendJson(res, 200, { ok: true, widthRatio, heightRatio, timeoutSeconds: current.timeoutSeconds, applied: true })
    })

    register('save', async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      const body = await readJsonBody(req)
      if (body.ok !== true) return sendJson(res, 400, { ok: false, error: body.error })
      const widthRatio = Number(body.value?.widthRatio)
      const heightRatio = Number(body.value?.heightRatio)
      if (!Number.isFinite(widthRatio) || widthRatio <= 0.1 || widthRatio > 1) {
        return sendJson(res, 400, { ok: false, error: 'widthRatio must be within (0.1, 1]' })
      }
      if (!Number.isFinite(heightRatio) || heightRatio <= 0.1 || heightRatio > 1) {
        return sendJson(res, 400, { ok: false, error: 'heightRatio must be within (0.1, 1]' })
      }

      const editor = webCtx.get?.('configEditor') ?? ctx.get?.('configEditor')
      const entry = webCtx.fiber?.entry ?? ctx.fiber?.entry
      if (editor === undefined || entry === undefined) {
        log('configEditor unavailable; cannot save')
        return sendJson(res, 503, { ok: false, error: 'configuration cannot be saved in this profile' })
      }
      try {
        await editor.edit(entry, (candidate) => ({ ...candidate, widthRatio, heightRatio }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log(`save failed: ${message}`)
        return sendJson(res, 400, { ok: false, error: message })
      }
      sendJson(res, 200, { ok: true, widthRatio, heightRatio, timeoutSeconds: current.timeoutSeconds })
    })
  })
}

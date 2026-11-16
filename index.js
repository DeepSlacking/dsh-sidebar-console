/**
 * Host half of `dsh-sidebar-console`.
 *
 * The whole feature lives in the browser half (`client.js`). This half owns the
 * one thing the page cannot own reliably: the durable layout file. The page is
 * served from a loopback origin whose port can change between launches, so
 * `localStorage` is only a mirror there — the real record has to live on the
 * host under `$DSH_HOME/storages/dsh-sidebar-console/layout.json`.
 *
 * Two JSON routes are exposed on the shared Harness connection channel:
 *   POST /api/dsh-sidebar-console/state  → { ok, value: layout }
 *   POST /api/dsh-sidebar-console/save   → { ok, value: layout }  (body = layout)
 *
 * Plain plugin function (no Service subclass): the row installs nothing else
 * and no other component needs a service handle from it.
 * @module dsh-sidebar-console
 */
import { LayoutStore } from './lib/store.js'

/** Profile row id / module-loader id / settings namespace: one string. */
export const name = 'dsh-sidebar-console'

const ROUTE_PREFIX = '/api/dsh-sidebar-console/'
const ROUTES = ['state', 'save']

/**
 * Build a JSON response.
 * @param {unknown} value - envelope payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

/** Success envelope. */
const ok = (value) => json({ ok: true, value })

/** Failure envelope. */
const fail = (code, message, status = 200) => json({ ok: false, error: { code, message } }, status)

/**
 * Read a buffered JSON request body, tolerating an empty body.
 * @param {Request} request - harness connection request.
 * @returns {Promise<object>} the parsed body (or an empty object).
 */
async function readBody(request) {
  const text = await request.text()
  if (text.length === 0) return {}
  const parsed = JSON.parse(text)
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

/**
 * Dispatch one route on the layout store.
 * @param {'state'|'save'} route - route name.
 * @param {Request} request - harness connection request.
 * @param {LayoutStore} store - the plugin's layout store.
 * @returns {Promise<Response>} JSON envelope.
 */
async function handleRoute(route, request, store) {
  let body
  try {
    body = await readBody(request)
  } catch {
    return fail('bad-request', 'request body is not JSON')
  }
  try {
    switch (route) {
      case 'state':
        return ok(store.read())
      case 'save':
        return ok(store.write(body))
      default:
        return fail('not-found', `unknown route ${route}`)
    }
  } catch (error) {
    return fail('internal', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Register the layout routes on the shared connection channel.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host root context.
 */
export function apply(ctx) {
  const store = new LayoutStore().load()
  ctx.logger?.info?.(`sidebar-console: layout store ${store.file}${store.loadError === undefined ? '' : ` (load error: ${store.loadError})`}`)
  ctx.inject(['connection'], (child) => {
    child.effect(() => {
      const disposers = ROUTES.map((route) =>
        child.connection.fetch.register({
          path: `${ROUTE_PREFIX}${route}`,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: (request) => handleRoute(route, request, store),
        }),
      )
      return () => {
        // 0.2.2-rc.3 resolves register() to an async disposer. A synchronous
        // effect cleanup cannot await it, so the promise is observed here
        // instead of escaping as an unhandled rejection.
        for (const dispose of disposers) {
          try {
            const pending = dispose()
            if (pending !== undefined && typeof pending.catch === 'function') pending.catch(() => {})
          } catch {
            /* an already-released route must not block the others */
          }
        }
      }
    }, 'dsh-sidebar-console: layout routes')
  })
}

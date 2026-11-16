/**
 * Durable store for the left-sidebar console layout.
 *
 * The browser half owns the interaction (long-press drag, manager, hidden
 * section); this file is the source of truth that survives reloads, restarts
 * and browser-data wipes. It holds three things only:
 *
 *  - `order`    – the user's panel order, keyed by stable panel id. A saved
 *                 order always wins over the slot `order` values, which is what
 *                 keeps a plugin update from reshuffling the console.
 *  - `hidden`   – panel ids the user hid from the console.
 *  - `expanded` – whether the "N hidden" section at the bottom is open.
 *
 * Writes are atomic (write temp + rename) so a crash cannot truncate the file.
 * @module dsh-sidebar-console/store
 */
import fs from 'node:fs'
import path from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Bump only when the on-disk shape changes incompatibly. */
const VERSION = 1

/** Upper bound on remembered keys, so a record can never grow without limit. */
const MAX_ITEMS = 200

/** Longest acceptable key (a panel id or a label fallback). */
const MAX_KEY_LENGTH = 160

/** The empty layout served to a fresh installation. */
export const emptyLayout = () => ({
  version: VERSION,
  order: [],
  hidden: [],
  expanded: false,
  updatedAt: 0,
})

/**
 * Normalize one candidate key.
 * @param {unknown} value - raw value from JSON.
 * @returns {string|undefined} a trimmed non-empty string, or undefined.
 */
function cleanKey(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_LENGTH) return undefined
  return trimmed
}

/**
 * Normalize a key list: strings only, trimmed, de-duplicated, bounded.
 * @param {unknown} raw - raw JSON value.
 * @returns {string[]} the sanitized list.
 */
function cleanList(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const key = cleanKey(item)
    if (key === undefined || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/**
 * Sanitize a whole layout document. Unknown fields are dropped, never merged
 * through: an older plugin version can only lose its own additions.
 * @param {unknown} raw - parsed JSON from disk or from a client request.
 * @returns {ReturnType<typeof emptyLayout>} a valid layout document.
 */
export function sanitizeLayout(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const order = cleanList(source.order)
  return {
    version: VERSION,
    order,
    // `hidden` may remember keys that are temporarily absent from `order`
    // (the panel can come back later); it is still bounded and de-duped.
    hidden: cleanList(source.hidden),
    expanded: source.expanded === true,
    updatedAt: Number.isFinite(source.updatedAt) ? Math.max(0, Math.floor(source.updatedAt)) : 0,
  }
}

/**
 * Load, validate, mutate and persist the console layout.
 */
export class LayoutStore {
  /**
   * @param {string} [file] - explicit layout file; defaults to
   *   `$DSH_HOME/storages/dsh-sidebar-console/layout.json`.
   */
  constructor(file) {
    this.file = file ?? dshHomePath('storages', 'dsh-sidebar-console', 'layout.json')
    /** @type {ReturnType<typeof emptyLayout>} */
    this.state = emptyLayout()
    /** @type {string|undefined} */
    this.loadError = undefined
    /** @type {Set<() => void>} */
    this.listeners = new Set()
  }

  /**
   * Read the layout file, tolerating absence and corrupt JSON.
   * @returns {this} the store, for chaining.
   */
  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.state = sanitizeLayout(JSON.parse(raw))
    } catch (error) {
      this.state = emptyLayout()
      if (error?.code !== 'ENOENT') {
        this.loadError = error instanceof Error ? error.message : String(error)
      }
    }
    return this
  }

  /** Persist the current state atomically and notify subscribers. */
  save() {
    const directory = path.dirname(this.file)
    fs.mkdirSync(directory, { recursive: true })
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    fs.renameSync(temporary, this.file)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* a listener failure never breaks a committed write */
      }
    }
  }

  /** The current layout document (never a live mutation target). */
  read() {
    return {
      order: [...this.state.order],
      hidden: [...this.state.hidden],
      expanded: this.state.expanded,
      updatedAt: this.state.updatedAt,
    }
  }

  /**
   * Replace the layout with a sanitized client document.
   * @param {unknown} patch - `{order?, hidden?, expanded?}` from the browser.
   * @returns {ReturnType<typeof emptyLayout>} the committed layout.
   */
  write(patch) {
    const source = patch !== null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
    const next = sanitizeLayout({
      order: source.order === undefined ? this.state.order : source.order,
      hidden: source.hidden === undefined ? this.state.hidden : source.hidden,
      expanded: source.expanded === undefined ? this.state.expanded : source.expanded,
      updatedAt: Date.now(),
    })
    this.state = next
    this.save()
    return this.read()
  }
}

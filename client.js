/**
 * Browser half of `dsh-sidebar-console`.
 *
 * Manages the left sidebar's global panel list (the "console"):
 *
 *  - a top row inside the panel list: visible-entry count on the left and a
 *    manage icon button on the right;
 *  - long-press on any panel row arms a drag; moving up/down reorders the list,
 *    and the order is persisted on the host. A saved order always wins over the
 *    slot `order` values, so a plugin update cannot reshuffle the console;
 *  - the manage button opens one unified panel where every entry can be shown
 *    or hidden, one by one or in bulk;
 *  - hidden entries stay in the DOM but leave their place; a 「已隐藏 N 项」 row
 *    is pinned after the last visible entry and its icon button expands or
 *    collapses the hidden rows at the bottom.
 *
 * Contract with the host sidebar (verified against @deepseek-ai/dsh-client-ui-sidebar
 * 0.2.2-rc.1 and the live DOM report):
 *  - the panel list is `nav[class*="panelList"]`, a direct child of the sidebar
 *    root; panel rows are direct `button[class*="panelRow"]` children, and the
 *    "More" launcher is nested in a `span[class*="moreAnchor"]` direct child;
 *  - class names are build-hashed, so only substrings are matched;
 *  - this plugin never moves React nodes and never patches host code: it writes
 *    `style.order` / `style.display` / own `data-*` attributes, injects two own
 *    rows into the nav, and re-applies after React re-renders;
 *  - the layout lives on the host (see `index.js`), because the page origin is a
 *    loopback port that can change between launches; localStorage is only a
 *    fast-paint mirror.
 */
;(function () {
  'use strict'
  if (typeof window === 'undefined' || typeof window.__ModuleLoader__ !== 'object' || typeof window.__ModuleLoader__.load !== 'function') return

  window.__ModuleLoader__.load({
    id: 'dsh-sidebar-console',
    // eslint-disable-next-line no-unused-vars
    factory() {
      /** Locale namespace owned by this plugin. */
      const NS = 'dsh-sidebar-console'
      /** localStorage mirror key (first paint only; the host file is authoritative). */
      const MIRROR_KEY = 'dsh.sidebar-console.layout.v1'
      /** Own-node marker; every injected element carries it. */
      const OWN = 'data-dscm-ui'
      /** Row → key marker written on host rows. */
      const KEY_ATTR = 'data-dscm-key'
      /** Hidden marker written on the host row's nav child. */
      const HIDDEN_ATTR = 'data-dscm-hidden'
      /** Stable key for the host "More" launcher (not a registered panel). */
      const MORE_KEY = '@dscm:more'
      /** Flex `order` plan (the host nav is a flex column; DOM order is untouched). */
      const ORDER_HEAD = 90
      const ORDER_ITEM = 100
      const ORDER_STEP = 10
      const ORDER_HIDDEN_HEAD = 9000
      const ORDER_HIDDEN_ITEM = 9010
      /** Long-press gate (ms) and movement tolerance (px) while waiting. */
      const LONG_PRESS_MS = 300
      const CANCEL_TOLERANCE_PX = 6
      /** Movement (px) after the gate that turns the press into a drag. */
      const DRAG_ACTIVATE_PX = 3
      /** How long a drag swallows the follow-up click (ms). */
      const CLICK_SUPPRESS_MS = 450
      /** Upper bound on remembered keys, mirrored from the host store. */
      const MAX_KEYS = 200
      /** Sync storm guard: >N syncs in WINDOW ms suspends observation briefly. */
      const STORM_LIMIT = 60
      const STORM_WINDOW_MS = 1000
      const STORM_SUSPEND_MS = 800

      /* ── dictionaries ──────────────────────────────────────────────────── */

      const EN = {
        'head.count': '{n} items',
        'head.tip': '{n} entries are not hidden',
        'head.aria': '{n} visible entries; open the console manager',
        'manage.open': 'Manage console entries',
        'hidden.count': '{n} hidden',
        'hidden.aria': 'Hidden entries: {n}',
        'hidden.expand': 'Expand hidden entries',
        'hidden.collapse': 'Collapse hidden entries',
        'pop.title': 'Console entries',
        'pop.summary': '{total} total · {hidden} hidden',
        'pop.showAll': 'Show all',
        'pop.hideAll': 'Hide all',
        'pop.reset': 'Reset order',
        'pop.hint': 'Long-press an entry in the console, then drag up or down to reorder it. Order and visibility are saved on this machine.',
        'pop.empty': 'No entries to manage yet',
        'pop.showItem': 'Show {name}',
        'pop.hideItem': 'Hide {name}',
        'pop.moveUp': 'Move up',
        'pop.moveDown': 'Move down',
        'pop.openItem': 'Open {name}',
        'pop.close': 'Close',
      }

      const ZH = {
        'head.count': '{n} 项',
        'head.tip': '未隐藏项：{n}',
        'head.aria': '{n} 项未隐藏；打开控制台管理',
        'manage.open': '管理控制台项目',
        'hidden.count': '已隐藏 {n} 项',
        'hidden.aria': '已隐藏 {n} 项',
        'hidden.expand': '展开已隐藏项',
        'hidden.collapse': '收起已隐藏项',
        'pop.title': '控制台项目',
        'pop.summary': '共 {total} 项 · 隐藏 {hidden} 项',
        'pop.showAll': '全部显示',
        'pop.hideAll': '全部隐藏',
        'pop.reset': '恢复默认排序',
        'pop.hint': '长按左侧任意项目后上下拖动即可排序；排序与显隐保存在本机。',
        'pop.empty': '还没有可管理的项目',
        'pop.showItem': '显示 {name}',
        'pop.hideItem': '隐藏 {name}',
        'pop.moveUp': '上移',
        'pop.moveDown': '下移',
        'pop.openItem': '打开 {name}',
        'pop.close': '关闭',
      }

      /* ── trusted static markup ─────────────────────────────────────────── */

      const ICONS = {
        // Control-sliders artwork supplied by the profile owner (控制.svg). Filled and
        // painted with currentColor so it follows the shell's label color in both themes.
        manage:
          '<svg viewBox="0 0 1024 1024" width="16" height="16" fill="currentColor" aria-hidden="true">' +
          '<path d="M714.31 700.51c54.424 0 100.188 37.082 113.403 87.358l100.401 0.002c16.506 0 29.886 13.38 29.886 29.885 0 16.506-13.38 29.886-29.886 29.886l-100.4 0.001C814.497 897.918 768.733 935 714.308 935c-54.425 0-100.189-37.082-113.404-87.358H95.885C79.38 847.641 66 834.26 66 817.754c0-16.505 13.38-29.885 29.886-29.885l505.02-0.002c13.214-50.276 58.978-87.357 113.403-87.357z m0 59.773c-31.743 0-57.475 25.731-57.475 57.472 0 31.742 25.732 57.473 57.474 57.473 31.742 0 57.475-25.731 57.475-57.473 0-31.74-25.733-57.472-57.475-57.472z' +
          'M314.288 380.962c59.293 0 108.307 44.013 116.151 101.15l497.674 0.002C944.62 482.114 958 495.494 958 512s-13.38 29.886-29.886 29.886l-504.985 0.001c-17.322 43.12-59.526 73.564-108.84 73.564-49.315 0-91.518-30.445-108.84-73.564l-109.563-0.001C79.38 541.886 66 528.506 66 512s13.38-29.886 29.886-29.886l102.25-0.002c7.845-57.137 56.859-101.15 116.153-101.15z m0 59.772c-31.742 0-57.475 25.731-57.475 57.473 0 31.74 25.733 57.472 57.475 57.472s57.474-25.731 57.474-57.472c0-31.742-25.732-57.473-57.474-57.473z' +
          'M512 89c54.425 0 100.189 37.082 113.404 87.358h302.71c16.506 0 29.886 13.381 29.886 29.887 0 16.505-13.38 29.885-29.886 29.885l-302.71 0.002c-13.215 50.276-58.979 87.357-113.404 87.357s-100.189-37.081-113.404-87.357l-302.71-0.002C79.38 236.13 66 222.75 66 206.245c0-16.506 13.38-29.886 29.886-29.886l302.71-0.001C411.811 126.082 457.575 89 512 89z m0 59.772c-31.742 0-57.474 25.731-57.474 57.473 0 31.74 25.732 57.472 57.474 57.472 31.742 0 57.474-25.731 57.474-57.472 0-31.742-25.732-57.473-57.474-57.473z"/>' +
          '</svg>',
        close:
          '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        chevron:
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5.5 16 12l-7 6.5"/></svg>',
        up: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14.5 12 8l6 6.5"/></svg>',
        down: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5 12 16l6-6.5"/></svg>',
      }

      /* ── styles ────────────────────────────────────────────────────────── */

      const CSS = `
/* Own rows and controls only. Colors are host theme tokens with neutral
   fallbacks so light and dark both follow the shell. */
.dscm-head {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  min-height: 30px; padding: 0 4px 0 10px; margin: 0; box-sizing: border-box;
  flex: none; user-select: none;
  color: var(--dsw-alias-label-tertiary, #81858c); font-size: 13px; line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dscm-head-count { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dscm-icon-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: none; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer;
}
@media (hover: hover) { .dscm-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); } }
.dscm-icon-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4176e6); outline-offset: -1px; }
.dscm-icon-btn svg { display: block; }

/* The collapsible hidden section header (a nav-level row). */
.dscm-hidden-head {
  display: flex; align-items: center; gap: 6px; width: 100%; min-height: 30px;
  padding: 4px 10px; box-sizing: border-box; border: none; border-radius: var(--dsw-radius-md, 8px);
  background: transparent; color: var(--dsw-alias-label-tertiary, #81858c);
  font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer; user-select: none;
  flex: none;
}
@media (hover: hover) { .dscm-hidden-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); color: var(--dsw-alias-label-secondary, #61666b); } }
.dscm-hidden-head:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4176e6); outline-offset: -1px; }
.dscm-hidden-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.dscm-chevron { display: inline-flex; flex: none; transition: transform .16s ease; }
.dscm-chevron[data-open] { transform: rotate(90deg); }
.dscm-hidden-badge { display: none; }

/* Drag visuals: two classed selectors so the host's :hover fill cannot win. */
button[class*="panelRow"].dscm-dragging, .dscm-dragging {
  position: relative; z-index: 6; opacity: .55 !important; cursor: grabbing !important;
  transition: none !important; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3, rgba(0, 0, 0, .14)) !important;
}
.dscm-armed { cursor: grabbing; }
.dscm-armed button[class*="panelRow"] { cursor: grabbing; }
[data-dscm-drag="on"], [data-dscm-drag="on"] * { cursor: grabbing !important; user-select: none !important; -webkit-user-select: none !important; }
/* Hidden host rows while the section is collapsed. */
[data-dscm-hidden] { opacity: .8; }

/* Collapsed (rail) sidebar: our controls shrink to 36x36 icon rows. */
.dscm-head[data-rail] { justify-content: center; padding: 0; min-height: 36px; }
.dscm-head[data-rail] .dscm-head-count { display: none; }
.dscm-head[data-rail] .dscm-icon-btn { width: 36px; height: 36px; }
.dscm-hidden-head[data-rail] {
  width: 36px; height: 36px; min-height: 36px; padding: 0; justify-content: center; margin: 0 auto;
}
.dscm-hidden-head[data-rail] .dscm-hidden-text, .dscm-hidden-head[data-rail] .dscm-chevron { display: none; }
.dscm-hidden-head[data-rail] .dscm-hidden-badge { display: inline-flex; font-size: 11px; font-variant-numeric: tabular-nums; }

/* Unified manager popover. */
.dscm-pop {
  position: fixed; z-index: 1250; display: flex; flex-direction: column; gap: 8px;
  width: 302px; max-width: calc(100vw - 16px); max-height: min(72vh, 560px);
  padding: 10px; box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #0f1115);
  border: .5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  border-radius: 14px; box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0, 0, 0, .22));
  font-size: 13px;
}
.dscm-pop-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dscm-pop-titlewrap { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dscm-pop-title { font-size: 14px; font-weight: 600; line-height: 20px; }
.dscm-pop-summary { color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
.dscm-pop-close { margin: -2px -2px 0 0; }
.dscm-pop-tools { display: flex; flex-wrap: wrap; gap: 6px; }
.dscm-pop-tool {
  height: 26px; padding: 0 10px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, .12));
  background: transparent; color: var(--dsw-alias-label-secondary, #61666b);
}
@media (hover: hover) { .dscm-pop-tool:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); color: var(--dsw-alias-label-primary, #0f1115); } }
.dscm-pop-tool:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4176e6); outline-offset: 1px; }
.dscm-pop-list { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; margin: 0 -4px; padding: 0 4px; scrollbar-width: thin; }
.dscm-pop-row { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 3px 4px 3px 6px; border-radius: 8px; }
@media (hover: hover) { .dscm-pop-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); } }
.dscm-pop-glyph { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; color: var(--dsw-alias-label-secondary, #61666b); }
.dscm-pop-glyph svg { width: 16px; height: 16px; display: block; }
.dscm-pop-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border: none; background: transparent; padding: 0; text-align: left; cursor: pointer; color: inherit; font: inherit;
}
.dscm-pop-name:hover { text-decoration: underline; text-underline-offset: 2px; }
.dscm-pop-move { display: inline-flex; gap: 0; opacity: 0; transition: opacity .12s ease; }
.dscm-pop-row:hover .dscm-pop-move, .dscm-pop-row:focus-within .dscm-pop-move { opacity: 1; }
.dscm-pop-movebtn {
  width: 22px; height: 22px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary, #61666b); cursor: pointer;
}
@media (hover: hover) { .dscm-pop-movebtn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .08)); } }
.dscm-pop-movebtn:disabled { opacity: .3; cursor: default; }
.dscm-pop-empty { padding: 14px 8px; text-align: center; color: var(--dsw-alias-label-tertiary, #81858c); }
.dscm-pop-foot { border-top: .5px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .06)); padding-top: 8px; color: var(--dsw-alias-label-tertiary, #81858c); font-size: 12px; line-height: 17px; }
.dscm-switch {
  flex: none; position: relative; width: 32px; height: 18px; padding: 0; border: none; border-radius: 9px;
  background: var(--dsw-alias-border-l3, rgba(0, 0, 0, .16)); cursor: pointer; transition: background .15s ease;
}
.dscm-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #fff); box-shadow: 0 1px 2px rgba(0, 0, 0, .24); transition: transform .15s ease;
}
.dscm-switch[aria-checked="true"] { background: var(--dsw-alias-state-business-primary, #4176e6); }
.dscm-switch[aria-checked="true"]::after { transform: translateX(14px); }
.dscm-switch:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, #4176e6); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .dscm-chevron, .dscm-pop-move, .dscm-switch, .dscm-switch::after { transition: none; }
}
`

      /* ── tiny DOM helpers ───────────────────────────────────────────────── */

      function el(tag, className, options) {
        const node = document.createElement(tag)
        if (className) node.className = className
        if (options) {
          for (const [key, value] of Object.entries(options)) {
            if (value === undefined || value === null) continue
            if (key === 'text') node.textContent = String(value)
            else if (key === 'html') node.innerHTML = String(value)
            else node.setAttribute(key, String(value))
          }
        }
        return node
      }

      /** Write an attribute only when it really changes (keeps MutationObserver quiet). */
      function setAttr(node, name, value) {
        if (value === undefined || value === null) {
          if (node.hasAttribute(name)) node.removeAttribute(name)
          return
        }
        if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value))
      }

      function setStyle(node, property, value) {
        if (node.style[property] !== value) node.style[property] = value
      }

      function setText(node, value) {
        const next = String(value)
        if (node.textContent !== next) node.textContent = next
      }

      function closestFrom(target, selector) {
        if (target === null || target === undefined || typeof target.closest !== 'function') return null
        return target.closest(selector)
      }

      function classNameOf(node) {
        return node !== null && typeof node.className === 'string' ? node.className : ''
      }

      /* ── manager engine ────────────────────────────────────────────────── */

      /**
       * Build the sidebar-console manager bound to one client context.
       * @param {*} ctx - Cordis client context (`slots` + `locale` present).
       * @param {(key: string, params?: object) => string} t - bound translator.
       * @returns {{start: Function, stop: Function, scheduleSync: Function, debugApi: object}}
       */
      function createManager(ctx, t) {
        const state = { order: [], hidden: [], expanded: false, updatedAt: 0 }
        const ui = {
          nav: null,
          root: null,
          head: null,
          headCount: null,
          manageBtn: null,
          hiddenHead: null,
          hiddenText: null,
          hiddenBadge: null,
          hiddenChevron: null,
          pop: null,
          popList: null,
          popSummary: null,
          popSig: '',
          items: [],
          byKey: new Map(),
          navObserver: null,
          rootObserver: null,
          bodyObserver: null,
          timer: 0,
          retryTimer: 0,
          retries: 0,
          saveTimer: 0,
          syncTimes: [],
          suspendUntil: 0,
          sig: '',
          railPoll: 0,
          railState: null,
          hydrated: false,
          started: false,
          disposed: false,
          drag: null,
          suppressClickUntil: 0,
        }

        /* ── persistence ───────────────────────────────────────────────── */

        function sanitizeState(raw) {
          if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
          const cleanList = (value) => {
            if (!Array.isArray(value)) return []
            const seen = new Set()
            const out = []
            for (const entry of value) {
              if (typeof entry !== 'string') continue
              const key = entry.trim()
              if (key.length === 0 || key.length > 160 || seen.has(key)) continue
              seen.add(key)
              out.push(key)
              if (out.length >= MAX_KEYS) break
            }
            return out
          }
          return {
            order: cleanList(raw.order),
            hidden: cleanList(raw.hidden),
            expanded: raw.expanded === true,
            updatedAt: Number.isFinite(raw.updatedAt) ? Math.max(0, Math.floor(raw.updatedAt)) : 0,
          }
        }

        function adopt(next) {
          if (next === null) return
          state.order = next.order
          state.hidden = next.hidden
          state.expanded = next.expanded
          state.updatedAt = next.updatedAt
        }

        function readMirror() {
          try {
            const raw = window.localStorage.getItem(MIRROR_KEY)
            if (raw === null) return
            const parsed = sanitizeState(JSON.parse(raw))
            if (parsed !== null) adopt(parsed)
          } catch {
            /* a corrupt mirror is ignored: the host copy wins on load */
          }
        }

        function writeMirror() {
          try {
            window.localStorage.setItem(
              MIRROR_KEY,
              JSON.stringify({
                order: state.order,
                hidden: state.hidden,
                expanded: state.expanded,
                updatedAt: state.updatedAt,
              }),
            )
          } catch {
            /* storage may be disabled; the host copy still persists everything */
          }
        }

        async function api(route, body) {
          const response = await fetch(`/api/dsh-sidebar-console/${route}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body === undefined ? {} : body),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
            throw new Error(payload && payload.error && payload.error.message ? payload.error.message : 'request failed')
          }
          return payload.value
        }

        function saveSoon() {
          if (ui.disposed) return
          state.updatedAt = Date.now()
          writeMirror()
          if (!ui.hydrated) return
          if (ui.saveTimer !== 0) window.clearTimeout(ui.saveTimer)
          ui.saveTimer = window.setTimeout(() => {
            ui.saveTimer = 0
            flushSave()
          }, 300)
        }

        function flushSave() {
          if (ui.disposed) return
          api('save', { order: [...state.order], hidden: [...state.hidden], expanded: state.expanded }).catch(() => {
            /* a failed write is retried by the next interaction; the mirror keeps it */
          })
        }

        function loadHostState() {
          api('state', {})
            .then((value) => {
              const remote = sanitizeState(value)
              if (remote === null) return
              if (remote.updatedAt > state.updatedAt) {
                adopt(remote)
                writeMirror()
                scheduleSync()
              } else if (state.updatedAt > remote.updatedAt) {
                flushSave()
              }
            })
            .catch(() => {
              /* host route unavailable: keep the local mirror */
            })
            .finally(() => {
              ui.hydrated = true
              scheduleSync()
            })
        }

        /* ── panel identity ────────────────────────────────────────────── */

        function hiddenSet() {
          return new Set(state.hidden)
        }

        /**
         * Read the BCP 47 id of the locale the shell is painting right now.
         * The sidebar resolves slot labels against the active locale before it
         * writes a row's aria-label, so this half has to resolve the same way
         * for a DOM row to match its registered panel id.
         * @returns {string} the active locale id, or an empty string when unknown.
         */
        function activeLocaleId() {
          try {
            const locale = ctx.locale
            if (locale && typeof locale.getLocale === 'function') {
              const snapshot = locale.getLocale()
              if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.active === 'string') {
                return snapshot.active
              }
            }
          } catch {
            /* an unreadable runtime locale falls back to the document language */
          }
          try {
            const lang = document.documentElement.lang
            if (typeof lang === 'string' && lang.length > 0) {
              return lang.toLowerCase().startsWith('zh') ? 'zh' : lang
            }
          } catch {
            /* non-browser runs have no document */
          }
          return ''
        }

        /**
         * Resolve one registered slot label to the text the host renders.
         * 0.2.2-rc.3 accepts a plain string, a lazy factory, or a
         * LocalizedText map ({ en, zh, ... }); the sidebar resolves all three
         * before it writes a row's aria-label. Leaving a map unresolved here
         * would drop the row back to a label-only key, and its saved order and
         * visibility would silently stop matching.
         * @param {unknown} raw - options.label from a sidebar.panellist entry.
         * @returns {string} the resolved label, or an empty string.
         */
        function resolveSlotLabel(raw) {
          let value = raw
          if (typeof value === 'function') {
            try {
              value = value()
            } catch {
              value = undefined
            }
          }
          if (typeof value === 'string') return value.trim()
          if (value !== null && typeof value === 'object') {
            const active = activeLocaleId()
            for (const candidate of [active, 'zh', 'en']) {
              if (typeof candidate !== 'string' || candidate.length === 0) continue
              const text = value[candidate]
              if (typeof text === 'string' && text.trim().length > 0) return text.trim()
            }
            for (const text of Object.values(value)) {
              if (typeof text === 'string' && text.trim().length > 0) return text.trim()
            }
          }
          return ''
        }

        function panelEntries() {
          const slots = ctx.slots
          if (!slots || typeof slots.entriesOfSlot !== 'function') return []
          let entries = []
          try {
            entries = slots.entriesOfSlot('sidebar.panellist')
          } catch {
            return []
          }
          const out = []
          for (const entry of entries) {
            const options = entry && entry.options ? entry.options : {}
            const id = typeof options.id === 'string' ? options.id : undefined
            if (id === undefined) continue
            const label = resolveSlotLabel(options.label)
            out.push({ id, label: label.length > 0 ? label : id })
          }
          return out
        }

        /* ── DOM discovery ─────────────────────────────────────────────── */

        function findNav() {
          for (const candidate of document.querySelectorAll('nav[class*="panelList"]')) {
            if (candidate.querySelector('button[class*="panelRow"]') !== null) return candidate
          }
          for (const candidate of document.querySelectorAll('[class*="panelList"]')) {
            if (candidate.querySelector('button[class*="panelRow"]') !== null) return candidate
          }
          for (const candidate of document.querySelectorAll('nav')) {
            if (candidate.querySelector('button[class*="panelRow"]') !== null) return candidate
          }
          return null
        }

        function findSidebarRoot(nav) {
          let node = nav.parentElement
          for (let depth = 0; node !== null && depth < 4; depth += 1) {
            if (/(^|\s)[^\s]*_root(\s|$)/.test(classNameOf(node))) return node
            node = node.parentElement
          }
          return nav.parentElement
        }

        function detectRail() {
          if (ui.nav === null) return false
          let node = ui.nav
          for (let depth = 0; node !== null && depth < 5; depth += 1) {
            if (/(^|\s)[^\s]*_collapsed(\s|$)/.test(classNameOf(node))) return true
            node = node.parentElement
          }
          try {
            return ui.nav.getBoundingClientRect().width > 0 && ui.nav.getBoundingClientRect().width < 64
          } catch {
            return false
          }
        }

        /**
         * Collect managed rows in current React DOM order (visual order comes
         * from `style.order`, which this plugin writes).
         * @param {HTMLElement} nav - sidebar panel list.
         * @returns {Array<object>} managed items.
         */
        function collectItems(nav) {
          const entries = panelEntries()
          const byLabel = new Map()
          for (const entry of entries) {
            const queue = byLabel.get(entry.label)
            if (queue === undefined) byLabel.set(entry.label, [entry.id])
            else queue.push(entry.id)
          }
          const usedIds = new Set()
          const items = []
          for (const node of Array.from(nav.children)) {
            if (node.hasAttribute(OWN)) continue
            let row = null
            if (typeof node.matches === 'function' && node.matches('button[class*="panelRow"]')) row = node
            else if (typeof node.querySelector === 'function') row = node.querySelector('button[class*="panelRow"]')
            if (row === null || row.hasAttribute(OWN)) continue
            const ariaLabel = row.getAttribute('aria-label')
            const titleNode = row.querySelector('span[class*="panelTitle"]')
            const label = (ariaLabel !== null && ariaLabel.trim().length > 0 ? ariaLabel.trim() : '') ||
              (titleNode !== null && titleNode.textContent !== null ? titleNode.textContent.trim() : '') ||
              row.getAttribute('title') || ''
            let key = null
            if (row.getAttribute('aria-haspopup') === 'menu') {
              key = MORE_KEY
            } else {
              const queue = byLabel.get(label)
              if (queue !== undefined) {
                for (const id of queue) {
                  if (!usedIds.has(id)) {
                    usedIds.add(id)
                    key = id
                    break
                  }
                }
              }
            }
            if (key === null) key = `label:${label}`
            items.push({ key, label: label.length > 0 ? label : key, row, node })
          }
          return items
        }

        /* ── order merge ───────────────────────────────────────────────── */

        function sameOrder(left, right) {
          if (left.length !== right.length) return false
          for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
          return true
        }

        /**
         * Saved order is authoritative for every key it already knows; keys it
         * has never seen are appended in host order. This is what keeps a plugin
         * update from reshuffling the console.
         * @param {Array<object>} items - collected items.
         * @returns {boolean} whether state.order changed.
         */
        function resolveOrder(items) {
          const keys = items.map((item) => item.key)
          const existing = new Set(keys)
          const saved = state.order.filter((key) => existing.has(key))
          const fresh = keys.filter((key) => !saved.includes(key))
          const next = saved.concat(fresh)
          if (sameOrder(next, state.order)) return false
          state.order = next
          return true
        }

        /* ── apply pass ────────────────────────────────────────────────── */

        function expectedPlan(items, rail) {
          const hidden = hiddenSet()
          let visibleIndex = 0
          let hiddenIndex = 0
          const plan = new Map()
          for (const key of state.order) {
            const item = ui.byKey.get(key)
            if (item === undefined) continue
            if (hidden.has(key)) {
              plan.set(key, {
                order: ORDER_HIDDEN_ITEM + hiddenIndex * ORDER_STEP,
                display: state.expanded ? '' : 'none',
              })
              hiddenIndex += 1
            } else {
              plan.set(key, { order: ORDER_ITEM + visibleIndex * ORDER_STEP, display: '' })
              visibleIndex += 1
            }
          }
          const hiddenCount = hiddenIndex
          const visibleCount = visibleIndex
          return { plan, hiddenCount, visibleCount, rail }
        }

        function applyItems(items, plan) {
          const hidden = hiddenSet()
          for (const item of items) {
            const target = plan.get(item.key)
            const entry = target === undefined ? { order: ORDER_ITEM, display: '' } : target
            // The nav child is normally the row button itself; the host "More"
            // launcher sits in a wrapper span, so write the same order on both
            // (a wrapper with `display: contents` would otherwise swallow it).
            setStyle(item.node, 'order', String(entry.order))
            if (item.row !== item.node) setStyle(item.row, 'order', String(entry.order))
            setAttr(item.node, 'data-dscm-slot', '')
            setAttr(item.row, KEY_ATTR, item.key)
            if (hidden.has(item.key)) {
              setAttr(item.node, HIDDEN_ATTR, '')
              setStyle(item.node, 'display', entry.display)
            } else {
              setAttr(item.node, HIDDEN_ATTR, null)
              setStyle(item.node, 'display', '')
            }
          }
        }

        /* ── injected head row ─────────────────────────────────────────── */

        function ensureHead(nav) {
          if (ui.head === null) {
            const head = el('div', 'dscm-head', { [OWN]: 'head' })
            const count = el('span', 'dscm-head-count')
            const button = el('button', 'dscm-icon-btn', {
              type: 'button',
              [OWN]: 'manage',
              'aria-haspopup': 'dialog',
              'aria-expanded': 'false',
            })
            button.innerHTML = ICONS.manage
            button.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              togglePopover()
            })
            head.append(count, button)
            ui.head = head
            ui.headCount = count
            ui.manageBtn = button
          }
          setStyle(ui.head, 'order', String(ORDER_HEAD))
          if (ui.head.parentElement !== nav || nav.firstElementChild !== ui.head) {
            nav.insertBefore(ui.head, nav.firstElementChild)
          }
        }

        function updateHead(plan) {
          const rail = plan.rail
          setText(ui.headCount, t('head.count', { n: plan.visibleCount }))
          setAttr(ui.headCount, 'title', t('head.tip', { n: plan.visibleCount }))
          setAttr(ui.manageBtn, 'aria-label', t('head.aria', { n: plan.visibleCount }))
          setAttr(ui.manageBtn, 'title', t('manage.open'))
          setAttr(ui.head, 'data-rail', rail ? '' : null)
        }

        /* ── injected hidden section header ────────────────────────────── */

        function ensureHiddenHead(nav) {
          if (ui.hiddenHead === null) {
            const head = el('button', 'dscm-hidden-head', {
              type: 'button',
              [OWN]: 'hidden-head',
              'aria-expanded': 'false',
            })
            const chevron = el('span', 'dscm-chevron')
            chevron.innerHTML = ICONS.chevron
            const text = el('span', 'dscm-hidden-text')
            const badge = el('span', 'dscm-hidden-badge')
            head.append(chevron, text, badge)
            head.addEventListener('click', (event) => {
              event.preventDefault()
              event.stopPropagation()
              state.expanded = !state.expanded
              saveSoon()
              scheduleSync()
            })
            ui.hiddenHead = head
            ui.hiddenChevron = chevron
            ui.hiddenText = text
            ui.hiddenBadge = badge
          }
          setStyle(ui.hiddenHead, 'order', String(ORDER_HIDDEN_HEAD))
          if (ui.hiddenHead.parentElement !== nav) nav.appendChild(ui.hiddenHead)
        }

        function updateHiddenHead(plan) {
          const rail = plan.rail
          if (plan.hiddenCount === 0) {
            setStyle(ui.hiddenHead, 'display', 'none')
            return
          }
          setStyle(ui.hiddenHead, 'display', '')
          setText(ui.hiddenText, t('hidden.count', { n: plan.hiddenCount }))
          setText(ui.hiddenBadge, String(plan.hiddenCount))
          setAttr(ui.hiddenHead, 'aria-expanded', state.expanded ? 'true' : 'false')
          setAttr(ui.hiddenHead, 'aria-label', t('hidden.aria', { n: plan.hiddenCount }))
          setAttr(ui.hiddenHead, 'title', state.expanded ? t('hidden.collapse') : t('hidden.expand'))
          setAttr(ui.hiddenChevron, 'data-open', state.expanded ? '' : null)
          setAttr(ui.hiddenHead, 'data-rail', rail ? '' : null)
        }

        /* ── unified manager popover ───────────────────────────────────── */

        function itemByKey(key) {
          return ui.byKey.get(key) || null
        }

        function commitChange() {
          state.updatedAt = Date.now()
          saveSoon()
          scheduleSync()
        }

        function moveKey(key, direction) {
          const hidden = hiddenSet()
          const visible = state.order.filter((candidate) => ui.byKey.has(candidate) && !hidden.has(candidate))
          const index = visible.indexOf(key)
          if (index < 0) return
          const target = index + direction
          if (target < 0 || target >= visible.length) return
          const anchor = visible[target]
          const rest = state.order.filter((candidate) => candidate !== key)
          const at = direction < 0 ? rest.indexOf(anchor) : rest.indexOf(anchor) + 1
          const insertAt = at < 0 ? rest.length : at
          state.order = rest.slice(0, insertAt).concat([key], rest.slice(insertAt))
          commitChange()
        }

        function handlePopAct(action, key) {
          if (action === 'close') return closePopover()
          if (action === 'show-all') {
            state.hidden = []
            return commitChange()
          }
          if (action === 'hide-all') {
            state.hidden = ui.items.map((item) => item.key)
            return commitChange()
          }
          if (action === 'reset') {
            state.order = []
            return commitChange()
          }
          if (action === 'open') {
            const item = itemByKey(key)
            if (item !== null) {
              closePopover()
              try {
                item.row.click()
              } catch {
                /* host row vanished */
              }
            }
            return
          }
          if (action === 'toggle') {
            const hidden = hiddenSet()
            if (hidden.has(key)) state.hidden = state.hidden.filter((candidate) => candidate !== key)
            else if (!state.hidden.includes(key)) state.hidden = state.hidden.concat([key])
            return commitChange()
          }
          if (action === 'up') return moveKey(key, -1)
          if (action === 'down') return moveKey(key, 1)
        }

        function refreshPopover() {
          if (ui.pop === null) return
          const items = ui.items
          const hidden = hiddenSet()
          const hiddenCount = items.filter((item) => hidden.has(item.key)).length
          setText(ui.popSummary, t('pop.summary', { total: items.length, hidden: hiddenCount }))
          const orderedKeys = state.order.filter((key) => ui.byKey.has(key))
          for (const item of items) if (!orderedKeys.includes(item.key)) orderedKeys.push(item.key)
          const signature = `${orderedKeys.join('\u0001')}|${state.hidden.join('\u0001')}|${items.map((item) => item.label).join('\u0001')}`
          if (signature === ui.popSig) return
          ui.popSig = signature
          const list = ui.popList
          while (list.firstChild !== null) list.removeChild(list.firstChild)
          if (items.length === 0) {
            list.appendChild(el('div', 'dscm-pop-empty', { text: t('pop.empty') }))
            return
          }
          const visibleKeys = orderedKeys.filter((key) => !hidden.has(key))
          for (const key of orderedKeys) {
            const item = itemByKey(key)
            if (item === null) continue
            const isHidden = hidden.has(key)
            const row = el('div', 'dscm-pop-row', { 'data-key': key })
            const glyph = el('span', 'dscm-pop-glyph')
            const sourceGlyph = item.row.querySelector('span[class*="panelGlyph"]')
            if (sourceGlyph !== null) glyph.appendChild(sourceGlyph.cloneNode(true))
            const name = el('button', 'dscm-pop-name', {
              type: 'button',
              'data-act': 'open',
              'data-key': key,
              text: item.label,
              title: t('pop.openItem', { name: item.label }),
            })
            const move = el('span', 'dscm-pop-move')
            const visibleIndex = visibleKeys.indexOf(key)
            const up = el('button', 'dscm-pop-movebtn', {
              type: 'button',
              'data-act': 'up',
              'data-key': key,
              'aria-label': t('pop.moveUp'),
              title: t('pop.moveUp'),
            })
            up.innerHTML = ICONS.up
            up.disabled = isHidden || visibleIndex <= 0
            const down = el('button', 'dscm-pop-movebtn', {
              type: 'button',
              'data-act': 'down',
              'data-key': key,
              'aria-label': t('pop.moveDown'),
              title: t('pop.moveDown'),
            })
            down.innerHTML = ICONS.down
            down.disabled = isHidden || visibleIndex < 0 || visibleIndex >= visibleKeys.length - 1
            move.append(up, down)
            const toggle = el('button', 'dscm-switch', {
              type: 'button',
              role: 'switch',
              'data-act': 'toggle',
              'data-key': key,
              'aria-checked': isHidden ? 'false' : 'true',
              'aria-label': isHidden ? t('pop.showItem', { name: item.label }) : t('pop.hideItem', { name: item.label }),
              title: isHidden ? t('pop.showItem', { name: item.label }) : t('pop.hideItem', { name: item.label }),
            })
            row.append(glyph, name, move, toggle)
            list.appendChild(row)
          }
        }

        function positionPopover() {
          if (ui.pop === null) return
          const anchor = ui.manageBtn
          if (anchor === null || !anchor.isConnected) return
          const rect = anchor.getBoundingClientRect()
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800
          const width = ui.pop.offsetWidth || 302
          const height = ui.pop.offsetHeight || 320
          let left = rect.right + 10
          if (left + width > viewportWidth - 8) left = rect.left - width - 10
          if (left < 8) left = 8
          let top = rect.top
          if (top + height > viewportHeight - 8) top = Math.max(8, viewportHeight - height - 8)
          ui.pop.style.left = `${Math.round(left)}px`
          ui.pop.style.top = `${Math.round(top)}px`
        }

        function onDocPointerDown(event) {
          if (ui.pop === null) return
          if (ui.pop.contains(event.target)) return
          if (closestFrom(event.target, `[${OWN}="manage"]`) !== null) return
          closePopover()
        }

        function onDocKeyDown(event) {
          if (event.key === 'Escape' && ui.pop !== null) {
            event.preventDefault()
            closePopover()
          }
        }

        function openPopover() {
          if (ui.pop !== null) return
          const pop = el('div', 'dscm-pop', { [OWN]: 'popover', role: 'dialog', 'aria-label': t('pop.title') })
          const head = el('div', 'dscm-pop-head')
          const titleWrap = el('div', 'dscm-pop-titlewrap')
          const title = el('div', 'dscm-pop-title', { text: t('pop.title') })
          const summary = el('div', 'dscm-pop-summary')
          titleWrap.append(title, summary)
          const close = el('button', 'dscm-icon-btn dscm-pop-close', {
            type: 'button',
            [OWN]: 'popover-close',
            'aria-label': t('pop.close'),
            title: t('pop.close'),
          })
          close.innerHTML = ICONS.close
          close.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            closePopover()
          })
          head.append(titleWrap, close)
          const tools = el('div', 'dscm-pop-tools')
          const tool = (label, action) => el('button', 'dscm-pop-tool', { type: 'button', 'data-act': action, text: label })
          tools.append(tool(t('pop.showAll'), 'show-all'), tool(t('pop.hideAll'), 'hide-all'), tool(t('pop.reset'), 'reset'))
          const list = el('div', 'dscm-pop-list', { [OWN]: 'popover-list' })
          const foot = el('div', 'dscm-pop-foot', { text: t('pop.hint') })
          pop.addEventListener('click', (event) => {
            const button = closestFrom(event.target, '[data-act]')
            if (button === null || !pop.contains(button)) return
            event.preventDefault()
            event.stopPropagation()
            handlePopAct(button.getAttribute('data-act'), button.getAttribute('data-key'))
          })
          pop.append(head, tools, list, foot)
          document.body.appendChild(pop)
          ui.pop = pop
          ui.popList = list
          ui.popSummary = summary
          ui.popSig = ''
          setAttr(ui.manageBtn, 'aria-expanded', 'true')
          refreshPopover()
          positionPopover()
          document.addEventListener('pointerdown', onDocPointerDown, true)
          document.addEventListener('keydown', onDocKeyDown, true)
          window.addEventListener('resize', positionPopover)
          window.addEventListener('scroll', positionPopover, true)
        }

        function closePopover() {
          if (ui.pop === null) return
          document.removeEventListener('pointerdown', onDocPointerDown, true)
          document.removeEventListener('keydown', onDocKeyDown, true)
          window.removeEventListener('resize', positionPopover)
          window.removeEventListener('scroll', positionPopover, true)
          if (ui.pop.parentElement !== null) ui.pop.parentElement.removeChild(ui.pop)
          ui.pop = null
          ui.popList = null
          ui.popSummary = null
          ui.popSig = ''
          if (ui.manageBtn !== null) setAttr(ui.manageBtn, 'aria-expanded', 'false')
        }

        function togglePopover() {
          if (ui.pop !== null) closePopover()
          else openPopover()
        }

        /* ── long-press drag reorder ───────────────────────────────────── */

        function dragCleanup(releaseCapture) {
          const drag = ui.drag
          if (drag === null) return
          if (drag.timer !== 0) window.clearTimeout(drag.timer)
          if (drag.moveHandler !== null) window.removeEventListener('pointermove', drag.moveHandler, false)
          if (drag.upHandler !== null) window.removeEventListener('pointerup', drag.upHandler, false)
          if (drag.cancelHandler !== null) window.removeEventListener('pointercancel', drag.cancelHandler, false)
          if (drag.touchHandler !== null) document.removeEventListener('touchmove', drag.touchHandler, false)
          if (drag.raf !== 0) window.cancelAnimationFrame(drag.raf)
          if (drag.row !== null) {
            try {
              drag.row.classList.remove('dscm-armed')
              drag.row.classList.remove('dscm-dragging')
              drag.row.style.transform = ''
            } catch {
              /* row may be gone */
            }
            if (releaseCapture && drag.pointerId !== null) {
              try {
                drag.row.releasePointerCapture(drag.pointerId)
              } catch {
                /* not captured */
              }
            }
          }
          if (ui.nav !== null) setAttr(ui.nav, 'data-dscm-drag', null)
          ui.drag = null
        }

        function finishDrag(persist) {
          const drag = ui.drag
          if (drag === null) return
          const wasActive = drag.active
          dragCleanup(true)
          if (persist && wasActive) {
            state.updatedAt = Date.now()
            saveSoon()
            scheduleSync()
          }
          if (wasActive) ui.suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS
        }

        function cancelDrag(restore) {
          const drag = ui.drag
          if (drag === null) return
          const snapshot = drag.startOrder
          const wasActive = drag.active
          dragCleanup(true)
          if (wasActive && restore && Array.isArray(snapshot)) {
            state.order = snapshot
            scheduleSync()
          }
        }

        function measureVisible(items) {
          const hidden = hiddenSet()
          const list = []
          for (const item of items) {
            if (hidden.has(item.key)) continue
            let rect
            try {
              rect = item.row.getBoundingClientRect()
            } catch {
              continue
            }
            if (rect.height <= 0) continue
            list.push({ key: item.key, item, mid: rect.top + rect.height / 2 })
          }
          list.sort((left, right) => left.mid - right.mid)
          return list
        }

        function reorderAt(clientY) {
          const drag = ui.drag
          if (drag === null || !drag.active) return
          const candidates = measureVisible(ui.items).filter((candidate) => candidate.key !== drag.key)
          let insertAt = 0
          while (insertAt < candidates.length && clientY > candidates[insertAt].mid) insertAt += 1
          const rest = state.order.filter((key) => key !== drag.key)
          let targetIndex
          if (insertAt < candidates.length) targetIndex = rest.indexOf(candidates[insertAt].key)
          else if (candidates.length > 0) targetIndex = rest.indexOf(candidates[candidates.length - 1].key) + 1
          else targetIndex = rest.length
          if (targetIndex < 0) targetIndex = rest.length
          const next = rest.slice(0, targetIndex).concat([drag.key], rest.slice(targetIndex))
          if (sameOrder(next, state.order)) return
          state.order = next
          state.updatedAt = Date.now()
          writeMirror()
          applyItems(ui.items, expectedPlan(ui.items, detectRail()).plan)
          updateLift(clientY)
        }

        function updateLift(clientY) {
          const drag = ui.drag
          if (drag === null || !drag.active || drag.row === null) return
          let rect
          try {
            rect = drag.row.getBoundingClientRect()
          } catch {
            return
          }
          const layoutTop = rect.top - drag.lift
          drag.lift = clientY - drag.grabOffset - layoutTop
          setStyle(drag.row, 'transform', drag.lift === 0 ? '' : `translateY(${drag.lift}px)`)
        }

        function startAutoScroll() {
          const drag = ui.drag
          if (drag === null || drag.raf !== 0) return
          const tick = () => {
            const current = ui.drag
            if (current === null || !current.active) return
            current.raf = 0
            let node = ui.nav
            while (node !== null) {
              if (node.scrollHeight > node.clientHeight + 4 && node.clientHeight > 0) {
                const rect = node.getBoundingClientRect()
                if (current.lastY < rect.top + 28) node.scrollTop -= 10
                else if (current.lastY > rect.bottom - 28) node.scrollTop += 10
                break
              }
              node = node.parentElement
            }
            current.raf = window.requestAnimationFrame(tick)
          }
          drag.raf = window.requestAnimationFrame(tick)
        }

        function beginDrag(event) {
          const drag = ui.drag
          if (drag === null) return
          drag.active = true
          drag.lift = 0
          drag.row.classList.add('dscm-dragging')
          if (ui.nav !== null) setAttr(ui.nav, 'data-dscm-drag', 'on')
          if (event.pointerType !== 'mouse') {
            drag.touchHandler = (touchEvent) => {
              const current = ui.drag
              if (current === null || !current.armed) return
              if (touchEvent.cancelable) touchEvent.preventDefault()
            }
            document.addEventListener('touchmove', drag.touchHandler, { passive: false })
          }
          startAutoScroll()
        }

        function onPointerMove(event) {
          const drag = ui.drag
          if (drag === null || event.pointerId !== drag.pointerId) return
          const dx = event.clientX - drag.startX
          const dy = event.clientY - drag.startY
          if (!drag.armed) {
            if (Math.abs(dx) > CANCEL_TOLERANCE_PX || Math.abs(dy) > CANCEL_TOLERANCE_PX) cancelDrag(false)
            return
          }
          if (!drag.active) {
            if (Math.sqrt(dx * dx + dy * dy) < DRAG_ACTIVATE_PX) return
            beginDrag(event)
          }
          if (event.cancelable) event.preventDefault()
          drag.lastY = event.clientY
          reorderAt(event.clientY)
          updateLift(event.clientY)
        }

        function onPointerUp(event) {
          const drag = ui.drag
          if (drag === null || event.pointerId !== drag.pointerId) return
          finishDrag(true)
        }

        function onPointerCancel(event) {
          const drag = ui.drag
          if (drag === null || event.pointerId !== drag.pointerId) return
          cancelDrag(true)
          finishDrag(false)
        }

        function onPointerDown(event) {
          if (ui.disposed || ui.nav === null) return
          if (event.button !== 0 && event.pointerType === 'mouse') return
          if (!ui.nav.contains(event.target)) return
          const row = closestFrom(event.target, 'button[class*="panelRow"]')
          if (row === null || !ui.nav.contains(row)) return
          if (closestFrom(row, `[${OWN}]`) !== null) return
          if (closestFrom(row, `[${HIDDEN_ATTR}]`) !== null) return
          const key = row.getAttribute(KEY_ATTR)
          if (key === null) return
          if (ui.pop !== null) closePopover()
          let rect
          try {
            rect = row.getBoundingClientRect()
          } catch {
            return
          }
          const drag = {
            pointerId: event.pointerId,
            key,
            row,
            armed: false,
            active: false,
            timer: 0,
            startX: event.clientX,
            startY: event.clientY,
            lastY: event.clientY,
            grabOffset: event.clientY - rect.top,
            lift: 0,
            startOrder: state.order.slice(),
            moveHandler: null,
            upHandler: null,
            cancelHandler: null,
            touchHandler: null,
            raf: 0,
          }
          ui.drag = drag
          drag.moveHandler = (moveEvent) => onPointerMove(moveEvent)
          drag.upHandler = (upEvent) => onPointerUp(upEvent)
          drag.cancelHandler = (cancelEvent) => onPointerCancel(cancelEvent)
          window.addEventListener('pointermove', drag.moveHandler, { passive: false })
          window.addEventListener('pointerup', drag.upHandler, false)
          window.addEventListener('pointercancel', drag.cancelHandler, false)
          drag.timer = window.setTimeout(() => {
            const current = ui.drag
            if (current === null) return
            current.armed = true
            current.row.classList.add('dscm-armed')
            try {
              current.row.setPointerCapture(current.pointerId)
            } catch {
              /* capture is an enhancement */
            }
          }, LONG_PRESS_MS)
        }

        function onClickCapture(event) {
          if (Date.now() >= ui.suppressClickUntil) return
          ui.suppressClickUntil = 0
          event.preventDefault()
          event.stopPropagation()
        }

        function onKeyDown(event) {
          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
          const row = closestFrom(event.target, 'button[class*="panelRow"]')
          if (row === null || ui.nav === null || !ui.nav.contains(row)) return
          if (row.closest(`[${OWN}]`) !== null) return
          const key = row.getAttribute(KEY_ATTR)
          if (key === null) return
          event.preventDefault()
          event.stopPropagation()
          moveKey(key, event.key === 'ArrowUp' ? -1 : 1)
        }

        /* ── observers & scheduling ────────────────────────────────────── */

        function attachObservers(nav) {
          detachObservers()
          ui.navObserver = new MutationObserver(() => {
            if (ui.drag !== null && ui.drag.active) return
            scheduleSync()
          })
          ui.navObserver.observe(nav, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'aria-label', 'aria-current', 'style', 'aria-haspopup'],
          })
          ui.root = findSidebarRoot(nav)
          if (ui.root !== null) {
            ui.rootObserver = new MutationObserver(() => {
              if (ui.drag !== null && ui.drag.active) return
              scheduleSync()
            })
            ui.rootObserver.observe(ui.root, { attributes: true, attributeFilter: ['class'] })
          }
        }

        function detachObservers() {
          if (ui.navObserver !== null) {
            ui.navObserver.disconnect()
            ui.navObserver = null
          }
          if (ui.rootObserver !== null) {
            ui.rootObserver.disconnect()
            ui.rootObserver = null
          }
        }

        function detachNav() {
          detachObservers()
          closePopover()
          if (ui.head !== null && ui.head.parentElement !== null) ui.head.parentElement.removeChild(ui.head)
          if (ui.hiddenHead !== null && ui.hiddenHead.parentElement !== null) {
            ui.hiddenHead.parentElement.removeChild(ui.hiddenHead)
          }
          ui.head = null
          ui.headCount = null
          ui.manageBtn = null
          ui.hiddenHead = null
          ui.hiddenChevron = null
          ui.hiddenText = null
          ui.hiddenBadge = null
          ui.items = []
          ui.byKey = new Map()
          ui.nav = null
          ui.root = null
          ui.sig = ''
        }

        /** Remove every mark this plugin left on host nodes (uninstall / HMR). */
        function releaseHostNodes() {
          for (const row of Array.from(document.querySelectorAll(`[${KEY_ATTR}]`))) {
            row.removeAttribute(KEY_ATTR)
          }
          for (const node of Array.from(document.querySelectorAll(`[${HIDDEN_ATTR}]`))) {
            node.removeAttribute(HIDDEN_ATTR)
            node.style.display = ''
          }
          for (const node of Array.from(document.querySelectorAll('[data-dscm-slot]'))) {
            node.removeAttribute('data-dscm-slot')
            node.style.order = ''
          }
          for (const node of Array.from(document.querySelectorAll(`[${OWN}]`))) {
            if (node.parentElement !== null) node.parentElement.removeChild(node)
          }
        }

        /**
         * Healthy = the marks we expect are still on the live nodes. A React
         * re-render can replace a row element without changing the item list,
         * and a collapse/expand changes only our rail attributes, so the
         * signature alone is not enough: verify every value this plugin writes.
         */
        function isHealthy(items, plan, nav) {
          if (ui.head === null || ui.head.parentElement !== nav) return false
          const rail = plan.rail === true
          if ((ui.head.getAttribute('data-rail') !== null) !== rail) return false
          if (ui.headCount !== null && ui.headCount.textContent !== t('head.count', { n: plan.visibleCount })) return false
          if (ui.hiddenHead === null || ui.hiddenHead.parentElement !== nav) return false
          if (((ui.hiddenHead.getAttribute('data-rail') !== null)) !== rail) return false
          const expectedHiddenDisplay = plan.hiddenCount === 0 ? 'none' : ''
          if ((ui.hiddenHead.style.display || '') !== expectedHiddenDisplay) return false
          if (plan.hiddenCount > 0) {
            if (ui.hiddenHead.getAttribute('aria-expanded') !== (state.expanded ? 'true' : 'false')) return false
            if (ui.hiddenText !== null && ui.hiddenText.textContent !== t('hidden.count', { n: plan.hiddenCount })) return false
            if (ui.hiddenChevron !== null && ui.hiddenChevron.hasAttribute('data-open') !== state.expanded) return false
          }
          for (const item of items) {
            const target = plan.get(item.key)
            if (target === undefined) return false
            if (item.node.getAttribute('data-dscm-slot') === null) return false
            if (item.row.getAttribute(KEY_ATTR) !== item.key) return false
            if ((item.node.style.order || '') !== String(target.order)) return false
            if ((item.node.style.display || '') !== (target.display || '')) return false
          }
          return true
        }

        function sync() {
          if (ui.disposed) return
          const nav = ui.nav !== null && ui.nav.isConnected ? ui.nav : findNav()
          if (nav === null) {
            if (ui.nav !== null) detachNav()
            scheduleRetry()
            return
          }
          if (nav !== ui.nav) {
            if (ui.nav !== null) detachNav()
            ui.nav = nav
            attachObservers(nav)
          }
          ensureHead(nav)
          ensureHiddenHead(nav)
          const items = collectItems(nav)
          ui.items = items
          ui.byKey = new Map(items.map((item) => [item.key, item]))
          const merged = resolveOrder(items)
          const rail = detectRail()
          const built = expectedPlan(items, rail)
          if (!merged && isHealthy(items, built, nav)) {
            if (ui.pop !== null) refreshPopover()
            return
          }
          applyItems(items, built.plan)
          updateHead(built)
          updateHiddenHead(built)
          ui.sig = `${state.order.join('\u0001')}|${state.hidden.slice().sort().join('\u0002')}|${state.expanded}`
          if (ui.pop !== null) refreshPopover()
          if (merged && ui.hydrated) saveSoon()
        }

        function noteStorm() {
          const now = Date.now()
          ui.syncTimes = ui.syncTimes.filter((time) => now - time < STORM_WINDOW_MS)
          ui.syncTimes.push(now)
          if (ui.syncTimes.length > STORM_LIMIT) {
            ui.suspendUntil = now + STORM_SUSPEND_MS
            ui.syncTimes = []
            window.setTimeout(() => {
              ui.suspendUntil = 0
              scheduleSync()
            }, STORM_SUSPEND_MS + 40)
          }
        }

        function scheduleSync() {
          if (ui.disposed) return
          if (Date.now() < ui.suspendUntil) return
          if (ui.timer !== 0) return
          ui.timer = window.setTimeout(() => {
            ui.timer = 0
            try {
              noteStorm()
              sync()
            } catch (error) {
              /* one failed pass must never kill the observer loop */
              if (window.console && typeof window.console.warn === 'function') {
                window.console.warn('dsh-sidebar-console: sync failed', error)
              }
            }
          }, 16)
        }

        function scheduleRetry() {
          if (ui.disposed || ui.retryTimer !== 0 || ui.retries > 40) return
          ui.retryTimer = window.setTimeout(() => {
            ui.retryTimer = 0
            ui.retries += 1
            scheduleSync()
          }, 500)
        }

        /* ── lifecycle ─────────────────────────────────────────────────── */

        function refreshDebug() {
          window.__DSH_SIDEBAR_CONSOLE__ = debugApi
        }

        function start() {
          if (ui.started || ui.disposed) return
          ui.started = true
          readMirror()
          ui.bodyObserver = new MutationObserver(() => {
            if (ui.nav === null || !ui.nav.isConnected) scheduleSync()
          })
          ui.bodyObserver.observe(document.body, { childList: true, subtree: true })
          document.addEventListener('pointerdown', onPointerDown, true)
          document.addEventListener('click', onClickCapture, true)
          document.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('resize', scheduleSync)
          // Collapsing is a host class change on an ancestor; poll it cheaply so the
          // rail layout can never get stuck when no observer mutation reaches us.
          ui.railPoll = window.setInterval(() => {
            if (ui.disposed || ui.nav === null) return
            const rail = detectRail()
            if (ui.railState !== rail) {
              ui.railState = rail
              scheduleSync()
            }
          }, 400)
          refreshDebug()
          scheduleSync()
          loadHostState()
        }

        function stop() {
          if (ui.disposed) return
          ui.disposed = true
          if (ui.saveTimer !== 0) window.clearTimeout(ui.saveTimer)
          if (ui.timer !== 0) window.clearTimeout(ui.timer)
          if (ui.retryTimer !== 0) window.clearTimeout(ui.retryTimer)
          if (ui.railPoll !== 0) window.clearInterval(ui.railPoll)
          dragCleanup(true)
          if (ui.bodyObserver !== null) ui.bodyObserver.disconnect()
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('click', onClickCapture, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', scheduleSync)
          closePopover()
          detachNav()
          releaseHostNodes()
          writeMirror()
          if (window.__DSH_SIDEBAR_CONSOLE__ === debugApi) delete window.__DSH_SIDEBAR_CONSOLE__
          if (window.__dshSidebarConsoleDispose === stop) window.__dshSidebarConsoleDispose = null
        }

        const debugApi = {
          version: '0.1.0',
          getState() {
            return {
              order: [...state.order],
              hidden: [...state.hidden],
              expanded: state.expanded,
              updatedAt: state.updatedAt,
              hydrated: ui.hydrated,
            }
          },
          getItems() {
            const hidden = hiddenSet()
            return ui.items.map((item) => ({ key: item.key, label: item.label, hidden: hidden.has(item.key) }))
          },
          getDom() {
            return {
              nav: ui.nav !== null,
              rows: ui.items.length,
              head: ui.head !== null && ui.head.isConnected,
              hiddenHead: ui.hiddenHead !== null && ui.hiddenHead.isConnected,
              popover: ui.pop !== null,
              rail: detectRail(),
              domOrder: Array.from(ui.nav !== null ? ui.nav.children : []).map((node) =>
                node.hasAttribute(OWN) ? `own:${node.getAttribute(OWN)}` : node.querySelector('button[class*="panelRow"]')?.getAttribute('aria-label') || '?',
              ),
              visualOrder: ui.items
                .slice()
                .sort((left, right) => Number(left.node.style.order || 0) - Number(right.node.style.order || 0))
                .map((item) => item.label),
            }
          },
          sync() {
            scheduleSync()
            return true
          },
          syncNow() {
            try {
              sync()
              return true
            } catch (error) {
              return String(error && error.message ? error.message : error)
            }
          },
          setExpanded(value) {
            state.expanded = value === true
            commitChange()
            return state.expanded
          },
          openManager() {
            openPopover()
            return ui.pop !== null
          },
          closeManager() {
            closePopover()
          },
          setOrder(keys) {
            if (!Array.isArray(keys)) return false
            state.order = keys.filter((key) => typeof key === 'string')
            commitChange()
            return true
          },
          setHidden(keys) {
            if (!Array.isArray(keys)) return false
            state.hidden = []
            for (const key of keys) if (typeof key === 'string' && !state.hidden.includes(key)) state.hidden.push(key)
            commitChange()
            return true
          },
          move(key, direction) {
            moveKey(key, direction < 0 ? -1 : 1)
            return true
          },
          flush() {
            flushSave()
            return true
          },
        }

        return { start, stop, scheduleSync, debugApi }
      }

      /* ── client plugin object ──────────────────────────────────────────── */

      /**
       * Register this plugin's dictionaries without aborting a second apply.
       * `LocaleRuntime.register` now throws on a duplicate namespace+locale
       * (0.2.2-rc.3), and a re-applied client module (HMR, a duplicate entry)
       * would otherwise take the whole plugin down with it.
       * @param {*} locale - the client locale service (`ctx.locale`).
       * @returns {() => void} an idempotent disposer.
       */
      function registerDictionaries(locale) {
        if (locale === null || typeof locale !== 'object' || typeof locale.register !== 'function') return () => {}
        try {
          const dispose = locale.register(NS, { en: EN, zh: ZH })
          return typeof dispose === 'function' ? dispose : () => {}
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!/already has locale/.test(message)) throw error
          return () => {}
        }
      }

      return {
        inject: ['slots', 'locale'],
        apply(ctx) {
          try {
            const t = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : (key) => key
            ctx.effect(() => registerDictionaries(ctx.locale), 'dsh-sidebar-console: dictionaries')
            ctx.effect(() => {
              const style = document.createElement('style')
              style.setAttribute('data-dsh-sidebar-console', '')
              style.textContent = CSS
              document.head.appendChild(style)
              return () => style.remove()
            }, 'dsh-sidebar-console: styles')
            const manager = createManager(ctx, t)
            ctx.effect(() => {
              // HMR / duplicate apply: one engine per document.
              if (typeof window.__dshSidebarConsoleDispose === 'function') {
                try {
                  window.__dshSidebarConsoleDispose()
                } catch {
                  /* a stale engine must not block the new one */
                }
              }
              window.__dshSidebarConsoleDispose = () => manager.stop()
              manager.start()
              return () => manager.stop()
            }, 'dsh-sidebar-console: engine')
            ctx.effect(
              () => ctx.slots.subscribe('sidebar.panellist', () => manager.scheduleSync()),
              'dsh-sidebar-console: panel entries',
            )
            ctx.effect(() => ctx.locale.subscribe(() => manager.scheduleSync()), 'dsh-sidebar-console: labels')
          } catch (error) {
            // A dead feature is recoverable; an unmountable module is not.
            if (window.console && typeof window.console.warn === 'function') {
              window.console.warn('dsh-sidebar-console: apply failed', error)
            }
          }
        },
      }
    },
  })
})()

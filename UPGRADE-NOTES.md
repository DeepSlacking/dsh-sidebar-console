# dsh-sidebar-console 兼容性迁移说明

- 迁移对象：`dsh-sidebar-console` 0.1.0 → 0.1.1
- 运行中的 DSH：`0.2.2-rc.3`（`D:\DeepSeek-HarnessDesktop\resources\app.asar`，桌面端 Web profile）
- 直接触发：清单里的 `engines.dsh` 只列到 `0.2.2-rc.1`，不含 `0.2.2-rc.2 / rc.3`。

## 事实来源

- 安装目录里的升级指南缺失（`%DSH_HOME%/profiles/desktop/plugin-steward/guides` 为空），因此改为直接读运行中安装的 `@deepseek-ai/*` 源码：该安装是单文件 `app.asar`，我用临时脚本解析 asar 头，把
  `@deepseek-ai/dsh`、`dsh-app-boot`、`dsh-client-modules`、`dsh-client-connection`、`dsh-client-locale`、
  `dsh-client-ui-renderer`、`dsh-client-ui-sidebar`、`dsh-home-paths`、`cordis` 的 `src/` 与 `lib/` 解出来逐个核对（脚本放在系统临时目录，没有写进插件目录）。
- 结论一律以这些源码里的类型/实现为准，没有凭记忆推断 API。

## 逐项核对结果与处理

| # | 插件用到的点 | 0.2.2-rc.3 现状 | 处理 |
|---|---|---|---|
| 1 | `engines.dsh` | 运行时用 semver `satisfies(runtimeVersion, range)` 评估插件清单，且提供 `dsh plugin allow-version` 逃生口；旧串不匹配 rc.3 | 扩到 `… || 0.2.2-rc.2 || 0.2.2-rc.3`（`package.json` + `dsh.plugin.json` 两处同步） |
| 2 | `ctx.locale.register(NS, { en, zh })` | 2 参/3 参两种重载都还在；**新增**「同一 namespace + locale 重复注册直接抛错」（`locale namespace "x" already has locale "y"`） | 新增 `registerDictionaries()`：重复注册降级为 no-op，locale 服务缺失时也返回空释放器；避免二次 apply（HMR / 重复条目）把整个插件带崩 |
| 3 | `ctx.locale.bind(ns)`、`ctx.locale.subscribe(fn)` | 未变（subscribe 仍返回 `() => void`） | 只加了 `bind` 缺失时的兜底翻译函数 |
| 4 | `ctx.slots.subscribe('sidebar.panellist', fn)`、`entriesOfSlot(...)` | 方法都在；但 `entry.options.label` 现在可以是 `LocalizedText`（字符串 / 工厂函数 / `{ en, zh, … }`），侧栏会先 `resolveSlotLabel` 再写 `aria-label` | 新增 `activeLocaleId()` + `resolveSlotLabel()`，按当前语言 → `zh` → `en` 解析，和宿主写 DOM 的取值保持一致；否则行与注册 id 对不上，key 会退化成 `label:文本`，已保存的排序/隐藏会“莫名其妙失效” |
| 5 | `connection.fetch.register({ path, methods, requestBody, fetch })` | 形参与路由匹配规则未变（path 必须以 `/api/` 开头，本插件是 `/api/dsh-sidebar-console/*`）；**返回值变成 `() => Promise<void>`** | 同步 effect cleanup 里无法 await，改为 try/catch 并观测返回的 promise，避免 unhandled rejection |
| 6 | `dshHomePath('storages', …)`（`lib/store.js`） | 未变 | 不改 |
| 7 | 客户端入口 `window.__ModuleLoader__.load({ id, factory })` 与 `{ inject: ['slots','locale'], apply(ctx) }` | 未变（同版本官方 bundle 也是这个形状） | 不改 |
| 8 | 侧栏 DOM：`nav[class*=panelList]`、`button[class*=panelRow]`、`[class*=moreAnchor]`、`[class*=panelTitle]`、`_root`/`_collapsed` | 类名仍是 `<哈希>_panelList` / `<哈希>_panelRow` / `<哈希>_root` / `<哈希>_collapsed`，片段匹配成立；**但每个面板行外面多了一层 `div[class*=panelEntry]`**，「更多」仍是 `moreAnchor` 包裹层里的 `button[aria-haspopup="menu"]` | 插件本来就是「遍历 nav 直接子节点 → 在其中找行按钮」，有无包裹层都能命中，逻辑无需改；已把 README 的宿主结构契约更新为 rc.3 的实情 |
| 9 | 宿主新增「固定 / 取消固定」面板 | `sidebar.panellist` 里未固定（unpinned）的面板**不再渲染进 nav** | 代码未改，记录为已知行为：控制台只能管理当前渲染出来的项 |

## 改动文件

- `client.js`：`activeLocaleId` / `resolveSlotLabel` / `registerDictionaries` 三处；`panelEntries()` 改用统一解析；`apply()` 里的字典注册改为幂等。
- `index.js`：路由注册的释放函数按 rc.3 的异步契约处理。
- `package.json`：`version 0.1.1`、`engines.dsh` 扩展、`peerDependencies` 收紧（`@deepseek-ai/cordis` `~4.1.0`、`@deepseek-ai/dsh-home-paths` `>=0.2.1-rc.3 <0.2.3`）。
- `dsh.plugin.json`：`version`、`engines.dsh` 与 package.json 同步。
- `README.md`：目标版本与宿主 DOM 契约的描述更新。
- `UPGRADE-NOTES.md`：本文件。

## 验证

- `node --check client.js`、`node --check index.js`、`node --check lib/store.js` 全部通过。
- `package.json` / `dsh.plugin.json` 可 `JSON.parse`，两个清单的 `version` 与 `engines.dsh` 一致。
- 未执行 `pnpm add` / `npm install`；未改 profile 的 `package.json` / `cordis.patch.yml`；插件守护的备份目录（`.dsh/profiles/desktop/plugin-steward/backups/dsh-sidebar-console/…`）保持原样。

## 未验证 / 仍需确认

1. **端到端未验证（最重要）**：页面需要 401 token，我没有可用的 devtools/CDP 通道，无法在真实页面里确认插件已渲染。
   对运行中窗口截图，左侧栏看不到本插件注入的「N 项 + 管理按钮」行；我倾向于是清单版本门禁导致整行未挂载（运行时确实内置了 `engines.dsh` 兼容性评估和 `allow-version` 逃生口），但**没有在源码里定位到分发加载时跳过 bundle 的确切调用点**，所以这一点只能算推断，不能算已验证。
   建议复验：重启 DSH 后看左侧栏顶部是否出现「N 项」行；或在页面控制台执行 `window.__DSH_SIDEBAR_CONSOLE__.getDom()`。
2. `0.2.2-rc.2` 未实测，只是与 rc.3 相邻、按同一套 API 处理；如果要求严格，把 `engines` 里的 rc.2 去掉即可。
3. `dsh-home-paths` 的 peer 用的是范围（`>=0.2.1-rc.3 <0.2.3`），没有在 0.2.1-rc.x 上回归。
4. 「取消固定」的面板不渲染进 nav，本插件管不到；要覆盖它需要宿主提供面板状态 API（当前只有 DOM 可抓）。
5. 生效方式：**必须重启 DSH**（host 行 + 客户端 bundle 都按启动时组合），重启后如果只改了 client 侧也可以用页面刷新验证。

# 更新日志

`dsh-sidebar-console` 的版本变更记录。版本号遵循语义化版本；`engines.dsh` 声明目标 DSH 区间。

## 0.1.4 — 2026-11-20

### 修复

- **宿主日志调用**：Cordis 的 `ctx.logger` 是 `LoggerService`（函数），原写法 `ctx.logger?.info?.(…)` 永远是静默 no-op；改为 `ctx.logger('sidebar-console').info(…)`，日志真正落到宿主 logger。
- **管理弹层与窗口拖拽**：弹层是挂到 `body` 的 fixed 覆盖层，重新声明 `data-window-drag-exclude`，避免 macOS 桌面端把弹层区域当作窗口拖拽区（0.2.2-rc.2+ 的拖拽规则只自动排除 `data-window-drag` 行内的控件）。
- **调试接口版本号**：`window.__DSH_SIDEBAR_CONSOLE__.version` 由 `0.1.0` 同步为 `0.1.4`，与包版本一致（此前停留在首个版本）。

### 变更

- **版本门禁改为区间**：`package.json` 与 `dsh.plugin.json` 的 `engines.dsh` 由精确白名单改为 `>=0.2.1-rc.3 <0.3.0-0`，覆盖 0.2 全系（含预览版），上界同时挡住 `0.3.0-rc.*`。DSH 只按该字段判定插件兼容性，精确白名单会随每个宿主版本失效并静默停用插件。
- **清单版本对齐**：`dsh.plugin.json` 的 `version` 由 `0.1.1` 补到 `0.1.4`，与 `package.json` 一致。
- **README 兼容性章节**：按 DSH `0.2.2-rc.5` 实况重写中英文兼容性说明，徽章改为 `DSH-0.2.x`，并补充「版本门禁」注意事项。
- **发布内容**：`files` 纳入 `docs/screenshots/*.png` 与 `CHANGELOG.md`，安装包自带 README 截图与变更记录。

## 0.1.2 — 2026-11-16

### 变更

- 双语 README（中文默认 + `README.en.md`），补充 MIT 许可章节与界面截图。

## 0.1.1

### 变更

- 兼容 DSH `0.2.2-rc.3`：`engines.dsh` 扩展；`LocalizedText` 面板标签解析（`activeLocaleId` / `resolveSlotLabel`），避免标签是 `{ en, zh }` 映射时行与注册 id 对不上、已保存的排序与显隐失效；locale 重复注册防护（`registerDictionaries`）；`connection.fetch.register()` 返回异步释放器后的安全清理。细节见 [UPGRADE-NOTES.md](UPGRADE-NOTES.md)。

## 0.1.0

### 新增

- 首个版本：长按拖动排序、顺序固定（存储于 `$DSH_HOME/storages/dsh-sidebar-console/layout.json`）、统一管理弹层、逐项显隐、隐藏项折叠区、折叠侧栏图标轨适配。

# dsh-sidebar-console · 侧栏控制台管理

DeepSeek Harness（DSH）Web 端左侧控制台（全局面板列表）管理器。装得越多、侧栏越乱的问题，用这个插件把「顺序」和「显隐」交还给你。

![侧栏控制台管理](https://img.shields.io/badge/DSH-0.2.2--rc.1-4176e6) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能

| 需求 | 实现 |
| --- | --- |
| 长按拖动排序 | 在左侧任意面板项上**长按 300ms** 后上下拖动即可换位；无需抓取按钮或进入编辑模式。拖动时被拖项半透明跟随指针，其余项实时让位 |
| 排序固定，不被插件更新重排 | 顺序按面板 **id** 持久化在 Host（`$DSH_HOME/storages/dsh-sidebar-console/layout.json`）。已保存的项永远按你的顺序显示，插件更新只影响它自己的 `order` 声明，不会移动你排好的位置；新装插件追加在末尾，拖一次即可 |
| 统一管理按钮 | 面板列表最上方一行：左侧显示**未隐藏项数量**（`N 项`），右侧是带图标的**管理**按钮，点开一个管理弹层 |
| 批量显示/隐藏 | 管理弹层里每个面板一行：图标 + 名称 + 显隐开关 + 上移/下移按钮；顶部有 **全部显示 / 全部隐藏 / 恢复默认排序** 三个批量操作 |
| 隐藏项收纳 | 被隐藏的项从列表中移除，列表最底部出现 **已隐藏 N 项** 行，行内箭头图标可展开/收起被隐藏的项（展开后照常点击可打开对应页面） |
| 折叠侧栏兼容 | 侧栏收成图标轨（rail）时，管理入口与隐藏区自动缩成 36×36 图标行，数量以角标显示 |

其它细节：

- **键盘可达**：聚焦任意面板项后 `Alt+↑` / `Alt+↓` 可上下移动；管理弹层里的按钮都是原生 `button`，开关是 `role="switch"`。
- **不移动 React 节点**：只用 `style.order` / `style.display` / 自有 `data-*` 标记实现，宿主重渲染后自动重放；不改宿主代码、不 patch 官方包。
- **类名哈希无关**：选择器只用类名片段（`panelList` / `panelRow` / `moreAnchor` / `collapsed`），DSH 升级换哈希前缀不影响。
- **多端一致**：布局存在 Host，页面重启、换端口、浏览器本地数据被清都不会丢（localStorage 仅作首屏镜像）。
- **卸载即还原**：插件卸载/重载时会清掉所有写在宿主节点上的 `order` / `display` / 标记，侧栏恢复官方原始状态。

## 安装

方式一（推荐，插件管理器）：

```text
plugin_manager action=install_bundle target=D:\DSH-workspace\dsh-sidebar-console
```

或在 profile 目录手动安装：

```bash
cd C:/Users/<you>/.dsh/profiles/desktop
npm install "file:D:/DSH-workspace/dsh-sidebar-console"
# 然后把 "dsh-sidebar-console" 加进 package.json 的 dsh.profile.bundles，
# 并在 cordis.patch.yml 加一行：
#   - insert:
#       - id: dsh-sidebar-console
#         name: dsh-sidebar-console
```

安装后**重启 DSH 桌面端**（或按界面提示重启）加载插件；首次载入后侧栏顶部即出现计数 + 管理按钮。

## 使用

1. **排序**：按住任意面板项约 0.3 秒，拖动到目标位置后松开。松手即保存；刷新、重启都保持。
2. **管理**：点列表最上方的滑块图标 → 打开「控制台项目」。
   - 单个：点行尾开关隐藏/显示该项；行内 `↑`/`↓` 微调顺序。
   - 批量：`全部显示` / `全部隐藏`；`恢复默认排序` 回到官方注册顺序。
3. **隐藏区**：隐藏 ≥1 项后，列表底部出现「已隐藏 N 项」，点它展开/收起。

> 「更多」行（宿主自带的 More 菜单入口）也作为一项参与排序与显隐；即使把它隐藏，也能通过顶部管理按钮重新显示，不会把自己锁在门外。

## 数据与接口

- 状态文件：`$DSH_HOME/storages/dsh-sidebar-console/layout.json`（原子写入，先写临时文件再 rename）
- 状态结构：

```json
{ "version": 1, "order": ["<panel id>", "..."], "hidden": ["<panel id>"], "expanded": false, "updatedAt": 0 }
```

- Host 路由（Connection 精确路由，仅 owner 浏览器可用，POST JSON）：
  - `POST /api/dsh-sidebar-console/state` → `{ok:true, value: layout}`
  - `POST /api/dsh-sidebar-console/save` → `{ok:true, value: layout}`（body 为 layout）

## 目录

```
dsh-sidebar-console/
├─ package.json        dsh 清单：bundle patch + client 平台/注入顺序
├─ cordis.patch.yml    仅一条 insert 宿主行
├─ index.js            Host 半：连接路由 + 布局存储
├─ lib/store.js        原子 JSON 存储、清洗与合并
├─ client.js           浏览器半：长按拖动、管理弹层、隐藏区、重放循环
├─ locale/{zh,en}.json 插件管理器显示用的标题/描述
├─ icon.svg            插件图标
└─ dsh.plugin.json     插件市场元数据
```

## 兼容性

- 目标版本：DSH `0.2.1-rc.3` ~ `0.2.2-rc.3`（Web 端；桌面/浏览器一致；`0.2.2-rc.3` 为本次兼容性迁移的实测版本）。
- 依赖的宿主结构（0.2.2-rc.3 复核）：`nav[class*=panelList]` 是侧栏根节点内的面板列表，面板行统一为 `button[class*=panelRow]`；0.2.2-rc.3 起每个面板行外面多了一层 `div[class*=panelEntry]`，本插件按「遍历 nav 的直接子节点、再在其中查找行按钮」的方式匹配，因此有/无包裹层都能工作。「更多」入口在 `[class*=moreAnchor]` 包裹层内，行按钮带 `aria-haspopup="menu"`；折叠态由祖先类名片段 `_collapsed` 表示（实际类名为 `<哈希>_collapsed`）。
- 若 DSH 大改侧栏结构，插件会静默降级（找不到 nav 就不做任何修改），不会报错或破坏界面；升级后如功能消失，先看浏览器控制台是否有 `dsh-sidebar-console: sync failed`。

## 验证

- E2E（真实 DSH 0.2.2-rc.1 + 独立 profile + headless Edge/CDP）：`node e2e/cdp.mjs --url "<token url>" --script e2e/verify-console.mjs`
- 覆盖：插件加载、长按拖动排序、计数变化、单项隐藏、隐藏区展开、整页刷新后的顺序/显隐/展开态持久化、批量全部显示、折叠侧栏 rail、控制台无报错。
- 最近一次结果：**10/10 通过**（报告与截图：`.tmp/e2e/console-verify.json`、`e2e/shots/c1..c7-*.png`）。

## 已知边界

- 触摸设备上，长按后需要继续按住再拖动（移动端浏览器会先给滚动手势；桌面端体验最完整）。
- 宿主面板极多时列表会随侧栏自然延伸；排序/隐藏仍可用，但没有额外加滚动条高度上限（避免改变宿主布局）。
- 顺序/显隐是**本机这份安装**的偏好，不随工作区或账号同步。

## 许可

MIT。

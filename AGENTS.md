# AGENTS.md — 面向 Codex 的开发指南

本文件供 AI 编码助手（Codex）在本仓库中工作时遵循。所有实现细节以 `SPEC.md` 为准，本文件约定的是**协作方式、代码规范与验收流程**。

## 1. 在开始写代码之前

1. 完整阅读 `SPEC.md`，不要只读涉及当前任务的章节——很多边界情况（§5）会影响你正在实现的模块的接口设计。
2. 如果 `SPEC.md` 中某个描述与你计划的实现方式冲突，**先在对应任务的 PR/commit 描述中说明冲突点和你的处理方案**，不要静默改变约定的架构（如把 `background.ts` 的职责挪到 content script，或反过来）。
3. 本项目使用 **WXT + TypeScript**（Vanilla 模板，不引入 React/Vue/Svelte 等 UI 框架）作为脚手架，见 SPEC.md §4.1、§4.0。**不要脱离 WXT 的 `entrypoints/` 目录约定自建入口文件**，也不要手写 `manifest.json`（由 WXT 根据 `wxt.config.ts` 自动生成）。
4. 如果任务要求的功能确实需要引入 UI 框架或额外依赖（例如后续做标注编辑器），**先在 §7 列出的"需人工确认"环节向人类协作者确认**，不要自行决定引入。

## 2. 技术约束（硬性要求）

- **Manifest V3**，禁止使用 MV2 API（如 `background.page`、`chrome.extension.getBackgroundPage` 等）。所有 manifest 相关字段（`name`、`permissions`、`description` 等）统一写在 `wxt.config.ts` 的 `manifest` 字段里，**禁止手动创建或编辑 `manifest.json`**。
- **权限最小化**：新增任何 `permissions` / `host_permissions` 前，先确认 SPEC.md §6.1 是否已列出；如需新增未列出的权限，必须在代码注释和 commit message 中说明具体用途，避免"以防万一"式的权限申请（这会直接影响商店审核通过率）。
- **禁止引入远程脚本/远程配置执行逻辑**：所有截图、拼接、下载逻辑必须在扩展包内完成，不得 `fetch` 远程 JS 并 `eval`/动态执行（这是 Chrome Web Store 审核的高频拒绝原因）。此规则同样适用于 npm 依赖——新增任何依赖前，先确认它不会在运行时拉取远程可执行代码。
- **禁止上传任何页面数据到远程服务器**：整个项目不应出现任何 `fetch`/`XMLHttpRequest` 指向第三方域名的截图/内容上传逻辑。如果测试阶段需要日志或错误上报，仅允许输出到 `console`，不得远程上报。
- **`chrome.tabs.captureVisibleTab` 只能在 `entrypoints/background.ts`（service worker）中调用**，content script 侧一律通过 `chrome.runtime.sendMessage` 请求，不要尝试绕过这个边界。
- **裁剪坐标计算必须使用物理像素**（`getBoundingClientRect()` 值 × `devicePixelRatio`），任何涉及坐标计算的代码变更，需要在注释里写明当前用的是 CSS 像素还是物理像素，避免后续维护者搞混（这是本项目历史上最容易出 bug 的地方）。建议在 `lib/types.ts` 里用类型区分两种像素单位（例如 `CssPixels` / `DevicePixels` 的 branded type），从类型层面减少混用风险。
- **任何对页面 DOM/CSS 的临时修改（如隐藏 fixed 元素、修改 scrollTop）必须保证可还原**，用 `try/finally` 或等价机制确保即使中途报错也会执行还原逻辑。写这类代码时，先写还原逻辑，再写修改逻辑。
- **service worker 不持有跨消息的模块级可变状态**：`entrypoints/background.ts` 随时可能被 Chrome 回收重启，需要跨消息保留的状态通过消息参数传递，或使用 `chrome.storage.session`，不要依赖顶层变量。

## 3. 代码风格

- TypeScript，`strict` 模式开启（沿用 WXT 脚手架默认生成的 `tsconfig.json`，不要放宽 strict 检查项）。
- `const`/`let`，禁止 `var`。
- 异步流程统一用 `async/await`，不要混用回调风格（`chrome.tabs.captureVisibleTab` 等旧式回调 API 需要用 `new Promise()` 包一层，或使用 WXT/`webextension-polyfill` 提供的 Promise 化 API）。
- 所有跨模块共享的类型（消息 payload、裁剪框结构等）集中定义在 `lib/types.ts`；消息类型常量集中定义在 `lib/constants.ts`，禁止在多个文件里各自写重复的字符串字面量。
- 函数命名清楚表达"是否有副作用"，例如 `captureVisibleTabAsync()` vs `computeClipRect()`（纯函数）。涉及 DOM 修改的函数名前缀统一用 `apply`/`restore`，如 `applyHideFixedElements()` / `restoreHiddenElements()`。
- 涉及消息通信的函数，入参/出参必须有明确的 TypeScript 类型标注（引用 `lib/types.ts` 中的类型），不允许用 `any` 兜底传递消息内容。

## 4. 提交前自检清单

在提交任何一个功能模块之前，逐条确认：

- [ ] 是否新增了 SPEC.md §6.1 之外的权限？如有，是否已经说明理由？
- [ ] 是否有 DOM/CSS 的临时修改逻辑？是否配了对应的还原逻辑，并且用 `try/finally` 兜底？
- [ ] 涉及坐标/尺寸计算的代码，是否明确区分了 CSS 像素与物理像素？
- [ ] `pnpm dev` 启动后，是否在实际 Chrome 中加载测试过（而不是只做静态代码检查 / `tsc` 通过）？
- [ ] Service worker（`entrypoints/background.ts`）相关代码是否考虑了它可能被 Chrome 随时回收、重新唤醒的情况？
- [ ] `pnpm build` 生成的 `.output/` 产物中,manifest 权限清单是否与预期一致（可直接打开生成的 `manifest.json` 核对，虽然源码里不手写它，但要核对生成结果）？

## 5. 测试策略

项目暂不引入端到端自动化测试框架（截图类插件的核心价值依赖真实浏览器渲染，单元测试收益有限）。`lib/capture.ts`、`lib/stitch.ts` 中的纯逻辑部分（坐标计算、裁剪框拼接等不直接依赖 DOM 事件的函数）如果任务中要求，可以补充 Vitest 单元测试，但涉及真实滚动/截图效果的验证，仍以下面的手动流程为准：

1. 使用 `pnpm dev` 启动开发模式，WXT 会自动拉起 Chrome 并加载扩展，改动后自动热更新，不需要手动去 `chrome://extensions` 点重新加载。
2. 准备至少 3 个测试页面（放在 `test-pages/` 目录下，作为本地静态 HTML，方便复现）：
   - 简单场景：一个 `overflow:auto` 的 `<div>`，内容为纯文本，无嵌套滚动祖先
   - 复杂场景：目标元素套在多层祖先中，祖先分别包含 `transform: scale(0.8)`、`display:flex`、`overflow:hidden` 等干扰样式（复现本项目最初讨论中提到的痛点）
   - 高分屏场景：无需单独 HTML，用同一页面在系统层面切换/模拟 `devicePixelRatio`（Chrome DevTools 可以模拟设备像素比）测试
3. 每次修改后，对这三个场景分别执行一次完整截图流程，人工核对：
   - 拼接图是否与手动滚动到底、逐屏截图的结果内容一致（无重复行、无缺失行）
   - 高分屏下图片是否清晰
   - 截图结束后原页面是否完全恢复（滚动位置、被临时隐藏的元素）

## 6. Git 提交规范

- 每个 commit 聚焦单一改动（如"实现 background 消息监听" / "修复高分屏裁剪坐标计算"），不要把 UI 调整和核心截图逻辑改动混在同一个 commit。
- commit message 使用中文或英文均可，但需要说明"做了什么"和"为什么"，尤其是涉及 §2 硬性约束相关的改动（如新增权限、修改坐标计算方式），必须在 message 里写清楚原因。

## 7. 何时需要人工确认（不要自行决定）

以下情况请在继续实现前，先向人类协作者确认，而不是自行选择一种方案后直接实现：

- 是否要支持 §3.2 中列出的"后续迭代"功能（这些不在 MVP 范围，除非明确要求，不要提前实现，避免增加不必要的权限/复杂度，影响首次上架审核）
- 是否要支持 iframe 内元素选取（涉及 `all_frames: true` 权限扩大，SPEC.md 中明确列为 MVP 不支持）
- 拼接大图时是否使用 `OffscreenCanvas`（MV3 中 service worker 和 content script 均可用）还是新建 `offscreen document`——两者都可行，但影响文件结构，选定后请更新 SPEC.md §4.2 的文件结构描述，保持文档与代码同步
- 图标、商店截图、宣传图等设计资产的风格/文案（这些属于产品决策，非纯技术实现）

## 8. 与 SPEC.md 保持同步

如果在实现过程中发现某个技术方案与 SPEC.md 描述不一致（例如决定用 offscreen document 而不是 content script 做拼接），**必须同步更新 SPEC.md 对应章节**，不要让文档和代码逐渐脱节。文档更新和代码改动应在同一个 PR/提交批次中完成。
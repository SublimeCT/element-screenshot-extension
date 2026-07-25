# Screenshot Suite

网页滚动截图工具

> 本项目尚未发布到 Chrome Web Store,当前仅供本地开发和测试使用。

一个 Chrome 扩展,用于**截取页面中某一个具体元素的完整内容**——即使该元素自身设置了固定高度并出现了滚动条,或者它的多层祖先元素存在固定高度、`overflow:hidden`、`transform: scale()`、flex/grid 布局限制等干扰样式。

## 为什么需要这个插件

浏览器原生的截图能力(DevTools 的 `Capture node screenshot`、`Capture full size screenshot`)以及市面上常见的全页截图插件(如 GoFullPage),要么只能截取当前可视区域,要么是针对**整个页面**设计的,面对下面这种场景往往力不从心:

- 想截的是**某一个元素**,不是整个页面
- 该元素内部内容超出了自身高度,出现了滚动条
- 元素外面还套着好几层祖先元素,这些祖先也各自有固定高度、裁切、缩放等样式

## 工作原理

插件不展开或重排目标元素,而是:

1. 让用户点选页面上的目标元素
2. 判断该元素是否是滚动容器,如果是,按其可视高度为步长自动滚动
3. 每滚动一步,调用 `chrome.tabs.captureVisibleTab` 截取当前可视区域的真实渲染像素
4. 根据元素在视口中的实际位置(`getBoundingClientRect()`,已包含 transform/flex/grid 等布局变换后的最终结果)裁剪出对应区域
5. 将所有截图按顺序拼接成一张完整长图,导出为 PNG

由于截取的是浏览器已经渲染好的真实像素,不依赖修改样式展开高度,因此不受祖先元素的缩放、裁切、布局方式等干扰。选取遮罩会在截图前移除;截图期间只滚动目标元素,并临时隐藏与目标区域重叠的无关 fixed/sticky 元素。

## 当前状态

- **尚未发布**,不可从 Chrome Web Store 安装
- 项目正在按 [`SPEC.md`](./SPEC.md) 描述的方案开发中,可关注该文档了解详细设计与已知边界情况

## 截图模式

- **区域截图**:点击页面元素。选取器会把点击节点提升为最近的、确实存在溢出的 `overflow:auto/scroll` 祖先；找不到时截取点击节点本身。
- **整页截图**:默认选择页面根元素；根元素不可滚动时选择第一个可滚动下级元素,并对实际选中的目标自动滚动、拼接和导出。
- **元素截图**:点击后固定使用实际点击的 DOM 元素，同时滚动其可滚动父元素，只裁剪该元素区域，不自动提升截图目标。
- **聚焦截图**:点击目标后用临时 CSS 展开祖先链并隐藏祖先链外分支，通过根页面滚动截取目标；截图完成或中断后移除全部临时 CSS。
- **手动滚动截图**:选择页面或元素区域,确认后先截初始帧；用户手动滚动,每次停止后采集一帧,按任意键结束并按实际距离裁剪重叠后拼接。
- **全部滚动元素**:发现页面中的可滚动元素并串行截图，输出本地 ZIP；任一目标失败时整批失败,不生成缺文件的部分 ZIP。

自动滚动截图会先探测实际高度，在懒加载导致高度增长时追加有限分段；截图中按 `Esc` 或点击页面可中断。用户选择的隐藏元素会在截图帧中显示为半透明，固定/吸顶遮挡会临时隐藏；所有临时样式和滚动位置始终恢复。设置中的滚动间隔、是否恢复编辑内容、预览和界面语言会保存在扩展 popup 的本地设置中，语言默认跟随浏览器语言。

## 功能范围(MVP)

- [x] 手动选取页面上任意一个元素
- [x] 目标元素自身可滚动时,自动滚动并拼接完整内容
- [x] 目标元素不可滚动时,直接截取其当前可视区域
- [x] 导出为 PNG,自动下载
- [x] 支持高分屏(devicePixelRatio)不失真

暂不支持(见 `SPEC.md` §3.2/§3.3):自由框选、跨 iframe 元素选取、横向滚动、PDF 导出、剪贴板复制、截图标注。

## 技术栈

- [WXT](https://wxt.dev) — 基于 Vite 的现代 Web Extension 框架
- TypeScript(Vanilla 模板,不依赖 UI 框架)
- Manifest V3
- pnpm

## 本地开发

```bash
pnpm install
pnpm dev       # 启动开发模式,自动拉起 Chrome、加载扩展并打开简单测试页
```

测试页是 WXT 原生 unlisted page,不需要另起 HTTP 服务,也不占用任何端口。开发版会自动打开 `test-simple.html`,页面顶部可切换到 transform/多层祖先复杂场景。点击浏览器工具栏中的 Screenshot Suite 图标即可验证真实 `activeTab` 流程;也应在普通网页上执行一次,验证按需注入。

```bash
pnpm build     # 生成生产构建,产物在 dist/
pnpm zip       # 打包为可上传至 Chrome Web Store 的 zip
pnpm test:e2e  # 使用 Playwright 在真实 Chromium 中加载扩展并验收
```

Playwright 直接访问 E2E 构建中的 WXT unlisted 测试页,不启动独立测试服务器。扩展测试严格使用官方推荐的 `chromium.launchPersistentContext`、Playwright bundled Chromium 的 `channel: 'chromium'`、`--disable-extensions-except` 和 `--load-extension`,并以 `headless: false` 运行 GUI 浏览器；不使用 Chrome/Edge 品牌通道或普通 `chromium.launch` 上下文。为使 `captureVisibleTab` 返回的浏览器表面像素比例与页面 DPR 一致,夹具会显式设置 `--force-device-scale-factor`。

Playwright 无法点击 Chrome 工具栏来产生 `activeTab` 授权,所以 E2E 模式使用隔离产物和测试专用 host permission 验证截图链路;另通过请求拦截生成普通网页验证 `scripting.executeScript` 注入。测试页和该权限都不会进入生产构建。运行 E2E 后请执行 `pnpm build`,并确认生产 manifest 仍只有 `activeTab` 与 `scripting`。特定网页测试夹具当前未纳入仓库,避免提交业务地址或标识符。

## 权限说明

插件仅申请以下权限,不申请任何常驻的 host 权限:

- `activeTab`:仅在用户主动点击插件图标时,临时获取当前标签页的访问权限
- `scripting`:用于在当前标签页运行截图相关脚本

插件**不采集、不存储、不上传**任何页面内容、截图或用户行为数据到任何远程服务器,所有处理均在本机完成。

## 相关文档

- [`SPEC.md`](./SPEC.md) —— 详细的功能设计、技术架构与边界情况说明
- [`AGENTS.md`](./AGENTS.md) —— 面向 AI 编码助手(Codex)的开发协作规范

## License

TBD

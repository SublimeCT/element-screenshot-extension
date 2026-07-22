# Element Full Screenshot

> 🚧 **开发中 / Work in Progress** —— 本项目尚未发布到 Chrome Web Store,当前仅供本地开发和测试使用。

一个 Chrome 扩展,用于**截取页面中某一个具体元素的完整内容**——即使该元素自身设置了固定高度并出现了滚动条,或者它的多层祖先元素存在固定高度、`overflow:hidden`、`transform: scale()`、flex/grid 布局限制等干扰样式。

## 为什么需要这个插件

浏览器原生的截图能力(DevTools 的 `Capture node screenshot`、`Capture full size screenshot`)以及市面上常见的全页截图插件(如 GoFullPage),要么只能截取当前可视区域,要么是针对**整个页面**设计的,面对下面这种场景往往力不从心:

- 想截的是**某一个元素**,不是整个页面
- 该元素内部内容超出了自身高度,出现了滚动条
- 元素外面还套着好几层祖先元素,这些祖先也各自有固定高度、裁切、缩放等样式

## 工作原理

插件**不修改页面任何 DOM 结构或 CSS**,而是:

1. 让用户点选页面上的目标元素
2. 判断该元素是否是滚动容器,如果是,按其可视高度为步长自动滚动
3. 每滚动一步,调用 `chrome.tabs.captureVisibleTab` 截取当前可视区域的真实渲染像素
4. 根据元素在视口中的实际位置(`getBoundingClientRect()`,已包含 transform/flex/grid 等布局变换后的最终结果)裁剪出对应区域
5. 将所有截图按顺序拼接成一张完整长图,导出为 PNG

由于截取的是浏览器已经渲染好的真实像素,不依赖修改样式展开高度,因此不受祖先元素的缩放、裁切、布局方式等干扰。

## 当前状态

- ⚠️ **尚未发布**,不可从 Chrome Web Store 安装
- 项目正在按 [`SPEC.md`](./SPEC.md) 描述的方案开发中,可关注该文档了解详细设计与已知边界情况

## 功能范围(MVP)

- [x] 手动选取页面上任意一个元素
- [ ] 目标元素自身可滚动时,自动滚动并拼接完整内容
- [ ] 目标元素不可滚动时,直接截取其当前可视区域
- [ ] 导出为 PNG,自动下载
- [ ] 支持高分屏(devicePixelRatio)不失真

暂不支持(见 `SPEC.md` §3.2/§3.3):跨 iframe 元素选取、横向滚动、PDF 导出、剪贴板复制、截图标注、整页截图。

## 技术栈

- [WXT](https://wxt.dev) — 基于 Vite 的现代 Web Extension 框架
- TypeScript(Vanilla 模板,不依赖 UI 框架)
- Manifest V3
- pnpm

## 本地开发

```bash
pnpm install
pnpm dev       # 启动开发模式,自动拉起 Chrome 并加载扩展,支持热更新
```

```bash
pnpm build     # 生成生产构建,产物在 .output/
pnpm zip       # 打包为可上传至 Chrome Web Store 的 zip
```

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
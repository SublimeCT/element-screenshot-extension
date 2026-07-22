# SPEC.md — Element Full Screenshot (Chrome Extension)

## 1. 背景与目标

浏览器原生截图能力(DevTools "Capture node screenshot"、`Capture full size screenshot"、以及主流全页截图插件如 GoFullPage)都是针对**整个页面**或**当前可视区域**设计的,无法可靠处理下面这种场景:

- 用户想截取**某一个具体元素**的完整内容
- 该元素自身设置了固定高度 + `overflow: auto/scroll`,内容超出可视区域
- 该元素的**多层祖先**也可能存在固定高度、`overflow:hidden`、`transform: scale()`、flex/grid 布局限制等,单纯修改 DOM 样式(展开高度)的方案会受这些样式干扰,结果不可靠

本插件默认不展开或重排页面元素,通过"滚动目标元素本身 + 多次截取可视区域真实像素 + 按元素矩形裁剪 + 拼接"的方式,得到目标元素的完整内容截图(含被自身滚动条隐藏的部分)。墨刀虚拟滚动是一个受域名与 DOM 结构双重限制的例外,见 §5.7。

## 2. 核心原理

1. 使用 `chrome.tabs.captureVisibleTab` 截取当前标签页**可视区域**的真实渲染像素(此 API 只能在扩展的 background/service worker 中调用,普通网页脚本无权限调用)。
2. 通过 content script 定位目标元素,用 `getBoundingClientRect()` 获取其在视口中的位置(该方法已包含 `transform: scale()`、`flex`、`grid` 等所有布局与视觉变换后的最终渲染位置和尺寸,因此不受这些样式干扰)。
3. 判断目标元素是否为**自身滚动容器**(`scrollHeight > clientHeight`):
   - 是:按 `clientHeight` 为步长,循环设置 `el.scrollTop`,每滚动一步截一次可视区域图,并记录该次截图时元素矩形与视口的交集区域(裁剪框)
   - 若位于 `https://modao.cc/proto` 且命中 §5.7 的虚拟滚动结构:按 `.screen-content` 的可视高度分段修改直接内容层 `.widgets` 的 `top`,而不是读取无效的 `scrollTop`
   - 否:只需截一次
4. 将每次截图按裁剪框裁剪出对应区域,按滚动顺序纵向拼接成一张完整长图。
5. 生成 PNG 并触发下载(或复制到剪贴板,见 §5.4)。
6. 普通页面只操作目标元素自身的 `scrollTop`;允许临时切换干扰元素的 `visibility`。墨刀适配器会临时修改内容层的内联 `top/left` 并隐藏其自定义纵向滚动条。所有修改都必须记录原始值和优先级,并在 `finally` 中精确还原。

## 3. 范围界定(MVP vs 后续迭代)

### 3.1 MVP 必须支持

- 手动选取任意一个 DOM 元素(点选交互)
- 目标元素自身是滚动容器(`overflow: auto/scroll` 且 `scrollHeight > clientHeight`)时,自动滚动 + 拼接完整内容
- 目标元素自身不滚动(内容未超出)时,直接截取该元素当前可视区域
- 导出为 PNG,自动下载
- 支持 `devicePixelRatio` 高分屏,输出图不失真
- 截图过程中隐藏/还原可能干扰视觉的 `position: fixed/sticky` 元素(可选但建议做,见 §5.2)
- 支持 `https://modao.cc/proto` 中符合 §5.7 结构的纵向虚拟滚动容器

### 3.2 后续迭代(不阻塞首个版本上架)

- 支持"元素本身不滚动,但被祖先的 `overflow:hidden` 裁切"的场景:自动检测最近的可滚动祖先并滚动它(见与用户此前讨论中提到的边界情况)
- 支持横向滚动元素(`scrollWidth > clientWidth`)
- 导出为 PDF
- 复制到剪贴板(`navigator.clipboard.write`)
- 截图后内置简单标注(箭头、文字、马赛克)
- 快捷键触发选取模式
- 右键菜单"截取此元素"入口(`chrome.contextMenus`,配合 `chrome.scripting` 定位右键点击的元素)

### 3.3 明确不做

- 不做整页截图(该场景已有 GoFullPage 等成熟方案,非本插件定位)
- 不采集、不上传任何页面内容或用户数据到远程服务器(纯本地处理,见 §6 隐私要求)

## 4. 技术架构

### 4.0 项目初始化(一次性操作,已在本仓库完成的可跳过)

```bash
pnpm dlx wxt@latest init element-shot   # 脚手架选择:Vanilla + TypeScript
cd element-shot
pnpm install
```

日常开发:

```bash
pnpm dev        # 启动 WXT 开发模式,自动拉起 Chrome 并加载扩展,支持 HMR
pnpm build       # 生成生产构建,产物在 dist/
pnpm zip         # 生成可直接上传 Chrome Web Store 的 zip(具体命令名以所装 WXT 版本的 `pnpm dlx wxt --help` 为准)
```

### 4.1 技术栈

- **脚手架:[WXT](https://wxt.dev)**(基于 Vite 的现代 Web Extension 框架),而非手写 `manifest.json` + 裸 `.js` 文件
- **语言:TypeScript**,初始化时选择 `Vanilla + TypeScript` 模板(本项目不需要 UI 框架,不引入 React/Vue/Svelte,保持依赖精简、体积小、审核风险低)
- **包管理器:pnpm**
- Manifest V3(由 WXT 根据 `wxt.config.ts` + `entrypoints/` 目录自动生成,不手写 `manifest.json`)

### 4.2 文件结构(基于 WXT 约定)

```
element-shot/
├── entrypoints/
│   ├── background.ts        # service worker 入口:唯一有权调用 chrome.tabs.captureVisibleTab 的地方
│   ├── element-picker.ts    # WXT unlisted script:按需注入的元素选取 + 截图入口
│   ├── popup/
│   │   ├── index.html       # 点击图标后的入口(也可去掉 popup,改为 action.onClicked 直接触发选取模式)
│   │   ├── main.ts
│   │   └── style.css
│   ├── test-simple/          # 仅 development/e2e 构建包含的 WXT unlisted 测试页
│   └── test-complex/         # transform/多层祖先复杂测试页
├── lib/
│   ├── constants.ts          # 消息类型等跨模块共享常量
│   ├── capture.ts            # 滚动 + 截图循环的核心逻辑(被 element-picker.ts 调用)
│   ├── site-adapters/
│   │   ├── index.ts          # 特定网页适配器注册表
│   │   └── modao.ts          # 墨刀虚拟滚动识别、操作与恢复
│   ├── stitch.ts              # OffscreenCanvas 拼接逻辑
│   └── types.ts               # 消息 payload、裁剪框等共享类型定义
├── public/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── wxt.config.ts              # manifest 字段(name/permissions/description 等)统一在此声明
├── package.json
├── tsconfig.json
├── tests/                      # Playwright E2E 与测试页共享的运行时辅助代码
└── .gitignore                  # 需排除 WXT 构建产物目录 dist/、.wxt/
```

> 说明:本项目在 `wxt.config.ts` 中将 WXT 的 `outDir` 配置为 `dist/`(打包后的可加载扩展 + 提交商店用的 zip 均在此目录下生成),开发调试临时文件在 `.wxt/`,两者都不进 Git。
> 测试页遵循 WXT unlisted page 入口约定,由 `entrypoints:found` hook 仅保留在 `development` / `e2e` 模式;生产包不得包含 `test-simple.html` 或 `test-complex.html`。

### 4.3 各模块职责

**entrypoints/background.ts(service worker)**
- 监听来自 content script 的 `CAPTURE_TAB` 消息,调用 `chrome.tabs.captureVisibleTab`,返回 dataURL
- 监听 popup 的 `START_PICK_REQUEST`,使用 `chrome.scripting.executeScript` 按需注入 WXT 构建的 `element-picker.js`,再向当前标签页发送 `START_PICK`
- **不直接操作 DOM,不做图像拼接**(拼接逻辑放 `lib/stitch.ts`,由 content script 调用,避免 service worker 生命周期被回收导致状态丢失)
- **不在模块顶层保存跨消息的可变状态**(service worker 随时可能被回收重启),需要跨消息保留的状态通过消息参数传递,或使用 `chrome.storage.session`

**entrypoints/element-picker.ts(按需注入的 unlisted script)**
- 作为 WXT unlisted script 构建,不写入 manifest 的静态 `content_scripts` 匹配规则;仅在用户点击 action 后凭 `activeTab` 临时权限注入顶层 frame
- 选取模式:鼠标移动时高亮当前 hover 的元素(用一个 `position:fixed` 的遮罩层实现,不修改原元素样式),点击后锁定目标元素
- 调用 `lib/capture.ts` 中的核心逻辑:判断目标元素是否为滚动容器 → 计算滚动步数 → 循环截图 → 还原滚动位置
- 调用 `lib/stitch.ts` 完成拼接,触发下载

**lib/capture.ts**
- 纯逻辑层,不直接依赖 DOM 事件绑定,方便未来做单元测试(即使 MVP 阶段不写自动化测试,也保持这层可测试性)
- 循环:设置 `scrollTop` → 等待重绘(`requestAnimationFrame` x2 + 适当 `setTimeout` 容忍懒加载)→ 通过 `chrome.runtime.sendMessage` 请求截图 → 记录裁剪框
- 截图完成后立即还原元素原始 `scrollTop`(`try/finally` 兜底)
- 通过 `SiteCaptureTarget` / `SiteCaptureSession` 运行站点适配策略,核心模块不包含站点域名、选择器或业务标识符

**lib/site-adapters/**
- 每个特定网页独占一个适配器文件,负责地址范围和 DOM 结构识别、位置操作、稳定性断言及幂等恢复
- `index.ts` 是唯一注册入口;新增站点时实现 `SiteCaptureAdapter` 并注册,不修改核心截图算法
- 禁止提交实际业务链接、业务路径、查询参数、画布 ID 或元素 ID;文档和代码只使用可公开的产品基础地址

**lib/stitch.ts**
- 输入:多张 dataURL + 各自裁剪框(x, y, w, h,已含 dpr 换算)
- 输出:一张竖直拼接后的 PNG dataURL/Blob
- 使用 `OffscreenCanvas`(content script 上下文可直接使用,不依赖 DOM canvas 挂载)

### 4.4 关键消息流

```
用户点击图标并在 popup 点击“选择元素”
  → popup 发送 START_PICK_REQUEST 到 entrypoints/background.ts
  → background.ts 按需注入 element-picker.js,发送 START_PICK
  → entrypoints/element-picker.ts 进入选取模式(高亮 + 监听 click)
  → 用户点击目标元素
  → lib/capture.ts 计算滚动步骤,循环:
      设置 scrollTop
      chrome.runtime.sendMessage(CAPTURE_TAB) → background.ts
      background.ts: chrome.tabs.captureVisibleTab → 返回 dataURL
      记录 {dataURL, clipRect}
  → lib/stitch.ts 拼接生成最终 PNG
  → 触发下载
```

## 5. 需要特别处理的边界情况

### 5.1 高分屏(devicePixelRatio)

`captureVisibleTab` 返回的图像已经是按设备像素渲染的(即物理像素,不是 CSS 像素)。裁剪框计算时必须将 `getBoundingClientRect()` 得到的 CSS 像素值乘以 `window.devicePixelRatio`,否则裁剪区域会错位。

### 5.2 `position: fixed`/`sticky` 元素造成的重复内容

若目标元素滚动过程中,页面上存在与目标元素**不相关**的 fixed/sticky 元素(如全局导航栏)恰好与目标元素区域重叠,每次截图都会重复出现这些元素。

- MVP 阶段:若目标元素矩形与已知的 fixed/sticky 元素矩形有重叠,可在截图前临时将这些元素 `visibility: hidden`(注意用 `visibility` 而非 `display:none`,避免触发目标元素的重排/尺寸变化),截图全部完成后统一还原
- 需要记录被隐藏元素列表,任何异常(如脚本报错)都要保证 `finally` 块中执行还原,避免页面卡在被隐藏状态

### 5.3 滚动触发的懒加载/动画内容

- 每次设置 `scrollTop` 后,不能立即截图,需等待:
  1. 两帧 `requestAnimationFrame`(确保布局/绘制完成)
  2. 一个可配置的短暂延时(默认 120ms,兼容懒加载图片/过渡动画)
- Chrome 官方限制 `captureVisibleTab` 每秒最多调用 2 次,因此连续截图请求还需额外节流到至少 520ms 间隔;渲染等待与 API 调用节流是两个独立约束
- 若页面使用 `IntersectionObserver` 做懒加载,滚动到某个位置后图片开始加载但未完成,截图会出现空白/占位图。MVP 阶段接受此限制,后续可增加"是否等待图片全部 `complete`"的检测逻辑

### 5.4 最后一屏的重叠裁剪(避免重复内容)

当 `scrollTop` 到达 `scrollHeight - clientHeight`(即最后一屏)时,若上一步的滚动距离不是 `clientHeight` 的整数倍,最后一屏与倒数第二屏会有重叠区域。拼接时需要按**实际滚动距离**裁剪每一屏的高度,而不是固定用 `clientHeight`,确保拼接后的总高度精确等于 `scrollHeight`,不出现重复或空白间隙。

### 5.5 目标元素在选取后发生位置变化

若页面本身有滚动条,用户选取元素后、脚本开始截图前,元素在视口中的位置理论上应保持不变(截图过程不滚动页面本身,只滚动目标元素内部)。但如果页面存在自动刷新、动画等,元素矩形在截图过程中被改变,需要在每次截图前重新读取 `getBoundingClientRect()`,不能复用选取时的初始值。

### 5.6 iframe 内的元素

- MVP 阶段**不支持**跨 iframe 边界的元素选取(按需注入时只指定顶层 frame;如需支持 iframe 内元素,需要 `"all_frames": true` 并处理跨 frame 消息通信,列入后续迭代)

### 5.7 墨刀 `top/left` 虚拟滚动

- 仅在公开基础地址 `https://modao.cc/proto` 范围内,且选中元素位于 `.pcanvas[data-cid] > .screen-content` 结构内时尝试适配
- `.screen-content` 必须为 `overflow:hidden/clip`;其直接内容层 `.widgets` 必须使用 `position:relative/absolute`、没有自身 `transform`,并且内容高度确实大于视口高度。任一条件不满足时不得接管普通截图逻辑
- 以 `.screen-content.clientHeight` 为步长,设置 `.widgets.style.top = -position`;横向 `left` 只冻结当前值,本迭代不拼接横向内容
- 截图期间隐藏 `.iScrollVerticalScrollbar`,避免滚动条在每帧重复出现
- 修改前记录 `top`、`left`、滚动条 `visibility` 的内联值和 CSS priority;无论成功或异常都在 `finally` 中精确还原
- 每次等待渲染后校验内容层仍在原节点、计算后的 `top/left` 未被墨刀重置、视口和内容高度未改变。若 React 重渲染或页面事件覆盖位置,立即报错,禁止输出可能重复/缺失的图片

## 6. 权限与隐私

### 6.1 manifest 权限最小化原则

- 所有权限统一在 `wxt.config.ts` 的 `manifest.permissions` 字段中声明,**不手写 `manifest.json`**(WXT 构建时会自动生成,手动改动会在下次构建时被覆盖)
- `activeTab`:仅在用户主动点击插件图标时,获得当前标签页的临时访问权限,优于常驻的 `<all_urls>` host 权限,审核通过率更高,也更让用户放心
- `scripting`:用于在用户点击 action 并获得 `activeTab` 后,向当前标签页顶层 frame 按需注入 WXT unlisted script;这种方式不会生成常驻站点匹配规则
- 不需要:`storage`(除非做"记住上次设置"功能)、`tabs`(`activeTab` 通常已够用,除非需要跨标签页操作)、任何 host permission 的常驻授权

> E2E 说明:Playwright 无法操作 Chrome 工具栏 UI 来产生 `activeTab` 授权,因此 `--mode e2e` 的隔离测试产物会临时声明 `<all_urls>` host permission,使 `captureVisibleTab` 可运行。滚动截图场景直接使用 WXT unlisted 测试页;另用 Playwright 请求拦截生成普通网页,专门验证 `scripting.executeScript` 按需注入。测试页和该权限均不进入生产构建,测试结束后必须重新执行 `pnpm build` 并审计生产 manifest。

### 6.2 隐私声明要点

- 插件**不采集、不存储、不上传**任何页面内容、截图、URL 或用户行为数据到任何远程服务器
- 所有截图数据仅在用户本机内存/本地下载中处理
- 上架前需撰写一份公开可访问的隐私政策页面(即使内容是"我们不收集任何数据"这一句话也需要正式页面,见 §7）

## 7. 上架 Chrome Web Store 需要准备的内容(简版,详细流程见对话回复)

- Manifest V3、最小权限声明
- 128x128 图标(另建议准备 16/48px)
- 至少 1 张 1280x800(或 640x400)截图
- 440x280 小型推广图(可选但建议做,影响列表页展示效果)
- 隐私政策页面 URL
- Chrome Web Store 开发者账号(一次性注册费,发布时以官方页面费用为准)
- 商店描述文案(简要说明 + 使用步骤 + 强调"本地处理、不上传数据")

## 8. 验收标准(Definition of Done,MVP)

- [ ] 能对一个 `overflow: auto` 且内容超出自身高度的元素,截取到完整内容(手动滚动到底与自动截图结果一致,像素级对比无明显错位/重复/缺失)
- [ ] 对符合 §5.7 的墨刀虚拟滚动元素,能输出完整纵向内容,不重复自定义滚动条,并恢复 `top/left/visibility` 原始值及优先级
- [ ] 高分屏(dpr=2 及以上)下截图清晰,无模糊、无裁剪错位
- [ ] 截图过程中原页面滚动状态、目标元素滚动状态在截图完成后恢复到操作前的状态
- [ ] 截图过程不修改页面 DOM 结构;`scrollTop` 和允许的临时 CSS 修改必须在结束时百分之百还原
- [ ] 对不需要滚动的普通元素(如一张卡片、一个表格),截图效果等同于该元素的可视截图
- [ ] manifest 权限清单中不存在未被实际使用的权限
- [ ] `chrome://extensions` 加载已解压扩展后,控制台无报错、无内存泄漏(可通过多次重复截图操作观察内存曲线粗略验证）

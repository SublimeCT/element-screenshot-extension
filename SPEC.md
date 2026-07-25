# SPEC.md — Screenshot Suite (Chrome Extension)

## 1. 背景与目标

浏览器原生截图能力(DevTools "Capture node screenshot"、`Capture full size screenshot"、以及主流全页截图插件如 GoFullPage)都是针对**整个页面**或**当前可视区域**设计的,无法可靠处理下面这种场景:

- 用户想截取**某一个具体元素**的完整内容
- 该元素自身设置了固定高度 + `overflow: auto/scroll`,内容超出可视区域
- 该元素的**多层祖先**也可能存在固定高度、`overflow:hidden`、`transform: scale()`、flex/grid 布局限制等,单纯修改 DOM 样式(展开高度)的方案会受这些样式干扰,结果不可靠

本插件默认不展开或重排页面元素,通过"滚动目标元素本身 + 多次截取可视区域真实像素 + 按元素矩形裁剪 + 拼接"的方式,得到目标元素的完整内容截图(含被自身滚动条隐藏的部分)。

## 2. 核心原理

1. 使用 `chrome.tabs.captureVisibleTab` 截取当前标签页**可视区域**的真实渲染像素(此 API 只能在扩展的 background/service worker 中调用,普通网页脚本无权限调用)。
2. 通过 content script 定位目标元素,用 `getBoundingClientRect()` 获取其在视口中的位置(该方法已包含 `transform: scale()`、`flex`、`grid` 等所有布局与视觉变换后的最终渲染位置和尺寸,因此不受这些样式干扰)。
3. 判断目标元素是否为**自身滚动容器**(`scrollHeight > clientHeight`):
   - 是:按 `clientHeight` 为步长,循环设置 `el.scrollTop`,每滚动一步截一次可视区域图,并记录该次截图时元素矩形与视口的交集区域(裁剪框)
   - 否:普通且完整可见的目标只截一次；若目标高度超过当前视口,滚动页面并按目标矩形实际可见交集分段截图
4. 将每次截图按裁剪框裁剪出对应区域,按滚动顺序纵向拼接成一张完整长图。
5. 生成 PNG 并按设置直接下载或在新标签页预览；批量模式生成本地 ZIP。
6. 普通页面只操作目标元素自身的 `scrollTop`,或在非滚动高目标场景滚动页面；截图期间临时隐藏原生滚动条,结束后恢复。允许临时切换干扰元素的 `visibility`。所有修改都必须记录原始值和优先级,并在 `finally` 中精确还原。

## 3. 范围界定(MVP vs 后续迭代)

### 3.1 MVP 必须支持

- 手动选取任意一个 DOM 元素(点选交互)
- 区域截图(点选元素并使用最近可滚动祖先；非滚动但高于视口的目标滚动页面分段截图)
- 元素截图(点选后固定使用实际节点，同时滚动最近可滚动父元素，只裁剪该节点区域)
- 聚焦截图(点选目标后通过临时 CSS 展开祖先链并隐藏无关分支，再滚动页面截取目标)
- 在单目标工作流中用 `ArrowUp` / `ArrowDown` 选择当前元素的父级或第一个可见子级
- 整页截图(自动滚动页面并拼接)
- 手动滚动截图:选择一个页面或元素区域,确认后先截取初始帧；用户手动滚动目标,每次滚动停止后追加一帧,按任意键结束并按实际滚动距离裁剪重叠后拼接
- 对页面中所有可滚动元素串行截图并下载 ZIP
- 目标元素自身是滚动容器(`overflow: auto/scroll` 且 `scrollHeight > clientHeight`)时,自动滚动 + 拼接完整内容
- 目标元素自身不滚动(内容未超出)时,直接截取该元素当前可视区域
- 导出为 PNG,自动下载
- 支持 `devicePixelRatio` 高分屏,输出图不失真
- 截图过程中隐藏/还原可能干扰视觉的 `position: fixed/sticky` 元素(可选但建议做,见 §5.2)
- 设置滚动间隔、是否恢复编辑内容、是否先预览；滚动位置和临时隐藏样式始终恢复
- 设置界面语言，支持浏览器默认、简体中文、繁体中文、英语、法语、日语、西班牙语、韩语、德语、葡萄牙语和阿拉伯语
- 滚动高度稳定探测、懒加载导致的高度增长检测,以及鼠标点击/Esc 中断

### 3.2 后续迭代(不阻塞首个版本上架)

- 支持横向滚动元素(`scrollWidth > clientWidth`)
- 导出为 PDF
- 复制到剪贴板(`navigator.clipboard.write`)
- 截图后内置简单标注(箭头、文字、马赛克)
- 快捷键触发选取模式
- 右键菜单"截取此元素"入口(`chrome.contextMenus`,配合 `chrome.scripting` 定位右键点击的元素)
- 自由框选模式(需要同时管理视口矩形、页面/容器滚动和中断,暂缓实现)

### 3.3 明确不做

- 自由框选模式暂不实现:仅靠视口矩形无法可靠推断跨滚动容器的内容边界,且会与元素选择、鼠标中断产生竞态；待元素模式稳定后单独设计
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
│   ├── test-simple/          # 仅 development/e2e 构建包含的多滚动容器测试页
│   └── test-complex/         # transform/多层祖先复杂测试页
├── lib/
│   ├── constants.ts          # 消息类型等跨模块共享常量
│   ├── capture.ts            # 元素/整页滚动 + 截图循环,高度探测与中断(被 element-picker.ts 调用)
│   ├── zip.ts                # 本地 ZIP(仅存储模式)生成
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
- 所有截图模式统一显示包含“选择元素 / 编辑页面 / 选择隐藏元素 / 确定截图”的 Shadow DOM 工具栏；工具栏通过独立 header 拖动并限制在视口内,只有用户确认后才调用截图逻辑
- 区域模式只保留最后一个目标并持续显示锁定高亮；手动滚动模式默认页面根元素并允许重新选择目标；整页模式默认高亮页面根元素,根元素不可滚动时退回第一个可滚动下级元素。选中页面根元素时调用 `capturePage()`,选中下级元素时调用 `captureElement()`
- 元素模式保留实际点击节点,通过 `scrollParent` 参数滚动最近可滚动父元素并裁剪目标矩形；聚焦模式只注入祖先路径 CSS,不对整棵 DOM 做 JavaScript 遍历
- 批量模式识别并高亮页面根元素及全部可滚动下级元素,点击可取消/恢复选择；确认后仅串行截图最终选中的集合并交由 `lib/zip.ts` 打包
- 自动模式调用 `lib/capture.ts` 中的核心逻辑:先稳定探测高度 → 计算滚动步数 → 循环截图 → 恢复滚动位置；手动模式记录初始位置及每次滚动停止位置,按任意键结束
- 调用 `lib/stitch.ts` 完成拼接,触发下载

**lib/capture.ts**
- 纯逻辑层,不直接依赖 DOM 事件绑定,方便未来做单元测试(即使 MVP 阶段不写自动化测试,也保持这层可测试性)
- 循环:设置元素 `scrollTop` 或页面 `scrollTo` → 等待重绘(`requestAnimationFrame` x2 + 可配置 `setTimeout`)→ 临时隐藏滚动条→ 通过 `chrome.runtime.sendMessage` 请求截图 → 记录裁剪框
- 初始触底等待并读取 `scrollHeight`;过程中若懒加载令高度增长则追加分段,超过安全分段上限或收到中断立即停止
- 截图完成后始终还原原始滚动位置和临时隐藏样式；编辑后的 DOM 内容按设置恢复,但临时 `contenteditable` 属性始终恢复

**lib/stitch.ts**
- 输入:多张 dataURL + 各自裁剪框(x, y, w, h,已含 dpr 换算)
- 输出:一张竖直拼接后的 PNG dataURL/Blob
- 使用 `OffscreenCanvas`(content script 上下文可直接使用,不依赖 DOM canvas 挂载)

### 4.4 关键消息流

```
用户点击图标并在 popup 选择模式/设置
  → popup 发送带 mode/settings 的 START_PICK_REQUEST 到 entrypoints/background.ts
  → background.ts 按需注入 element-picker.js,发送 START_PICK
  → entrypoints/element-picker.ts 按模式初始化单目标或多目标高亮
  → 用户通过统一工具栏选择/调整目标、编辑页面或选择隐藏元素
  → 用户点击“确定截图”
  → 自动模式由 lib/capture.ts 稳定探测并计算滚动步骤,循环:
      设置 scrollTop
      chrome.runtime.sendMessage(CAPTURE_TAB) → background.ts
      background.ts: chrome.tabs.captureVisibleTab → 返回 dataURL
      记录 {dataURL, clipRect}
  → 手动滚动模式先截初始帧,监听目标 scroll 并在每次滚动停止后截图,按任意键结束
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

### 5.8 无限滚动与用户中断

- 开始截图前最多三次触底等待并重新读取 `scrollHeight`,尽可能确定初始实际高度
- 每次渲染等待后再次读取高度;懒加载使高度增长时重新计算剩余位置
- 设置安全分段上限,防止瀑布流无限增长导致无限截图
- 截图期间监听 `Escape` 和页面鼠标按下;任一事件触发 `AbortController`,在下一安全点停止并执行所有恢复逻辑
- 批量模式对每个目标串行执行；任一目标失败或被用户中断时整批失败且不生成部分 ZIP,ZIP 文件数必须与确认时选中的目标数一致
- 截图进度不得以页面内浮层显示:`captureVisibleTab` 会把浮层截入下一帧。截图期间只保留不可见状态,完成或失败后才允许显示结果提示

### 5.9 手动滚动模式、临时编辑与隐藏预览

- 启用编辑前记录目标元素的 `innerHTML` 和 `contenteditable` 原始值
- 点击“编辑页面”后直接给目标设置 `contenteditable="true"`,不创建额外编辑弹窗；截图流程读取用户修改后的内容,并按设置恢复 `innerHTML`,临时 `contenteditable` 属性始终恢复
- 选择隐藏元素时先记录其内联 `opacity` 值和 priority,并立即应用 `opacity:0.35!important` 作为半透明预览,让用户看到已标记的元素；确认截图后,拾取器预览被清除,`lib/capture.ts` 的 `applyHideElements` 在每一帧截图期间对用户选中的元素改用 `opacity:0!important` 使其**在最终图片中完全消失**(不重排布局,与 `display:none` 不同),截图结束后在 `finally` 中精确还原
- 用户选择的隐藏元素只临时改变 `opacity`,固定/吸顶遮挡元素才使用 `visibility:hidden!important`;两类样式无论截图成功、失败、取消或中断都必须在 `finally` 中精确还原,不提供保留隐藏状态的设置
- 确认手动滚动截图后先采集当前初始帧；监听目标 `scroll` 并用防抖判断滚动停止,每个实际 `scrollTop` 只保留一帧。滚动到底部立即结束；若用户一次跳过超过一个视口,结束前自动补齐中间视口帧,再按位置排序并仅保留相对前一帧新增的底部物理像素
- 手动模式的非全屏目标使用 `outline` + `outline-offset` 闪烁提示,不改变内容区和布局；任意键与鼠标按下都可结束,提示和滚动条样式在 `finally` 中恢复
- 所有工作流面板必须在第一次 `captureVisibleTab` 前移除,避免任何扩展 UI 出现在最终图片中

### 5.5 目标元素在选取后发生位置变化

若页面本身有滚动条,用户选取元素后、脚本开始截图前,元素在视口中的位置理论上应保持不变(截图过程不滚动页面本身,只滚动目标元素内部)。但如果页面存在自动刷新、动画等,元素矩形在截图过程中被改变,需要在每次截图前重新读取 `getBoundingClientRect()`,不能复用选取时的初始值。

### 5.6 iframe 内的元素

- MVP 阶段**不支持**跨 iframe 边界的元素选取(按需注入时只指定顶层 frame;如需支持 iframe 内元素,需要 `"all_frames": true` 并处理跨 frame 消息通信,列入后续迭代)

## 6. 权限与隐私

### 6.1 manifest 权限最小化原则

- 所有权限统一在 `wxt.config.ts` 的 `manifest.permissions` 字段中声明,**不手写 `manifest.json`**(WXT 构建时会自动生成,手动改动会在下次构建时被覆盖)
- `activeTab`:仅在用户主动点击插件图标时,获得当前标签页的临时访问权限,优于常驻的 `<all_urls>` host 权限,审核通过率更高,也更让用户放心
- `scripting`:用于在用户点击 action 并获得 `activeTab` 后,向当前标签页顶层 frame 按需注入 WXT unlisted script;这种方式不会生成常驻站点匹配规则
- 不需要:`storage`(设置保存在扩展 popup 自身的 `localStorage`,不申请额外权限)、`tabs`(`activeTab` 通常已够用,除非需要跨标签页操作)、任何 host permission 的常驻授权

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
- [ ] 高分屏(dpr=2 及以上)下截图清晰,无模糊、无裁剪错位
- [ ] 截图过程中原页面滚动状态、目标元素滚动状态在截图完成后恢复到操作前的状态
- [ ] 截图过程不修改页面 DOM 结构;`scrollTop` 和允许的临时 CSS 修改必须在结束时百分之百还原
- [ ] 对不需要滚动的普通元素(如一张卡片、一个表格),截图效果等同于该元素的可视截图
- [ ] 整页模式截图实际选中的根元素或回退滚动元素；手动滚动模式按实际滚动距离拼接,两者均可按设置预览或下载
- [ ] 编辑内容按设置恢复；滚动位置、临时 `contenteditable` 属性及所有隐藏预览/截图样式始终精确恢复
- [ ] 批量模式串行生成与所选可滚动元素数量完全一致的 ZIP；任一项失败或中断时不输出部分 ZIP,且不留下临时样式
- [ ] 瀑布流高度增长会追加有限分段,Esc/鼠标点击可中断并恢复页面
- [ ] manifest 权限清单中不存在未被实际使用的权限
- [ ] `chrome://extensions` 加载已解压扩展后,控制台无报错、无内存泄漏(可通过多次重复截图操作观察内存曲线粗略验证）

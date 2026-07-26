// Generate the 6 per-mode demo pages (public/landing/<mode>.html) from a single
// template + content table. Pages are fully static; the only scripts are the
// shared landing-i18n.js and a tiny inline image lightbox.
//
// Asset layout (produced by scripts/publish-mode-assets.mjs):
//   public/landing/modes-assets/<mode>/NN.png   (sequential step screenshots)
//   public/landing/modes-assets/<mode>/video.{webm,mp4}
//
// Run with: node scripts/gen-mode-pages.mjs

import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('.');
const OUT_DIR = path.join(ROOT, 'public/landing');

const BRAND = '<span class="brand"><i></i><i></i><i></i><i></i></span>';

const ICONS = {
  region: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/><circle cx="12" cy="12" r="2.5"/>',
  fullPage: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  custom: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M12 16v3m0 0-2-2m2 2 2-2"/>',
  element: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>',
  focus: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 12h8M12 8v8"/>',
  allScrollable: '<path d="M21 8V5a1 1 0 0 0-1-1h-3M3 8V5a1 1 0 0 1 1-1h3M3 16v3a1 1 0 0 0 1 1h3M21 16v3a1 1 0 0 1-1 1h-3"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
};

// caption keys reference the generic step captions added to every locale.
// process = operational steps; result = the final outcome image.
const MODES = [
  {
    key: 'region', titleKey: 'regionMode', introKey: 'regionDetailIntro',
    bestForKey: 'regionDetailBestFor', titleAttrKey: 'regionDetailTitle',
    process: ['stepCaptionPageLoaded', 'stepCaptionToolbar', 'stepCaptionHighlight', 'stepCaptionCaptured'],
    result: { img: '05', captionKey: 'stepCaptionResult' },
  },
  {
    key: 'element', titleKey: 'elementMode', introKey: 'elementDetailIntro',
    bestForKey: 'elementDetailBestFor', titleAttrKey: 'elementDetailTitle',
    process: ['stepCaptionPageLoaded', 'stepCaptionToolbar', 'stepCaptionHighlight', 'stepCaptionCaptured'],
    result: { img: '05', captionKey: 'stepCaptionResult' },
  },
  {
    key: 'focus', titleKey: 'focusMode', introKey: 'focusDetailIntro',
    bestForKey: 'focusDetailBestFor', titleAttrKey: 'focusDetailTitle',
    process: ['stepCaptionPageLoaded', 'stepCaptionToolbar', 'stepCaptionHighlight', 'stepCaptionCaptured'],
    result: { img: '05', captionKey: 'stepCaptionResult' },
  },
  {
    key: 'fullPage', titleKey: 'fullPageMode', introKey: 'fullPageDetailIntro',
    bestForKey: 'fullPageDetailBestFor', titleAttrKey: 'fullPageDetailTitle',
    process: ['stepCaptionPageLoaded', 'stepCaptionToolbar', 'stepCaptionCaptured'],
    result: { img: '04', captionKey: 'stepCaptionResult' },
  },
  {
    key: 'custom', titleKey: 'customMode', introKey: 'customDetailIntro',
    bestForKey: 'customDetailBestFor', titleAttrKey: 'customDetailTitle',
    process: [
      'stepCaptionPageLoaded', 'stepCaptionToolbar', 'stepCaptionHighlight', 'stepCaptionManualMode',
      'stepCaptionScroll', 'stepCaptionScroll', 'stepCaptionScroll', 'stepCaptionCaptured',
    ],
    result: { img: '09', captionKey: 'stepCaptionResult' },
  },
  {
    key: 'allScrollable', titleKey: 'allScrollableMode', introKey: 'allScrollableDetailIntro',
    bestForKey: 'allScrollableDetailBestFor', titleAttrKey: 'allScrollableDetailTitle',
    process: ['stepCaptionPageLoaded', 'stepCaptionMultiHighlight', 'stepCaptionAfterDeselect', 'stepCaptionCaptured'],
    result: { img: '05', captionKey: 'stepCaptionFinalPage' },
  },
];

const LANG_OPTIONS = `
          <option value="browser" data-i18n="landingLangAuto">自动</option>
          <option value="zh_CN">简体中文</option>
          <option value="zh_TW">繁體中文</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="ja">日本語</option>
          <option value="es">Español</option>
          <option value="ko">한국어</option>
          <option value="de">Deutsch</option>
          <option value="pt_BR">Português</option>
          <option value="ar">العربية</option>`;

function faviconHead() {
  return `
  <link rel="icon" type="image/png" sizes="32x32" href="../icon/32.png">
  <link rel="icon" type="image/png" sizes="48x48" href="../icon/48.png">
  <link rel="icon" type="image/png" sizes="16x16" href="../icon/16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png">
  <link rel="icon" href="favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="mode-detail.css">`;
}

function nav() {
  return `
  <header class="nav">
    <div class="nav-inner">
      <a class="nav-brand" href="index.html">${BRAND}<span>Screenshot Suite</span></a>
      <nav class="nav-links" data-i18n-aria="landingNavAria" aria-label="主导航">
        <a href="index.html#features" data-i18n="landingNavFeatures">功能</a>
        <a href="index.html#how" data-i18n="landingNavHow">用法</a>
        <a href="index.html#privacy" data-i18n="landingNavPrivacy">隐私</a>
      </nav>
      <div class="nav-actions">
        <label class="lang-switch">
          <svg class="lang-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>
          <select class="lang-select" data-lang-switch data-i18n-aria="language" aria-label="界面语言" data-i18n-title="language" title="界面语言">${LANG_OPTIONS}
          </select>
        </label>
        <a class="btn btn-ghost btn-sm" href="https://github.com/SublimeCT/element-screenshot-extension" target="_blank" rel="noreferrer">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.4 9.4 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>
          <span data-i18n="landingNavGithub">GitHub</span>
        </a>
        <a class="btn btn-primary btn-sm" href="https://github.com/SublimeCT/element-screenshot-extension/releases" target="_blank" rel="noreferrer">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>
          <span data-i18n="landingInstall">添加到 Chrome</span>
        </a>
      </div>
    </div>
  </header>`;
}

function footer() {
  return `
  <footer>
    <div class="foot-inner">
      <div class="foot-brand">${BRAND}<span>Screenshot Suite</span></div>
      <span class="foot-tag" data-i18n="landingFootTag">· 本地优先的网页截图套件</span>
      <nav class="foot-links" data-i18n-aria="landingFootAria" aria-label="页脚">
        <a href="index.html#privacy" data-i18n="landingFootPrivacy">隐私政策</a>
        <a href="https://github.com/SublimeCT/element-screenshot-extension/issues" target="_blank" rel="noreferrer" data-i18n="landingFootFeedback">反馈</a>
      </nav>
    </div>
  </footer>`;
}

function lightbox() {
  return `
  <div class="lightbox" id="lightbox" aria-hidden="true" role="dialog" aria-modal="true">
    <button class="lightbox-close" type="button" aria-label="Close">
      <svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <img alt="">
  </div>
  <script src="landing-i18n.js"></script>
  <script>
  (() => {
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    const lbImg = lb.querySelector('img');
    const closeBtn = lb.querySelector('.lightbox-close');
    const open = (src) => { lbImg.src = src; lb.classList.add('is-open'); lb.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; };
    const shut = () => { lb.classList.remove('is-open'); lb.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; setTimeout(() => { lbImg.src = ''; }, 200); };
    document.querySelectorAll('[data-zoom]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); open(a.getAttribute('href')); }));
    closeBtn.addEventListener('click', shut);
    lb.addEventListener('click', (e) => { if (e.target === lb) shut(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shut(); });
  })();
  </script>`;
}

function render(mode) {
  const asset = (file) => `modes-assets/${mode.key}/${file}`;
  const stepCards = mode.process.map((captionKey, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `      <article class="card step-card">
        <div class="step-head">
          <span class="step-badge">${i + 1}</span>
          <p class="step-cap" data-i18n="${captionKey}">步骤 ${i + 1}</p>
        </div>
        <a class="step-fig" href="${asset(`${n}.png`)}" data-zoom>
          <img loading="lazy" src="${asset(`${n}.png`)}" alt="">
        </a>
      </article>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title data-i18n="${mode.titleAttrKey}">Screenshot Suite</title>${faviconHead()}
</head>
<body>
${nav()}

<!-- ============ DETAIL HERO ============ -->
<section class="detail-hero">
  <div class="wrap">
    <a class="crumbs" href="index.html">
      <svg class="icon" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
      <span data-i18n="modeDetailBackHome">返回主页</span>
    </a>
    <div class="hero-row">
      <span class="hero-ic"><svg class="icon" viewBox="0 0 24 24">${ICONS[mode.key]}</svg></span>
      <div style="flex:1;min-width:240px">
        <h1 data-i18n="${mode.titleKey}">${mode.key}</h1>
        <p class="lead" data-i18n="${mode.introKey}"></p>
        <div class="best-for">
          <span class="label" data-i18n="modeDetailBestFor">适用场景</span>
          <span class="chip chip-accent" data-i18n="${mode.bestForKey}"></span>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ============ DEMO VIDEO ============ -->
<section id="video">
  <div class="wrap">
    <div class="section-head">
      <h2 data-i18n="modeDetailVideoTitle">演示视频</h2>
      <p class="lead" data-i18n="modeDetailVideoLead">观看从开始到完成的完整截图过程。</p>
    </div>
    <div class="video-frame">
      <div class="video-bar"><span class="vdot"></span><span class="vdot"></span><span class="vdot"></span></div>
      <video controls preload="metadata" playsinline poster="${asset('01.png')}">
        <source src="${asset('video.mp4')}" type="video/mp4">
      </video>
    </div>
    <div class="video-actions">
      <a class="btn btn-ghost btn-sm" href="${asset('video.mp4')}" download data-i18n="modeDetailDownloadVideo">下载视频</a>
    </div>
  </div>
</section>

<!-- ============ STEPS ============ -->
<section id="steps" style="background:var(--surface-2)">
  <div class="wrap">
    <div class="section-head">
      <h2 data-i18n="modeDetailStepsTitle">操作步骤</h2>
      <p class="lead" data-i18n="modeDetailStepsLead">每一张截图都对应实际截图过程中的一步。</p>
    </div>
    <div class="steps">
${stepCards}
    </div>
  </div>
</section>

<!-- ============ RESULT ============ -->
<section id="result">
  <div class="wrap">
    <div class="section-head">
      <h2 data-i18n="modeDetailResultTitle">最终结果</h2>
    </div>
    <article class="card result-card">
      <a class="step-fig" href="${asset(`${mode.result.img}.png`)}" data-zoom>
        <img loading="lazy" src="${asset(`${mode.result.img}.png`)}" alt="">
      </a>
      <p class="step-cap" data-i18n="${mode.result.captionKey}"></p>
    </article>
  </div>
</section>

${footer()}
${lightbox()}
</body>
</html>
`;
}

async function main() {
  for (const mode of MODES) {
    const file = path.join(OUT_DIR, `${mode.key}.html`);
    await writeFile(file, render(mode), 'utf8');
    console.log(`✓ ${file}  (${mode.process.length} steps + result)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

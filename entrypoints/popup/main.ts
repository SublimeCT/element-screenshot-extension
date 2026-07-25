import './style.css';
import { MESSAGE_TYPES } from '@/lib/constants';
import { browserLocale, loadLocale, message } from '@/lib/i18n';
import { normalizeCaptureSettings } from '@/lib/settings';
import type {
  CaptureMode,
  CaptureSettings,
  CommandResponse,
  StartPickRequest,
} from '@/lib/types';

const SETTINGS_KEY = 'element-shot-settings';
const t = (key: string, fallback: string, substitutions?: string | string[]): string =>
  message(key, fallback, substitutions);

function isCommandResponse(value: unknown): value is CommandResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof value.ok === 'boolean' &&
    (value.ok || ('error' in value && typeof value.error === 'string'))
  );
}

function readSettings(): CaptureSettings {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '');
    if (
      typeof value === 'object' &&
      value !== null &&
      'intervalMs' in value &&
      typeof value.intervalMs === 'number' &&
      'preview' in value &&
      typeof value.preview === 'boolean'
    ) {
      return normalizeCaptureSettings(value);
    }
  } catch {
    // An empty or older local setting falls back to the safe defaults.
  }

  return normalizeCaptureSettings(undefined);
}

function persistSettings(settings: CaptureSettings): void {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      intervalMs: settings.intervalMs,
      language: settings.language,
      preview: settings.preview,
      restoreEditedContent: settings.restoreEditedContent,
    }),
  );
}

const initialSettings = readSettings();
await loadLocale(initialSettings.language);

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup-shell">
    <header class="brand-row">
      <img class="brand-mark" src="${new URL('icon/48.png', browser.runtime.getURL('/')).href}" alt="" />
      <div class="brand-copy">
        <h1>${t('popupHeading', '网页滚动截图工具')}</h1>
        <p class="status-line"><span class="status-dot"></span>${t('popupStatus', '本地处理 · 不上传内容')}</p>
      </div>
      <nav class="brand-links" aria-label="${t('projectLinks', '项目链接')}">
        <a class="brand-link" href="https://github.com/SublimeCT/element-screenshot-extension" target="_blank" rel="noreferrer" aria-label="${t('projectGithub', 'GitHub 地址')}" title="${t('projectGithub', 'GitHub 地址')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.4 9.4 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>
        </a>
        <a class="brand-link" href="https://sublimect.github.io/element-screenshot-extension" target="_blank" rel="noreferrer" aria-label="${t('projectHome', '项目主页')}" title="${t('projectHome', '项目主页')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1v-9"/></svg>
        </a>
      </nav>
    </header>

    <section class="mode-section" aria-label="${t('captureMode', '截图模式')}">
      <div class="section-kicker">${t('captureMode', '截图模式')}</div>
      <div class="mode-grid" role="group" aria-label="${t('captureMode', '截图模式')}">
        <button class="mode-button is-selected" data-mode="region" type="button">
          <span class="mode-icon mode-icon-target" aria-hidden="true"></span>
          <span>${t('regionMode', '区域截图')}</span>
        </button>
        <button class="mode-button" data-mode="fullPage" type="button">
          <span class="mode-icon mode-icon-page" aria-hidden="true"></span>
          <span>${t('fullPageMode', '整页截图')}</span>
        </button>
        <button class="mode-button" data-mode="custom" type="button">
          <span class="mode-icon mode-icon-custom" aria-hidden="true"></span>
          <span>${t('customMode', '手动滚动截图')}</span>
        </button>
        <button class="mode-button" data-mode="element" type="button">
          <span class="mode-icon mode-icon-target" aria-hidden="true"></span>
          <span>${t('elementMode', '元素截图')}</span>
        </button>
        <button class="mode-button" data-mode="focus" type="button">
          <span class="mode-icon mode-icon-page" aria-hidden="true"></span>
          <span>${t('focusMode', '聚焦截图')}</span>
        </button>
        <button class="mode-button" data-mode="allScrollable" type="button">
          <span class="mode-icon mode-icon-stack" aria-hidden="true"></span>
          <span>${t('allScrollableMode', '全部滚动元素')}</span>
        </button>
      </div>
    </section>

    <section class="settings-section" aria-label="${t('settings', '设置')}">
      <div class="section-kicker">${t('settings', '设置')}</div>
      <label class="range-row" for="interval">
        <span><strong>${t('scrollInterval', '滚动间隔')}</strong><small>${t('scrollIntervalHelp', '避免页面来不及渲染')}</small></span>
        <output id="interval-value" for="interval">520 ms</output>
        <input id="interval" type="range" min="520" max="3000" step="20" />
      </label>
      <label class="toggle-row" for="restore-edits">
        <span><strong>${t('restoreEdits', '恢复编辑内容')}</strong><small>${t('restoreEditsHelp', '关闭后保留截图时编辑后的 DOM 内容')}</small></span>
        <input id="restore-edits" type="checkbox" />
        <span class="toggle-track" aria-hidden="true"></span>
      </label>
      <label class="toggle-row" for="preview">
        <span><strong>${t('preview', '先预览再下载')}</strong><small>${t('previewHelp', '打开预览标签页后，可右键图片另存为下载；批量截图始终直接下载 ZIP')}</small></span>
        <input id="preview" type="checkbox" />
        <span class="toggle-track" aria-hidden="true"></span>
      </label>
      <label class="language-row" for="language">
        <span><strong>${t('language', '界面语言')}</strong><small>${t('languageHelp', '默认根据浏览器语言选择具体语言')}</small></span>
        <select id="language">
          <option value="zh_CN">${t('languageZhCn', '简体中文')}</option>
          <option value="zh_TW">${t('languageZhTw', '繁體中文')}</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="ja">日本語</option>
          <option value="es">Español</option>
          <option value="ko">한국어</option>
          <option value="de">Deutsch</option>
          <option value="pt_BR">Português</option>
          <option value="ar">العربية</option>
        </select>
      </label>
    </section>

    <button class="capture-button" id="start-pick" type="button">
      <span class="crosshair" aria-hidden="true"></span>
      <span data-button-label>${t('startRegion', '选择元素')}</span>
    </button>

    <p class="feedback" id="feedback" role="status" aria-live="polite"></p>
  </main>
`;

const settings = readSettings();
let mode: CaptureMode = 'region';
const modeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-mode]'),
);
const interval = document.querySelector<HTMLInputElement>('#interval')!;
const intervalValue = document.querySelector<HTMLOutputElement>('#interval-value')!;
const restoreEdits = document.querySelector<HTMLInputElement>('#restore-edits')!;
const preview = document.querySelector<HTMLInputElement>('#preview')!;
const language = document.querySelector<HTMLSelectElement>('#language')!;
const startButton = document.querySelector<HTMLButtonElement>('#start-pick')!;
const buttonLabel = document.querySelector<HTMLSpanElement>('[data-button-label]')!;
const feedback = document.querySelector<HTMLParagraphElement>('#feedback')!;

function readFormSettings(): CaptureSettings {
  return normalizeCaptureSettings({
    intervalMs: Number(interval.value),
    language: language.value,
    preview: preview.checked,
    restoreEditedContent: restoreEdits.checked,
  });
}

interval.value = String(settings.intervalMs);
restoreEdits.checked = settings.restoreEditedContent;
preview.checked = settings.preview;
language.value = settings.language;

function updateIntervalLabel(): void {
  intervalValue.textContent = `${interval.value} ms`;
}

function updateMode(modeButton: HTMLButtonElement): void {
  mode = modeButton.dataset.mode as CaptureMode;
  for (const button of modeButtons) {
    button.classList.toggle('is-selected', button === modeButton);
  }
  const labels: Record<CaptureMode, string> = {
    allScrollable: t('startBatch', '开始批量截图'),
    custom: t('startCustom', '选择滚动区域'),
    element: t('startElement', '截图元素'),
    focus: t('startFocus', '聚焦截图'),
    fullPage: t('startFullPage', '开始整页截图'),
    region: t('startRegion', '选择元素'),
  };
  buttonLabel.textContent = labels[mode];
}

updateIntervalLabel();
for (const modeButton of modeButtons) {
  modeButton.addEventListener('click', () => updateMode(modeButton));
}
interval.addEventListener('input', updateIntervalLabel);
const persistFormSettings = (): void => persistSettings(readFormSettings());
interval.addEventListener('change', persistFormSettings);
restoreEdits.addEventListener('change', persistFormSettings);
preview.addEventListener('change', persistFormSettings);
language.addEventListener('change', () => {
  persistFormSettings();
  window.location.reload();
});

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  buttonLabel.textContent = mode === 'region' ? '正在启动' : '正在准备';
  feedback.textContent = '';

  const captureSettings: CaptureSettings = {
    intervalMs: Number(interval.value),
    language: language.value as CaptureSettings['language'],
    preview: preview.checked && mode !== 'allScrollable',
    restoreEditedContent: restoreEdits.checked,
    restoreHiddenElements: true,
    restorePage: true,
    settleDelayMs: 120,
  };
  // Keep the user's preview preference even when the selected mode (batch)
  // temporarily does not support preview.
  persistFormSettings();

  try {
    const request: StartPickRequest = {
      mode,
      settings: captureSettings,
      type: MESSAGE_TYPES.START_PICK_REQUEST,
    };
    const response: unknown = await browser.runtime.sendMessage(request);
    if (!isCommandResponse(response)) {
      throw new Error('扩展返回了无效响应。');
    }
    if (!response.ok) {
      throw new Error(response.error);
    }

    buttonLabel.textContent = mode === 'region' ? '已启动' : '已开始';
    window.setTimeout(() => window.close(), 100);
  } catch (error) {
    feedback.textContent =
      error instanceof Error ? error.message : '无法启动截图。';
    updateMode(modeButtons.find((button) => button.dataset.mode === mode) ?? modeButtons[0]);
    startButton.disabled = false;
  }
});

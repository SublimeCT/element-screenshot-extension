import './style.css';
import { MESSAGE_TYPES } from '@/lib/constants';
import type { CommandResponse, StartPickRequest } from '@/lib/types';

function isCommandResponse(value: unknown): value is CommandResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    typeof value.ok === 'boolean' &&
    (value.ok || ('error' in value && typeof value.error === 'string'))
  );
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="popup-shell">
    <header class="brand-row">
      <span class="brand-mark" aria-hidden="true"><span></span></span>
      <div>
        <h1>Element Shot</h1>
        <p class="status-line"><span class="status-dot"></span>准备就绪</p>
      </div>
    </header>

    <button class="capture-button" id="start-pick" type="button">
      <span class="crosshair" aria-hidden="true"></span>
      <span data-button-label>选择元素</span>
    </button>

    <p class="feedback" id="feedback" role="status" aria-live="polite"></p>
  </main>
`;

const startButton = document.querySelector<HTMLButtonElement>('#start-pick')!;
const buttonLabel = document.querySelector<HTMLSpanElement>('[data-button-label]')!;
const feedback = document.querySelector<HTMLParagraphElement>('#feedback')!;

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  buttonLabel.textContent = '正在启动';
  feedback.textContent = '';

  try {
    const request: StartPickRequest = {
      type: MESSAGE_TYPES.START_PICK_REQUEST,
    };
    const response: unknown = await browser.runtime.sendMessage(request);
    if (!isCommandResponse(response)) {
      throw new Error('扩展返回了无效响应。');
    }
    if (!response.ok) {
      throw new Error(response.error);
    }

    buttonLabel.textContent = '已启动';
    window.setTimeout(() => window.close(), 100);
  } catch (error) {
    feedback.textContent =
      error instanceof Error ? error.message : '无法启动元素选取。';
    buttonLabel.textContent = '重新选择';
    startButton.disabled = false;
  }
});

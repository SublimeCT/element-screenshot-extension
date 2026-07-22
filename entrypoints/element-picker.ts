import { captureElement } from '@/lib/capture';
import { MESSAGE_TYPES } from '@/lib/constants';
import { resolveSiteCaptureViewport } from '@/lib/site-adapters';
import { stitchFramesToPng } from '@/lib/stitch';
import type {
  CommandResponse,
  ContentPingRequest,
  StartPickCommand,
} from '@/lib/types';

const PICKER_HOST_ID = 'element-shot-picker-host';
const STATUS_HOST_ID = 'element-shot-status-host';

interface PickerUi {
  highlight: HTMLDivElement;
  host: HTMLDivElement;
  label: HTMLDivElement;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasMessageType<T extends string>(
  value: unknown,
  type: T,
): value is { type: T } {
  return isRecord(value) && value.type === type;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '发生未知错误。';
}

function createPickerUi(): PickerUi {
  document.getElementById(PICKER_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = PICKER_HOST_ID;
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .highlight {
      position: fixed;
      box-sizing: border-box;
      border: 2px solid #ff4d2e;
      background: rgb(255 77 46 / 12%);
      box-shadow: 0 0 0 1px rgb(255 255 255 / 80%), 0 8px 28px rgb(20 24 33 / 18%);
      transform: translateZ(0);
    }
    .label {
      position: fixed;
      max-width: min(360px, calc(100vw - 24px));
      padding: 7px 10px;
      border-radius: 4px;
      color: #f8fafc;
      background: #171a21;
      box-shadow: 0 8px 24px rgb(20 24 33 / 24%);
      font: 600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      letter-spacing: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  const label = document.createElement('div');
  label.className = 'label';
  shadow.append(style, highlight, label);
  document.documentElement.append(host);

  return { highlight, host, label };
}

function updatePickerUi(ui: PickerUi, element: Element): void {
  const rect = element.getBoundingClientRect();
  Object.assign(ui.highlight.style, {
    height: `${Math.max(0, rect.height)}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(0, rect.width)}px`,
  });

  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('');
  ui.label.textContent = `${tagName}${id}${className}`;

  const labelTop = rect.top >= 38 ? rect.top - 32 : rect.bottom + 8;
  Object.assign(ui.label.style, {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 180))}px`,
    top: `${Math.max(8, Math.min(labelTop, window.innerHeight - 38))}px`,
  });
}

function createStatusHost(state: 'error' | 'success', message: string): void {
  document.getElementById(STATUS_HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = STATUS_HOST_ID;
  host.dataset.elementShotStatus = state;
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('right', '20px', 'important');
  host.style.setProperty('bottom', '20px', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const messageElement = document.createElement('div');
  Object.assign(messageElement.style, {
    background: state === 'success' ? '#171a21' : '#8f2417',
    border: '1px solid rgb(255 255 255 / 18%)',
    borderRadius: '5px',
    boxShadow: '0 12px 34px rgb(20 24 33 / 24%)',
    color: '#f8fafc',
    font: '600 13px/1.4 ui-sans-serif, system-ui, sans-serif',
    letterSpacing: '0',
    maxWidth: '320px',
    padding: '10px 13px',
  });
  messageElement.textContent = message;
  shadow.append(messageElement);
  document.documentElement.append(host);
  window.setTimeout(() => host.remove(), state === 'success' ? 2600 : 5000);
}

function downloadPng(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.download = `element-shot-${timestamp}.png`;
  link.href = url;
  link.style.display = 'none';
  document.documentElement.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function eventElement(event: Event): HTMLElement | null {
  const element = event.composedPath().find(
    (target): target is HTMLElement => target instanceof HTMLElement,
  );
  return element ?? null;
}

function resolveCaptureTarget(element: HTMLElement): HTMLElement {
  const siteViewport = resolveSiteCaptureViewport(element);
  if (siteViewport) {
    return siteViewport;
  }

  let candidate: HTMLElement | null = element;

  while (
    candidate &&
    candidate !== document.body &&
    candidate !== document.documentElement
  ) {
    const { overflowY } = getComputedStyle(candidate);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      candidate.scrollHeight > candidate.clientHeight
    ) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }

  return element;
}

function createPickerController(): () => void {
  let isPicking = false;
  let captureInProgress = false;
  let ui: PickerUi | null = null;

  const stopPicking = (): void => {
    if (!isPicking) {
      return;
    }

    isPicking = false;
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('keydown', handleKeyDown, true);
    ui?.host.remove();
    ui = null;
  };

  const handlePointerMove = (event: PointerEvent): void => {
    const element = eventElement(event);
    if (element && ui) {
      updatePickerUi(ui, resolveCaptureTarget(element));
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopPicking();
    }
  };

  const handleClick = (event: MouseEvent): void => {
    if (!isPicking || captureInProgress) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const element = eventElement(event);
    stopPicking();

    if (!element) {
      createStatusHost('error', '未能识别所选元素。');
      return;
    }

    captureInProgress = true;
    void captureElement(resolveCaptureTarget(element))
      .then(stitchFramesToPng)
      .then((blob) => {
        downloadPng(blob);
        createStatusHost('success', '完整截图已下载');
      })
      .catch((error: unknown) => {
        console.error('[Element Shot] Capture failed:', error);
        createStatusHost('error', errorMessage(error));
      })
      .finally(() => {
        captureInProgress = false;
      });
  };

  return (): void => {
    if (captureInProgress) {
      createStatusHost('error', '当前截图尚未完成。');
      return;
    }

    stopPicking();
    isPicking = true;
    ui = createPickerUi();
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('click', handleClick, true);
    window.addEventListener('keydown', handleKeyDown, true);
  };
}

export default defineUnlistedScript(() => {
  const startPicking = createPickerController();

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender,
      sendResponse: (response: CommandResponse) => void,
    ): undefined => {
      if (hasMessageType(message, MESSAGE_TYPES.CONTENT_PING)) {
        const request: ContentPingRequest = message;
        void request;
        sendResponse({ ok: true });
        return;
      }

      if (hasMessageType(message, MESSAGE_TYPES.START_PICK)) {
        const command: StartPickCommand = message;
        void command;
        startPicking();
        sendResponse({ ok: true });
      }
    },
  );
});

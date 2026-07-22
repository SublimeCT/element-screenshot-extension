import { MESSAGE_TYPES, PICKER_SCRIPT_PATH } from '@/lib/constants';
import type {
  CaptureTabRequest,
  CaptureTabResponse,
  CommandResponse,
  ContentPingRequest,
  StartPickCommand,
  StartPickRequest,
} from '@/lib/types';

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

async function captureVisibleTabAsync(windowId: number): Promise<string> {
  return await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function isPickerInjected(tabId: number): Promise<boolean> {
  const ping: ContentPingRequest = { type: MESSAGE_TYPES.CONTENT_PING };

  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, ping);
    return isRecord(response) && response.ok === true;
  } catch {
    return false;
  }
}

async function ensurePickerInjected(tabId: number): Promise<void> {
  if (await isPickerInjected(tabId)) {
    return;
  }

  await browser.scripting.executeScript({
    files: [PICKER_SCRIPT_PATH],
    target: { tabId },
  });
}

async function startPickerInActiveTab(): Promise<CommandResponse> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      throw new Error('找不到当前活动标签页。');
    }

    await ensurePickerInjected(tab.id);
    const command: StartPickCommand = { type: MESSAGE_TYPES.START_PICK };
    const response: unknown = await browser.tabs.sendMessage(tab.id, command);
    if (!isRecord(response) || response.ok !== true) {
      throw new Error('无法启动元素选取模式。');
    }

    return { ok: true };
  } catch (error) {
    return { error: errorMessage(error), ok: false };
  }
}

export default defineBackground(() => {
  if (import.meta.env.MODE === 'development') {
    browser.runtime.onInstalled.addListener(() => {
      void browser.tabs.create({
        url: new URL('test-simple.html', browser.runtime.getURL('/')).href,
      });
    });
  }

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      sender,
      sendResponse: (response: CaptureTabResponse | CommandResponse) => void,
    ): true | undefined => {
      if (hasMessageType(message, MESSAGE_TYPES.CAPTURE_TAB)) {
        const request: CaptureTabRequest = message;
        void request;

        if (sender.tab?.windowId === undefined) {
          sendResponse({ error: '截图请求不是来自标签页。', ok: false });
          return;
        }

        void captureVisibleTabAsync(sender.tab.windowId)
          .then((dataUrl) => sendResponse({ dataUrl, ok: true }))
          .catch((error: unknown) =>
            sendResponse({ error: errorMessage(error), ok: false }),
          );
        return true;
      }

      if (hasMessageType(message, MESSAGE_TYPES.START_PICK_REQUEST)) {
        const request: StartPickRequest = message;
        void request;

        void startPickerInActiveTab().then(sendResponse);
        return true;
      }

      return;
    },
  );
});

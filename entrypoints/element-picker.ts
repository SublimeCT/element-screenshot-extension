import {
  captureElement,
  captureManualScrollElement,
  capturePage,
  type CaptureElementOptions,
} from '@/lib/capture';
import { MESSAGE_TYPES } from '@/lib/constants';
import { loadLocale, message } from '@/lib/i18n';
import { normalizeCaptureSettings } from '@/lib/settings';
import { stitchFramesToPng } from '@/lib/stitch';
import { createZipBlob, type ZipEntry } from '@/lib/zip';
import type {
  CaptureMode,
  CaptureResult,
  CaptureSettings,
  CommandResponse,
  ContentPingRequest,
  OpenPreviewRequest,
  StartPickCommand,
} from '@/lib/types';

const PICKER_HOST_ID = 'element-shot-picker-host';
const STATUS_HOST_ID = 'element-shot-status-host';
const WORKFLOW_HOST_ID = 'element-shot-workflow-host';
const t = (key: string, fallback: string, substitutions?: string | string[]): string =>
  message(key, fallback, substitutions);

interface PickerUi {
  highlight: HTMLDivElement;
  host: HTMLDivElement;
  label: HTMLDivElement;
  multiHighlights: Map<HTMLElement, HTMLDivElement>;
}

interface WorkflowUi {
  captureButton: HTMLButtonElement;
  editButton: HTMLButtonElement;
  hideButton: HTMLButtonElement;
  hideFixed: HTMLInputElement;
  host: HTMLDivElement;
  selectButton: HTMLButtonElement;
  targetLabel: HTMLDivElement;
}

interface EditableSnapshot {
  contentEditable: string | null;
  element: HTMLElement;
  html: string;
}

interface HiddenPreviewSnapshot {
  element: HTMLElement;
  hadStyleAttribute: boolean;
  priority: string;
  value: string;
}

interface CaptureIndicatorSnapshot {
  animationPriority: string;
  animationValue: string;
  element: HTMLElement;
  hadStyleAttribute: boolean;
  outlineOffsetPriority: string;
  outlineOffsetValue: string;
  outlinePriority: string;
  outlineValue: string;
  styleElement: HTMLStyleElement;
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

function workflowModeLabel(mode: CaptureMode): string {
  const labels: Record<CaptureMode, string> = {
    allScrollable: t('allScrollableMode', '全部滚动元素'),
    custom: t('customMode', '手动滚动截图'),
    element: t('elementMode', '元素截图'),
    focus: t('focusMode', '聚焦截图'),
    fullPage: t('fullPageMode', '整页截图'),
    region: t('regionMode', '区域截图'),
  };
  return labels[mode];
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
    .highlight { position: fixed; box-sizing: border-box; border: 2px solid #ff4d2e; background: rgb(255 77 46 / 12%); box-shadow: 0 0 0 1px rgb(255 255 255 / 80%), 0 8px 28px rgb(20 24 33 / 18%); transform: translateZ(0); }
    .multi-highlight { position: fixed; box-sizing: border-box; border: 2px solid #149c68; background: rgb(20 156 104 / 11%); box-shadow: 0 0 0 1px rgb(255 255 255 / 70%); transform: translateZ(0); }
    .multi-highlight[data-selected="false"] { border-color: #9aa49e; background: rgb(154 164 158 / 9%); opacity: .58; }
    .label { position: fixed; max-width: min(360px, calc(100vw - 24px)); padding: 7px 10px; border-radius: 4px; color: #f8fafc; background: #171a21; box-shadow: 0 8px 24px rgb(20 24 33 / 24%); font: 600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  const label = document.createElement('div');
  label.className = 'label';
  shadow.append(style, highlight, label);
  document.documentElement.append(host);
  return { highlight, host, label, multiHighlights: new Map() };
}

function elementLabel(element: HTMLElement): string {
  if (element === document.documentElement || element === document.body) {
    return t('page', '整页');
  }
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = Array.from(element.classList)
    .slice(0, 2)
    .map((name) => `.${name}`)
    .join('');
  return `${tagName}${id}${className}`;
}

function updatePickerUi(ui: PickerUi, element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  ui.highlight.style.removeProperty('display');
  ui.label.style.removeProperty('display');
  for (const highlight of ui.multiHighlights.values()) {
    highlight.style.display = 'none';
  }
  Object.assign(ui.highlight.style, {
    height: `${Math.max(0, rect.height)}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(0, rect.width)}px`,
  });
  ui.label.textContent = elementLabel(element);
  const labelTop = rect.top >= 38 ? rect.top - 32 : rect.bottom + 8;
  Object.assign(ui.label.style, {
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 180))}px`,
    top: `${Math.max(8, Math.min(labelTop, window.innerHeight - 38))}px`,
  });
}

function updateMultiPickerUi(
  ui: PickerUi,
  elements: Iterable<HTMLElement>,
  selected: ReadonlySet<HTMLElement>,
): void {
  const wanted = new Set(elements);
  for (const [element, highlight] of ui.multiHighlights) {
    if (!wanted.has(element)) {
      highlight.remove();
      ui.multiHighlights.delete(element);
    }
  }
  const shadow = ui.host.shadowRoot;
  if (!shadow) return;
  for (const element of wanted) {
    let highlight = ui.multiHighlights.get(element);
    if (!highlight) {
      highlight = document.createElement('div');
      highlight.className = 'multi-highlight';
      shadow.append(highlight);
      ui.multiHighlights.set(element, highlight);
    }
    highlight.style.removeProperty('display');
    const rect = element.getBoundingClientRect();
    Object.assign(highlight.style, {
      height: `${Math.max(0, rect.height)}px`,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${Math.max(0, rect.width)}px`,
    });
    highlight.dataset.selected = String(selected.has(element));
  }
  ui.highlight.style.display = 'none';
  ui.label.style.display = 'none';
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
    maxWidth: '320px',
    padding: '10px 13px',
  });
  messageElement.textContent = message;
  shadow.append(messageElement);
  document.documentElement.append(host);
  window.setTimeout(() => host.remove(), state === 'success' ? 2600 : 5000);
}

function createWorkflowUi(mode: CaptureMode): WorkflowUi {
  document.getElementById(WORKFLOW_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = WORKFLOW_HOST_ID;
  host.style.setProperty('all', 'initial', 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('left', '18px', 'important');
  host.style.setProperty('bottom', '18px', 'important');
  host.style.setProperty('z-index', '2147483647', 'important');
  host.style.setProperty('pointer-events', 'auto', 'important');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .panel { width: min(390px, calc(100vw - 36px)); overflow: hidden; border: 1px solid #c8d0cc; border-radius: 6px; color: #171a21; background: rgb(250 252 251 / 97%); box-shadow: 0 14px 44px rgb(20 24 33 / 26%); font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
    .header { display: flex; min-height: 36px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px 0 14px; border-bottom: 1px solid #dbe1de; background: #eef2f0; cursor: grab; touch-action: none; user-select: none; }
    .header:active { cursor: grabbing; }
    .drag-grip { width: 18px; height: 16px; opacity: .62; background: radial-gradient(circle, #65706a 1.2px, transparent 1.4px) 0 0 / 6px 6px; }
    .body { padding: 11px 14px 14px; }
    .eyebrow { color: #7b8580; font: 700 10px ui-monospace, monospace; letter-spacing: .12em; }
    .target { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint { margin: 8px 0 10px; color: #65706a; font-size: 11px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #e0e5e2; }
    .check { display: flex; align-items: center; gap: 7px; color: #424a46; font-size: 11px; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-top: 11px; }
    button { min-height: 32px; padding: 0 10px; border: 1px solid #aeb8b2; border-radius: 4px; color: #424a46; background: #fff; cursor: pointer; font: 700 11px ui-sans-serif, system-ui, sans-serif; }
    button.primary { border-color: #171a21; color: #fff; background: #171a21; box-shadow: 3px 3px 0 #ff4d2e; }
    button:hover { border-color: #171a21; }
  `;
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <header class="header" data-drag-handle title="${t('dragToolbar', '拖动工具栏')}">
      <div class="eyebrow">${workflowModeLabel(mode)}</div>
      <span class="drag-grip" aria-hidden="true"></span>
    </header>
    <div class="body">
      <div class="target"></div>
      <div class="hint">${t('workflowHint', '可重新选择目标、编辑页面或隐藏元素，完成后确认截图。')}</div>
      <div class="row"><label class="check"><input type="checkbox" checked data-hide-fixed />${t('hideFixed', '隐藏固定/吸顶元素')}</label><button type="button" data-hide>${t('chooseHidden', '选择隐藏元素')}</button></div>
      <div class="actions"><button type="button" data-select>${t('selectElement', '选择元素')}</button><button type="button" data-edit>${t('editPage', '编辑页面')}</button><button class="primary" type="button" data-capture>${mode === 'custom' ? t('manualCaptureConfirm', '滚动后按任意键完成截图') : t('captureConfirm', '确定截图')}</button></div>
    </div>
  `;
  shadow.append(style, panel);
  document.documentElement.append(host);
  const dragHandle = panel.querySelector<HTMLElement>('[data-drag-handle]')!;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragHandle.hasPointerCapture(event.pointerId)) return;
    const panelRect = panel.getBoundingClientRect();
    const left = Math.max(
      0,
      Math.min(window.innerWidth - panelRect.width, event.clientX - dragOffsetX),
    );
    const top = Math.max(
      0,
      Math.min(window.innerHeight - panelRect.height, event.clientY - dragOffsetY),
    );
    host.style.setProperty('left', `${left}px`, 'important');
    host.style.setProperty('top', `${top}px`, 'important');
  };
  dragHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const hostRect = host.getBoundingClientRect();
    dragOffsetX = event.clientX - hostRect.left;
    dragOffsetY = event.clientY - hostRect.top;
    host.style.setProperty('left', `${hostRect.left}px`, 'important');
    host.style.setProperty('top', `${hostRect.top}px`, 'important');
    host.style.setProperty('bottom', 'auto', 'important');
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener('pointermove', handlePointerMove);
  dragHandle.addEventListener('pointerup', (event) => {
    if (dragHandle.hasPointerCapture(event.pointerId)) {
      dragHandle.releasePointerCapture(event.pointerId);
    }
  });
  dragHandle.addEventListener('pointercancel', (event) => {
    if (dragHandle.hasPointerCapture(event.pointerId)) {
      dragHandle.releasePointerCapture(event.pointerId);
    }
  });
  return {
    captureButton: panel.querySelector<HTMLButtonElement>('[data-capture]')!,
    editButton: panel.querySelector<HTMLButtonElement>('[data-edit]')!,
    hideButton: panel.querySelector<HTMLButtonElement>('[data-hide]')!,
    hideFixed: panel.querySelector<HTMLInputElement>('[data-hide-fixed]')!,
    host,
    selectButton: panel.querySelector<HTMLButtonElement>('[data-select]')!,
    targetLabel: panel.querySelector<HTMLDivElement>('.target')!,
  };
}

function downloadBlob(blob: Blob, extension: 'png' | 'zip'): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.download = `element-shot-${timestamp}.${extension}`;
  link.href = url;
  link.style.display = 'none';
  document.documentElement.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取预览图片。'));
    }, { once: true });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取预览图片。')), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function previewBlob(blob: Blob): Promise<void> {
  const request: OpenPreviewRequest = {
    dataUrl: await blobToDataUrl(blob),
    type: MESSAGE_TYPES.OPEN_PREVIEW,
  };
  const response: unknown = await browser.runtime.sendMessage(request);
  if (isRecord(response) && response.ok === false && typeof response.error === 'string') {
    throw new Error(response.error);
  }
}

function eventElement(event: Event): HTMLElement | null {
  const element = event.composedPath().find(
    (target): target is HTMLElement => target instanceof HTMLElement,
  );
  return element ?? null;
}

function resolveCaptureTarget(element: HTMLElement): HTMLElement {
  let candidate: HTMLElement | null = element;
  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    const { overflowY } = getComputedStyle(candidate);
    if ((overflowY === 'auto' || overflowY === 'scroll') && candidate.scrollHeight > candidate.clientHeight) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return element;
}

function isScrollableElement(element: HTMLElement): boolean {
  if (
    element.id === PICKER_HOST_ID ||
    element.id === STATUS_HOST_ID ||
    element.id === WORKFLOW_HOST_ID
  ) {
    return false;
  }
  if (element === document.documentElement) {
    const style = getComputedStyle(element);
    return (
      style.overflowY !== 'hidden' &&
      style.overflowY !== 'clip' &&
      element.scrollHeight > element.clientHeight
    );
  }
  const style = getComputedStyle(element);
  return (style.overflowY === 'auto' || style.overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
}

function resolveScrollableParent(element: HTMLElement): HTMLElement | null {
  let candidate = element.parentElement;
  while (candidate && candidate !== document.body && candidate !== document.documentElement) {
    if (isScrollableElement(candidate)) return candidate;
    candidate = candidate.parentElement;
  }
  if (document.body && isScrollableElement(document.body)) return document.body;
  if (isScrollableElement(document.documentElement)) return document.documentElement;
  return null;
}

interface FocusStyleSnapshot {
  attributeValues: Array<{ element: HTMLElement; hadAttribute: boolean; value: string | null }>;
  styleElement: HTMLStyleElement;
}

function applyFocusCaptureStyles(target: HTMLElement): () => void {
  const attribute = 'data-element-shot-focus-path';
  const token = `shot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const chain: HTMLElement[] = [];
  let current: HTMLElement | null = target;
  while (current) {
    chain.unshift(current);
    if (current === document.documentElement) break;
    current = current.parentElement;
  }
  if (chain[0] !== document.documentElement) chain.unshift(document.documentElement);

  const snapshot: FocusStyleSnapshot = {
    attributeValues: chain.map((element) => ({
      element,
      hadAttribute: element.hasAttribute(attribute),
      value: element.getAttribute(attribute),
    })),
    styleElement: document.createElement('style'),
  };
  snapshot.styleElement.dataset.elementShotFocus = 'true';
  const rules: string[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    const marker = `${token}-${index}`;
    chain[index].setAttribute(attribute, marker);
    if (index < chain.length - 1) {
      rules.push(
        `[${attribute}="${marker}"] { overflow: visible !important; overflow-x: visible !important; overflow-y: visible !important; height: 100% !important; min-height: 0 !important; max-height: none !important; min-width: 0 !important; max-width: none !important; contain: none !important; }`,
      );
      rules.push(
        `[${attribute}="${marker}"] > *:not([${attribute}="${token}-${index + 1}"]) { display: none !important; }`,
      );
    }
  }
  snapshot.styleElement.textContent = rules.join('\n');
  document.documentElement.append(snapshot.styleElement);

  return () => {
    snapshot.styleElement.remove();
    for (const { element, hadAttribute, value } of snapshot.attributeValues) {
      if (hadAttribute) element.setAttribute(attribute, value ?? '');
      else element.removeAttribute(attribute);
    }
  };
}

function resolveFullPageDefaultTarget(): HTMLElement {
  const root = document.documentElement;
  if (isScrollableElement(root)) return root;
  const candidates = [
    ...(document.body ? [document.body] : []),
    ...document.querySelectorAll<HTMLElement>('*'),
  ];
  return candidates.find(isScrollableElement) ?? root;
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createCaptureOptions(
  settings: CaptureSettings,
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void,
): CaptureElementOptions {
  return {
    minCaptureIntervalMs: Math.max(520, settings.intervalMs),
    onProgress,
    // Scroll position is always restored; the user-configurable restore
    // switches apply only to hidden styles and edited DOM content.
    restoreHiddenElements: true,
    restoreScrollPosition: true,
    signal,
    settleDelayMs: Math.max(0, settings.settleDelayMs),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfCaptureAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('截图已被用户中断。', 'AbortError');
}

function captureFilename(index: number): string {
  return `scrollable-${String(index + 1).padStart(2, '0')}.png`;
}

function createPickerController(): (command: StartPickCommand) => Promise<void> {
  let activeCommand: StartPickCommand | null = null;
  let captureAbortController: AbortController | null = null;
  let captureInProgress = false;
  let currentElement: HTMLElement = document.documentElement;
  let activeMode: CaptureMode = 'region';
  let editableSnapshot: EditableSnapshot | null = null;
  let hiddenElements = new Set<HTMLElement>();
  let hiddenPreviewSnapshots = new Map<HTMLElement, HiddenPreviewSnapshot>();
  let allScrollableCandidates = new Set<HTMLElement>();
  let selectedScrollableElements = new Set<HTMLElement>();
  let hideMode = false;
  let isPicking = false;
  let ui: PickerUi | null = null;
  let workflow: WorkflowUi | null = null;
  let workflowKeyHandler: ((event: KeyboardEvent) => void) | null = null;

  const isEventInsideWorkflow = (event: Event): boolean => {
    const target = event.target;
    const path = event.composedPath();
    const shadowTarget = target instanceof Node && (
      Boolean(workflow?.host.shadowRoot?.contains(target))
    );
    return (
      Boolean(workflow && path.includes(workflow.host)) ||
      shadowTarget
    );
  };

  const handleHidePointerDown = (event: PointerEvent): void => {
    if (!hideMode || isEventInsideWorkflow(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const stopPicking = (): void => {
    isPicking = false;
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('click', handleClick, true);
    window.removeEventListener('pointerdown', handleHidePointerDown, true);
    window.removeEventListener('keydown', handleKeyDown, true);
    ui?.host.remove();
    ui = null;
  };

  const interruptCapture = (event: Event): void => {
    if (!captureInProgress || !captureAbortController) return;
    if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    captureAbortController.abort();
  };

  const finishEditableRestore = (restoreContent = true): void => {
    if (!editableSnapshot) return;
    if (restoreContent) {
      editableSnapshot.element.innerHTML = editableSnapshot.html;
    }
    // contenteditable is always temporary. The setting controls the edited
    // HTML only, not whether the page remains in an editing state.
    if (editableSnapshot.contentEditable === null) editableSnapshot.element.removeAttribute('contenteditable');
    else editableSnapshot.element.setAttribute('contenteditable', editableSnapshot.contentEditable);
    editableSnapshot = null;
  };

  const applyHiddenPreview = (element: HTMLElement): void => {
    if (!hiddenPreviewSnapshots.has(element)) {
      hiddenPreviewSnapshots.set(element, {
        element,
        hadStyleAttribute: element.hasAttribute('style'),
        priority: element.style.getPropertyPriority('opacity'),
        value: element.style.getPropertyValue('opacity'),
      });
    }
    element.style.setProperty('opacity', '0.35', 'important');
  };

  const restoreHiddenPreviews = (): void => {
    for (const { element, hadStyleAttribute, priority, value } of hiddenPreviewSnapshots.values()) {
      if (value) element.style.setProperty('opacity', value, priority);
      else element.style.removeProperty('opacity');
      if (!hadStyleAttribute && element.getAttribute('style') === '') {
        element.removeAttribute('style');
      }
    }
    hiddenPreviewSnapshots = new Map();
  };

  const applyManualCaptureIndicator = (element: HTMLElement): (() => void) => {
    const rect = element.getBoundingClientRect();
    const isFullScreen =
      rect.left <= 1 &&
      rect.top <= 1 &&
      rect.width >= window.innerWidth - 2 &&
      rect.height >= window.innerHeight - 2;
    if (isFullScreen) return () => undefined;

    const styleElement = document.createElement('style');
    styleElement.dataset.elementShotIndicator = 'true';
    styleElement.textContent = `
      @keyframes element-shot-capture-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: .35; }
      }
    `;
    document.documentElement.append(styleElement);
    const snapshot: CaptureIndicatorSnapshot = {
      animationPriority: element.style.getPropertyPriority('animation'),
      animationValue: element.style.getPropertyValue('animation'),
      element,
      hadStyleAttribute: element.hasAttribute('style'),
      outlineOffsetPriority: element.style.getPropertyPriority('outline-offset'),
      outlineOffsetValue: element.style.getPropertyValue('outline-offset'),
      outlinePriority: element.style.getPropertyPriority('outline'),
      outlineValue: element.style.getPropertyValue('outline'),
      styleElement,
    };
    element.style.setProperty('outline', '3px solid #ff4d2e', 'important');
    element.style.setProperty('outline-offset', '3px', 'important');
    element.style.setProperty(
      'animation',
      'element-shot-capture-pulse 900ms ease-in-out infinite',
      'important',
    );
    return () => {
      if (snapshot.outlineValue) element.style.setProperty('outline', snapshot.outlineValue, snapshot.outlinePriority);
      else element.style.removeProperty('outline');
      if (snapshot.outlineOffsetValue) element.style.setProperty('outline-offset', snapshot.outlineOffsetValue, snapshot.outlineOffsetPriority);
      else element.style.removeProperty('outline-offset');
      if (snapshot.animationValue) element.style.setProperty('animation', snapshot.animationValue, snapshot.animationPriority);
      else element.style.removeProperty('animation');
      if (!snapshot.hadStyleAttribute && element.getAttribute('style') === '') {
        element.removeAttribute('style');
      }
      snapshot.styleElement.remove();
    };
  };

  const startCapture = async (
    mode: CaptureMode,
    target: HTMLElement | null,
    settings: CaptureSettings,
    customHiddenElements: readonly HTMLElement[] = [],
    hideFixedElements = true,
    selectedScrollableElements: readonly HTMLElement[] = [],
  ): Promise<void> => {
    if (captureInProgress) return;
    const effectiveSettings = normalizeCaptureSettings(settings);
    document.getElementById(STATUS_HOST_ID)?.remove();
    captureInProgress = true;
    captureAbortController = new AbortController();
    const automaticallyScrolling = mode !== 'custom';
    if (automaticallyScrolling) {
      window.addEventListener('pointerdown', interruptCapture, true);
      window.addEventListener('keydown', interruptCapture, true);
    }
    const signal = captureAbortController.signal;
    // Progress UI is intentionally disabled during capture: this content is
    // part of the page bitmap returned by captureVisibleTab and would appear
    // inside the exported screenshot. The final status is shown after stitch.
    const progress = (): void => undefined;
    let restoreCaptureIndicator: (() => void) | null = null;
    let restoreFocusStyles: (() => void) | null = null;
    try {
      let result: CaptureResult;
      const options = createCaptureOptions(effectiveSettings, signal, progress);
      restoreHiddenPreviews();
      if (mode === 'fullPage') {
        if (!target) throw new Error('未能识别整页截图目标。');
        result = target === document.documentElement || target === document.body
          ? await capturePage({
              ...options,
              hiddenElements: customHiddenElements,
              hideFixedElements,
            })
          : await captureElement(target, {
              ...options,
              hiddenElements: customHiddenElements,
              hideFixedElements,
            });
      } else if (mode === 'custom') {
        if (!target) throw new Error('未能识别手动滚动截图目标。');
        restoreCaptureIndicator = applyManualCaptureIndicator(target);
        result = await captureManualScrollElement(target, {
          ...options,
          hiddenElements: customHiddenElements,
          hideFixedElements,
        });
      } else if (mode === 'focus') {
        if (!target) throw new Error('未能识别聚焦截图目标。');
        restoreFocusStyles = applyFocusCaptureStyles(target);
        result = await captureElement(target, {
          ...options,
          hiddenElements: customHiddenElements,
          hideFixedElements,
        });
      } else if (mode === 'element') {
        if (!target) throw new Error('未能识别元素截图目标。');
        result = await captureElement(target, {
          ...options,
          hiddenElements: customHiddenElements,
          hideFixedElements,
          scrollParent: resolveScrollableParent(target),
        });
      } else if (mode === 'allScrollable') {
        const candidates = Array.from(new Set(selectedScrollableElements));
        if (candidates.length === 0) throw new Error('请至少选择一个可滚动元素。');
        if (candidates.some(
          (candidate) => !candidate.isConnected || !isScrollableElement(candidate),
        )) {
          throw new Error('批量截图目标在确认后发生变化，请重新选择。');
        }
        const entries: ZipEntry[] = [];
        const originalX = window.scrollX;
        const originalY = window.scrollY;
        try {
          for (const [index, candidate] of candidates.entries()) {
            throwIfCaptureAborted(signal);
            if (candidate !== document.documentElement) {
              candidate.scrollIntoView({ block: 'center', inline: 'nearest' });
              await waitForFrame();
            }
            const item = candidate === document.documentElement
              ? await capturePage({
                  ...options,
                  hiddenElements: customHiddenElements,
                  hideFixedElements,
                })
              : await captureElement(candidate, {
                  ...options,
                  hiddenElements: customHiddenElements,
                  hideFixedElements,
                  restoreScrollPosition: true,
                });
            const blob = await stitchFramesToPng(item);
            entries.push({ data: blob, name: captureFilename(index) });
          }
        } finally {
          window.scrollTo(originalX, originalY);
        }
        const zip = await createZipBlob(entries);
        downloadBlob(zip, 'zip');
        createStatusHost('success', t('batchDownloaded', `批量截图已下载（${entries.length} 个文件）`, String(entries.length)));
        return;
      } else {
        if (!target) throw new Error('未能识别截图目标。');
        result = await captureElement(target, {
          ...options,
          hiddenElements: customHiddenElements,
          hideFixedElements,
        });
      }

      const blob = await stitchFramesToPng(result);
      if (effectiveSettings.preview) await previewBlob(blob);
      else downloadBlob(blob, 'png');
      createStatusHost('success', effectiveSettings.preview ? t('previewOpened', '预览已打开') : t('captureReady', '完整截图已下载'));
    } catch (error) {
      if (isAbortError(error)) createStatusHost('error', t('captureInterrupted', '截图已中断，页面状态已恢复。'));
      else {
        console.error('[Screenshot Suite] Capture failed:', error);
        createStatusHost('error', errorMessage(error));
      }
    } finally {
      window.removeEventListener('pointerdown', interruptCapture, true);
      window.removeEventListener('keydown', interruptCapture, true);
      captureAbortController = null;
      captureInProgress = false;
      restoreCaptureIndicator?.();
      restoreFocusStyles?.();
      restoreHiddenPreviews();
      finishEditableRestore(effectiveSettings.restoreEditedContent);
      workflow?.host.remove();
      workflow = null;
      if (workflowKeyHandler) {
        window.removeEventListener('keydown', workflowKeyHandler, true);
        workflowKeyHandler = null;
      }
      hiddenElements = new Set();
    }
  };

  const updateWorkflowTargetLabel = (): void => {
    if (!workflow) return;
    workflow.targetLabel.textContent = activeMode === 'allScrollable'
      ? t('selectedScrollable', `已选 ${selectedScrollableElements.size} 个可滚动元素`, String(selectedScrollableElements.size))
      : elementLabel(currentElement);
  };

  const updateCurrentTarget = (element: HTMLElement, mode: CaptureMode): void => {
    currentElement = mode === 'region' || mode === 'custom'
      ? resolveCaptureTarget(element)
      : element;
    if (ui) updatePickerUi(ui, currentElement);
    updateWorkflowTargetLabel();
  };

  const updateScrollableHighlights = (): void => {
    if (ui) updateMultiPickerUi(ui, allScrollableCandidates, selectedScrollableElements);
  };

  const findScrollableTarget = (element: HTMLElement): HTMLElement | null => {
    let candidate: HTMLElement | null = element;
    while (candidate) {
      if (allScrollableCandidates.has(candidate)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };

  const toggleHideMode = (): void => {
    if (!workflow) return;
    hideMode = !hideMode;
    if (hideMode) {
      currentElement.blur();
    }
    workflow.hideButton.textContent = hideMode
      ? t('finishSelection', '完成选择')
      : `${t('chooseHidden', '选择隐藏元素')}${hiddenElements.size ? ` (${hiddenElements.size})` : ''}`;
    isPicking = hideMode;
    if (hideMode) {
      ui ??= createPickerUi();
      if (activeMode === 'allScrollable') updateScrollableHighlights();
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('pointerdown', handleHidePointerDown, true);
      window.addEventListener('click', handleClick, true);
    } else {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerdown', handleHidePointerDown, true);
      window.removeEventListener('click', handleClick, true);
      ui?.host.remove();
      ui = null;
    }
  };

  const cancelCustomWorkflow = (): void => {
    stopPicking();
    hideMode = false;
    workflow?.host.remove();
    workflow = null;
    hiddenElements = new Set();
    restoreHiddenPreviews();
    finishEditableRestore();
    if (workflowKeyHandler) {
      window.removeEventListener('keydown', workflowKeyHandler, true);
      workflowKeyHandler = null;
    }
  };

  const handleWorkflowKeyDown = (event: KeyboardEvent): void => {
    if (!workflow || captureInProgress) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelCustomWorkflow();
      return;
    }
    if (activeMode === 'allScrollable' || editableSnapshot || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const next = event.key === 'ArrowUp'
      ? currentElement.parentElement
      : currentElement === document.documentElement
        ? document.body
        : Array.from(currentElement.children).find((child) => {
            if (!(child instanceof HTMLElement)) return false;
            const tagName = child.tagName.toLowerCase();
            if (tagName === 'script' || tagName === 'style' || tagName === 'link' || tagName === 'meta') return false;
            const rect = child.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
    if (next instanceof HTMLElement) {
      event.preventDefault();
      updateCurrentTarget(next, activeMode);
    }
  };

  const showWorkflow = (target: HTMLElement, mode: CaptureMode): void => {
    workflow?.host.remove();
    if (workflowKeyHandler) {
      window.removeEventListener('keydown', workflowKeyHandler, true);
    }
    currentElement = target;
    workflow = createWorkflowUi(mode);
    ui ??= createPickerUi();
    if (activeMode === 'allScrollable') updateScrollableHighlights();
    else updatePickerUi(ui, currentElement);
    updateWorkflowTargetLabel();
    workflowKeyHandler = handleWorkflowKeyDown;
    window.addEventListener('keydown', workflowKeyHandler, true);
    workflow.selectButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    workflow.selectButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (editableSnapshot) finishEditableRestore();
      hideMode = false;
      isPicking = true;
      ui ??= createPickerUi();
      if (activeMode === 'allScrollable') updateScrollableHighlights();
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('click', handleClick, true);
      if (activeMode === 'region') window.addEventListener('keydown', handleKeyDown, true);
      workflow!.selectButton.textContent = t('selecting', '选择中');
    });
    workflow.hideButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    workflow.hideButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleHideMode();
    });
    workflow.editButton.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    workflow.editButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const editableTarget = currentElement === document.documentElement ? document.body : currentElement;
      if (!editableSnapshot) {
        editableSnapshot = {
          contentEditable: editableTarget.getAttribute('contenteditable'),
          element: editableTarget,
          html: editableTarget.innerHTML,
        };
        editableTarget.setAttribute('contenteditable', 'true');
        editableTarget.focus();
        workflow!.editButton.textContent = t('editing', '编辑中');
      }
    });
    workflow.captureButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideMode = false;
      const hideFixed = workflow?.hideFixed.checked ?? true;
      const captureMode = activeMode;
      const captureTarget = captureMode === 'allScrollable' ? null : currentElement;
      const selected = [...selectedScrollableElements];
      const command = activeCommand;
      stopPicking();
      workflow?.host.remove();
      if (!command) return;
      void startCapture(captureMode, captureTarget, command.settings, [...hiddenElements], hideFixed, selected);
    });
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (isEventInsideWorkflow(event)) return;
    const element = eventElement(event);
    if (!element || element.id === PICKER_HOST_ID || element.id === WORKFLOW_HOST_ID || element.closest(`#${WORKFLOW_HOST_ID}`)) return;
    if (hideMode) {
      if (ui) updatePickerUi(ui, element);
    } else if (activeCommand?.mode === 'allScrollable') {
      updateScrollableHighlights();
    } else if (activeCommand && workflow) {
      if (ui) updatePickerUi(ui, element);
    } else if (activeCommand) {
      updateCurrentTarget(element, activeCommand.mode);
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (captureInProgress) captureAbortController?.abort();
      else stopPicking();
      return;
    }
  };

  const handleClick = (event: MouseEvent): void => {
    if (!isPicking || captureInProgress) return;
    if (isEventInsideWorkflow(event)) {
      return;
    }
    const element = eventElement(event);
    if (!element || element.id === PICKER_HOST_ID || element.id === WORKFLOW_HOST_ID || element.closest(`#${WORKFLOW_HOST_ID}`)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (hideMode) {
      if (hiddenElements.has(element)) {
        hiddenElements.delete(element);
        const preview = hiddenPreviewSnapshots.get(element);
        if (preview) {
          if (preview.value) element.style.setProperty('opacity', preview.value, preview.priority);
          else element.style.removeProperty('opacity');
          if (!preview.hadStyleAttribute && element.getAttribute('style') === '') {
            element.removeAttribute('style');
          }
          hiddenPreviewSnapshots.delete(element);
        }
      } else {
        hiddenElements.add(element);
        applyHiddenPreview(element);
      }
      if (workflow) workflow.hideButton.textContent = `${t('finishSelection', '完成选择')} (${hiddenElements.size})`;
      return;
    }
    if (activeCommand?.mode === 'allScrollable') {
      const scrollableTarget = findScrollableTarget(element);
      if (!scrollableTarget) return;
      if (selectedScrollableElements.has(scrollableTarget)) selectedScrollableElements.delete(scrollableTarget);
      else selectedScrollableElements.add(scrollableTarget);
      updateScrollableHighlights();
      updateWorkflowTargetLabel();
      return;
    }
    const command = activeCommand;
    if (!command) return;
    stopPicking();
    if (command.mode === 'region') {
      updateCurrentTarget(element, 'region');
      showWorkflow(currentElement, 'region');
      isPicking = false;
    } else {
      updateCurrentTarget(
        element === document.body ? document.documentElement : element,
        command.mode,
      );
      showWorkflow(currentElement, command.mode);
      isPicking = false;
    }
  };

  const start = async (command: StartPickCommand): Promise<void> => {
    const normalizedSettings = normalizeCaptureSettings(command.settings);
    const locale = await loadLocale(normalizedSettings.language);
    if (captureInProgress) {
      createStatusHost('error', t('captureInProgress', '当前截图尚未完成。'));
      return;
    }
    cancelCustomWorkflow();
    document.getElementById(STATUS_HOST_ID)?.remove();
    const normalizedCommand: StartPickCommand = {
      mode:
        command.mode === 'custom' ||
        command.mode === 'element' ||
        command.mode === 'focus' ||
        command.mode === 'fullPage' ||
        command.mode === 'allScrollable'
          ? command.mode
          : 'region',
      settings: { ...normalizedSettings, language: locale },
      type: MESSAGE_TYPES.START_PICK,
    };
    activeCommand = normalizedCommand;
    activeMode = normalizedCommand.mode;
    stopPicking();
    selectedScrollableElements = new Set();
    allScrollableCandidates = new Set();
    ui = createPickerUi();
    if (normalizedCommand.mode === 'allScrollable') {
      const candidates = Array.from(new Set<HTMLElement>([
        document.documentElement,
        ...(document.body ? [document.body] : []),
        ...document.querySelectorAll<HTMLElement>('*'),
      ])).filter(isScrollableElement);
      allScrollableCandidates = new Set(candidates);
      selectedScrollableElements = new Set(candidates);
      updateMultiPickerUi(ui, candidates, selectedScrollableElements);
      showWorkflow(candidates[0] ?? document.documentElement, 'allScrollable');
      isPicking = true;
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('click', handleClick, true);
      window.addEventListener('keydown', handleKeyDown, true);
      return;
    }
    if (normalizedCommand.mode === 'fullPage') {
      currentElement = resolveFullPageDefaultTarget();
      updatePickerUi(ui, currentElement);
      showWorkflow(currentElement, 'fullPage');
      return;
    }
    if (normalizedCommand.mode === 'custom') {
      currentElement = document.documentElement;
      updatePickerUi(ui, currentElement);
      showWorkflow(currentElement, 'custom');
      isPicking = true;
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('click', handleClick, true);
      return;
    }
    if (normalizedCommand.mode === 'element' || normalizedCommand.mode === 'focus') {
      currentElement = document.documentElement;
      updatePickerUi(ui, currentElement);
      showWorkflow(currentElement, normalizedCommand.mode);
      workflow!.targetLabel.textContent = t('captureElementPrompt', '请选择一个截图元素');
      workflow!.captureButton.disabled = true;
      workflow!.selectButton.textContent = t('selecting', '选择中');
      isPicking = true;
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('click', handleClick, true);
      window.addEventListener('keydown', handleKeyDown, true);
      return;
    }
    currentElement = document.documentElement;
    updatePickerUi(ui, currentElement);
    showWorkflow(currentElement, 'region');
    workflow!.targetLabel.textContent = t('captureRegionPrompt', '请选择一个截图区域');
    workflow!.captureButton.disabled = true;
    workflow!.selectButton.textContent = t('selecting', '选择中');
    isPicking = true;
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('click', handleClick, true);
    window.addEventListener('keydown', handleKeyDown, true);
  };

  return start;
}

export default defineUnlistedScript(() => {
  const startPicking = createPickerController();
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender,
      sendResponse: (response: CommandResponse) => void,
    ): true | undefined => {
      if (hasMessageType(message, MESSAGE_TYPES.CONTENT_PING)) {
        const request: ContentPingRequest = message;
        void request;
        sendResponse({ ok: true });
        return;
      }
      if (hasMessageType(message, MESSAGE_TYPES.START_PICK)) {
        const command = message as StartPickCommand;
        void startPicking(command)
          .then(() => sendResponse({ ok: true }))
          .catch((error: unknown) => sendResponse({ error: errorMessage(error), ok: false }));
        return true;
      }
    },
  );
});

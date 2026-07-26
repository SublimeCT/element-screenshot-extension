import {
  CAPTURE_SETTLE_DELAY_MS,
  MAX_CAPTURE_SEGMENTS,
  MESSAGE_TYPES,
  MIN_CAPTURE_INTERVAL_MS,
} from './constants';
import {
  cssPixels,
  devicePixels,
  type CaptureFrame,
  type CaptureResult,
  type CaptureTabRequest,
  type CaptureTabResponse,
  type CssPixels,
  type CssRect,
  type DevicePixels,
  type DeviceRect,
} from './types';

export interface HiddenElementState {
  element: HTMLElement;
  hadStyleAttribute: boolean;
  property: 'opacity' | 'visibility';
  priority: string;
  value: string;
}

interface InnerVisualGeometry {
  rect: CssRect;
  scaleX: number;
  scaleY: number;
}

interface ManualCapturedFrame {
  clipRect: DeviceRect;
  dataUrl: string;
  position: CssPixels;
  viewportHeight: CssPixels;
}

export interface CaptureElementOptions {
  hideFixedElements?: boolean;
  hiddenElements?: readonly HTMLElement[];
  minCaptureIntervalMs?: number;
  onProgress?: (completed: number, total: number) => void;
  restoreHiddenElements?: boolean;
  restoreScrollPosition?: boolean;
  scrollParent?: HTMLElement | null;
  signal?: AbortSignal;
  settleDelayMs?: number;
}

const VIEWPORT_TOLERANCE_CSS_PX = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCaptureTabResponse(value: unknown): value is CaptureTabResponse {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    return false;
  }

  return value.ok
    ? typeof value.dataUrl === 'string'
    : typeof value.error === 'string';
}

interface PngDimensions {
  height: number;
  width: number;
}

function readPngDimensions(dataUrl: string): PngDimensions {
  const separator = dataUrl.indexOf(',');
  if (separator < 0 || !dataUrl.startsWith('data:image/png')) {
    throw new Error('截图服务返回的不是 PNG 图片。');
  }

  const binary = atob(dataUrl.slice(separator + 1));
  if (
    binary.length < 24 ||
    binary.charCodeAt(0) !== 0x89 ||
    binary.charCodeAt(1) !== 0x50 ||
    binary.charCodeAt(2) !== 0x4e ||
    binary.charCodeAt(3) !== 0x47
  ) {
    throw new Error('截图服务返回了无效的 PNG 图片。');
  }

  const readUint32 = (offset: number): number =>
    ((binary.charCodeAt(offset) << 24) |
      (binary.charCodeAt(offset + 1) << 16) |
      (binary.charCodeAt(offset + 2) << 8) |
      binary.charCodeAt(offset + 3)) >>> 0;

  const width = readUint32(16);
  const height = readUint32(20);
  if (width <= 0 || height <= 0) {
    throw new Error('截图服务返回了空的 PNG 图片。');
  }
  return { height, width };
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('截图已被用户中断。', 'AbortError');
  }
}

export function restoreHiddenElements(states: HiddenElementState[]): void {
  for (const { element, hadStyleAttribute, property, priority, value } of states) {
    if (value) {
      element.style.setProperty(property, value, priority);
    } else {
      element.style.removeProperty(property);
    }
    if (!hadStyleAttribute && element.getAttribute('style') === '') {
      element.removeAttribute('style');
    }
  }
}

export function applyHideFixedElements(
  target: HTMLElement,
  excludedElements: ReadonlySet<HTMLElement> = new Set(),
): HiddenElementState[] {
  const targetRect = target.getBoundingClientRect();
  const states: HiddenElementState[] = [];
  try {
    for (const candidate of document.querySelectorAll<HTMLElement>('*')) {
      if (
        candidate.id === 'element-shot-picker-host' ||
        candidate.id === 'element-shot-status-host' ||
        candidate.id === 'element-shot-workflow-host' ||
        candidate === target ||
        excludedElements.has(candidate) ||
        candidate.contains(target) ||
        target.contains(candidate)
      ) {
        continue;
      }

      const style = getComputedStyle(candidate);
      if (
        (style.position !== 'fixed' && style.position !== 'sticky') ||
        style.visibility === 'hidden' ||
        !intersects(targetRect, candidate.getBoundingClientRect())
      ) {
        continue;
      }

      states.push({
        element: candidate,
        hadStyleAttribute: candidate.hasAttribute('style'),
        property: 'visibility',
        priority: candidate.style.getPropertyPriority('visibility'),
        value: candidate.style.getPropertyValue('visibility'),
      });
      candidate.style.setProperty('visibility', 'hidden', 'important');
    }
  } catch (error) {
    restoreHiddenElements(states);
    throw error;
  }

  return states;
}

export function applyHideElements(
  elements: readonly HTMLElement[],
): HiddenElementState[] {
  const states: HiddenElementState[] = [];
  try {
    for (const element of elements) {
      const state: HiddenElementState = {
        element,
        hadStyleAttribute: element.hasAttribute('style'),
        property: 'opacity',
        priority: element.style.getPropertyPriority('opacity'),
        value: element.style.getPropertyValue('opacity'),
      };
      states.push(state);
      // Explicitly selected elements are fully removed from the captured
      // frames. The 0.35 opacity preview lives only in the picker
      // (applyHiddenPreview); here, during capture, opacity:0 makes the
      // element invisible without reflowing the layout (unlike display:none).
      // Only this temporary style is restored afterwards.
      element.style.setProperty('opacity', '0', 'important');
    }
    return states;
  } catch (error) {
    restoreHiddenElements(states);
    throw error;
  }
}

export function computeScrollPositions(
  scrollHeight: CssPixels,
  clientHeight: CssPixels,
): CssPixels[] {
  if (clientHeight <= 0) {
    return [];
  }

  const maxScrollTop = cssPixels(Math.max(0, scrollHeight - clientHeight));
  const positions: CssPixels[] = [cssPixels(0)];

  for (
    let position = Number(clientHeight);
    position < maxScrollTop;
    position += clientHeight
  ) {
    positions.push(cssPixels(position));
  }

  if (maxScrollTop > 0 && positions.at(-1) !== maxScrollTop) {
    positions.push(cssPixels(maxScrollTop));
  }

  return positions;
}

function toCssRect(rect: DOMRect): CssRect {
  return {
    bottom: cssPixels(rect.bottom),
    height: cssPixels(rect.height),
    left: cssPixels(rect.left),
    right: cssPixels(rect.right),
    top: cssPixels(rect.top),
    width: cssPixels(rect.width),
  };
}

function readInnerVisualGeometry(element: HTMLElement): InnerVisualGeometry {
  const borderRect = element.getBoundingClientRect();
  if (
    borderRect.width <= 0 ||
    borderRect.height <= 0 ||
    element.offsetWidth <= 0 ||
    element.offsetHeight <= 0
  ) {
    throw new Error('目标元素当前不可见，无法截图。');
  }

  const scaleX = borderRect.width / element.offsetWidth;
  const scaleY = borderRect.height / element.offsetHeight;
  const left = borderRect.left + element.clientLeft * scaleX;
  const top = borderRect.top + element.clientTop * scaleY;
  const width = element.clientWidth * scaleX;
  const height = element.clientHeight * scaleY;

  return {
    rect: {
      bottom: cssPixels(top + height),
      height: cssPixels(height),
      left: cssPixels(left),
      right: cssPixels(left + width),
      top: cssPixels(top),
      width: cssPixels(width),
    },
    scaleX,
    scaleY,
  };
}

function assertFullyVisible(rect: CssRect): void {
  if (
    rect.left < -VIEWPORT_TOLERANCE_CSS_PX ||
    rect.top < -VIEWPORT_TOLERANCE_CSS_PX ||
    rect.right > window.innerWidth + VIEWPORT_TOLERANCE_CSS_PX ||
    rect.bottom > window.innerHeight + VIEWPORT_TOLERANCE_CSS_PX
  ) {
    throw new Error('请先将目标元素完整移入当前视口后再截图。');
  }
}

function intersectWithViewport(rect: CssRect): CssRect {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);

  if (right <= left || bottom <= top) {
    throw new Error('目标元素不在当前视口内。');
  }

  return {
    bottom: cssPixels(bottom),
    height: cssPixels(bottom - top),
    left: cssPixels(left),
    right: cssPixels(right),
    top: cssPixels(top),
    width: cssPixels(right - left),
  };
}

function cssRectToDeviceRect(rect: CssRect, scaleX: number, scaleY = scaleX): DeviceRect {
  // DOMRect is measured in CSS pixels; captureVisibleTab returns physical pixels.
  const x = Math.round(rect.left * scaleX);
  const y = Math.round(rect.top * scaleY);
  return {
    height: devicePixels(Math.max(1, Math.round(rect.height * scaleY))),
    width: devicePixels(Math.max(1, Math.round(rect.width * scaleX))),
    x: devicePixels(x),
    y: devicePixels(y),
  };
}

function applyHideScrollbars(): HTMLStyleElement {
  const style = document.createElement('style');
  style.dataset.elementShotScrollbars = 'true';
  style.textContent = `
    html, body, * { scrollbar-color: transparent transparent !important; }
    html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { background: transparent !important; }
    html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb { background: transparent !important; border-color: transparent !important; }
    html::-webkit-scrollbar-track, body::-webkit-scrollbar-track, *::-webkit-scrollbar-track { background: transparent !important; border-color: transparent !important; }
  `;
  document.documentElement.append(style);
  return style;
}

function restoreHiddenScrollbars(style: HTMLStyleElement | null): void {
  style?.remove();
}

function isSelfScrollableElement(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return (
    (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
    element.scrollHeight > element.clientHeight
  );
}

function computeBottomSliceDeviceRect(
  rect: CssRect,
  dpr: number,
  segmentHeight: DevicePixels,
  outputWidth: DevicePixels,
): DeviceRect {
  // These values are physical pixels. Cropping from the bottom removes overlap
  // between the final scroll step and the preceding full-height frame.
  const bottom = Math.round(rect.bottom * dpr);
  return {
    height: segmentHeight,
    width: outputWidth,
    x: devicePixels(Math.round(rect.left * dpr)),
    y: devicePixels(bottom - segmentHeight),
  };
}

function readBorderVisualRect(element: HTMLElement): CssRect {
  return toCssRect(element.getBoundingClientRect());
}

function positionLockedRect(current: CssRect, lockedSize: CssRect): CssRect {
  // Positions and locked dimensions are CSS pixels. The capture session owns
  // one deterministic size; per-frame DOM reads update only its viewport
  // position before cssRectToDeviceRect converts the crop to physical pixels.
  return {
    bottom: cssPixels(Number(current.top) + Number(lockedSize.height)),
    height: lockedSize.height,
    left: current.left,
    right: cssPixels(Number(current.left) + Number(lockedSize.width)),
    top: current.top,
    width: lockedSize.width,
  };
}

async function waitForTwoAnimationFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function waitForRendering(settleDelayMs: number): Promise<void> {
  await waitForTwoAnimationFrames();
  await new Promise<void>((resolve) => window.setTimeout(resolve, settleDelayMs));
}

async function requestVisibleTabCapture(): Promise<string> {
  const request: CaptureTabRequest = { type: MESSAGE_TYPES.CAPTURE_TAB };
  const response: unknown = await browser.runtime.sendMessage(request);

  if (!isCaptureTabResponse(response)) {
    throw new Error('截图服务返回了无效响应。');
  }
  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.dataUrl;
}

async function captureStaticElement(
  element: HTMLElement,
  options: Required<CaptureElementOptions>,
): Promise<CaptureResult> {
  throwIfAborted(options.signal);
  await waitForRendering(options.settleDelayMs);
  throwIfAborted(options.signal);
  const visibleRect = intersectWithViewport(readBorderVisualRect(element));
  const dataUrl = await requestVisibleTabCapture();
  const dimensions = readPngDimensions(dataUrl);
  const scaleX = dimensions.width / Math.max(1, window.innerWidth);
  const clipRect = cssRectToDeviceRect(visibleRect, scaleX);

  return {
    frames: [{ clipRect, dataUrl }],
    outputHeight: clipRect.height,
    outputWidth: clipRect.width,
  };
}

async function captureElementByScrollingPage(
  element: HTMLElement,
  options: Required<CaptureElementOptions>,
): Promise<CaptureResult> {
  const initial = readBorderVisualRect(element);
  if (initial.width <= 0 || initial.height <= 0) {
    throw new Error('目标元素当前不可见，无法截图。');
  }
  if (
    initial.left < -VIEWPORT_TOLERANCE_CSS_PX ||
    initial.right > window.innerWidth + VIEWPORT_TOLERANCE_CSS_PX
  ) {
    throw new Error('目标元素横向超出当前视口，无法通过滚动页面完整截图。');
  }

  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  const dpr = window.devicePixelRatio;
  const scrollbarStyle = applyHideScrollbars();
  const frames: CaptureFrame[] = [];
  let outputWidth = devicePixels(Math.max(1, Math.round(initial.width * dpr)));
  let outputHeight = devicePixels(0);
  let capturedVisualHeight = 0;
  let stableRect: CssRect | null = null;
  let pagePosition = Math.max(
    0,
    Math.min(
      Number(readPageHeight()) - window.innerHeight,
      Number(initial.top) + originalScrollY,
    ),
  );
  let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;

  try {
    while (frames.length < MAX_CAPTURE_SEGMENTS) {
      throwIfAborted(options.signal);
      window.scrollTo(originalScrollX, pagePosition);
      await waitForRendering(options.settleDelayMs);
      throwIfAborted(options.signal);

      const actualScrollY = window.scrollY;
      const measuredRect = readBorderVisualRect(element);
      // Establish the geometry baseline only after the first requested page
      // position has settled. Responsive pages can legitimately reflow once
      // when the picker UI disappears or the target first enters the viewport.
      // Once the first frame establishes the capture size, later DOM reads
      // update only its position. A capture-session invariant must never be
      // converted into a user-facing "element size changed" failure.
      if (!stableRect) stableRect = measuredRect;
      const current = positionLockedRect(measuredRect, stableRect);
      if (
        current.left < -VIEWPORT_TOLERANCE_CSS_PX ||
        current.right > window.innerWidth + VIEWPORT_TOLERANCE_CSS_PX
      ) {
        throw new Error('目标元素横向超出当前视口，无法通过滚动页面完整截图。');
      }

      intersectWithViewport(current);
      const visibleEnd = Math.min(
        Number(stableRect.height),
        Math.max(0, window.innerHeight - Number(current.top)),
      );
      const segmentStart = capturedVisualHeight;
      const segmentEnd = Math.max(segmentStart, visibleEnd);
      if (segmentEnd <= segmentStart + VIEWPORT_TOLERANCE_CSS_PX) {
        const maxScrollY = Math.max(0, readPageHeight() - window.innerHeight);
        if (actualScrollY >= maxScrollY - VIEWPORT_TOLERANCE_CSS_PX) {
          throw new Error('页面滚动未产生新的目标内容，无法完整截图。');
        }
        pagePosition = Math.min(maxScrollY, actualScrollY + window.innerHeight);
        continue;
      }
      // Segment geometry is in CSS pixels; cssRectToDeviceRect converts it to
      // physical pixels before cropping the captureVisibleTab bitmap.
      const segmentRect: CssRect = {
        bottom: cssPixels(Number(current.top) + segmentEnd),
        height: cssPixels(segmentEnd - segmentStart),
        left: current.left,
        right: current.right,
        top: cssPixels(Number(current.top) + segmentStart),
        width: current.width,
      };
      const timeUntilAllowed =
        lastCaptureStartedAt + options.minCaptureIntervalMs - performance.now();
      if (timeUntilAllowed > 0) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, timeUntilAllowed),
        );
      }
      lastCaptureStartedAt = performance.now();
      const dataUrl = await requestVisibleTabCapture();
      const clipRect = cssRectToDeviceRect(segmentRect, dpr);
      outputWidth = clipRect.width;
      frames.push({ clipRect, dataUrl });
      capturedVisualHeight = segmentEnd;
      outputHeight = devicePixels(Math.round(capturedVisualHeight * dpr));
      options.onProgress?.(frames.length, frames.length);

      if (capturedVisualHeight >= Number(stableRect.height) - VIEWPORT_TOLERANCE_CSS_PX) {
        break;
      }
      const pageHeight = readPageHeight();
      const maxScrollY = Math.max(0, pageHeight - window.innerHeight);
      const nextPosition = Math.min(maxScrollY, actualScrollY + window.innerHeight);
      if (nextPosition <= actualScrollY + VIEWPORT_TOLERANCE_CSS_PX) {
        throw new Error('目标元素超出页面可滚动范围，无法完整截图。');
      }
      pagePosition = nextPosition;
    }

    if (frames.length >= MAX_CAPTURE_SEGMENTS) {
      throw new Error('页面滚动高度持续增长，已达到安全截图上限。');
    }
    if (frames.length === 0) {
      throw new Error('未能获取任何有效的页面滚动截图帧。');
    }
    return { frames, outputHeight, outputWidth };
  } finally {
    window.scrollTo(originalScrollX, originalScrollY);
    restoreHiddenScrollbars(scrollbarStyle);
  }
}

function intersectCssRects(...rects: CssRect[]): CssRect | null {
  const left = Math.max(...rects.map((rect) => Number(rect.left)));
  const top = Math.max(...rects.map((rect) => Number(rect.top)));
  const right = Math.min(...rects.map((rect) => Number(rect.right)));
  const bottom = Math.min(...rects.map((rect) => Number(rect.bottom)));
  if (right <= left || bottom <= top) return null;
  return {
    bottom: cssPixels(bottom),
    height: cssPixels(bottom - top),
    left: cssPixels(left),
    right: cssPixels(right),
    top: cssPixels(top),
    width: cssPixels(right - left),
  };
}

/**
 * Scroll a selected element's nearest overflow container while cropping only
 * the selected element's CSS-pixel rectangle from each physical screenshot.
 */
async function captureElementByScrollingParent(
  element: HTMLElement,
  parent: HTMLElement,
  options: Required<CaptureElementOptions>,
): Promise<CaptureResult> {
  if (parent === document.documentElement || parent === document.body) {
    return await captureElementByScrollingPage(element, options);
  }
  if (!parent.isConnected || !isSelfScrollableElement(parent)) {
    throw new Error('目标元素的可滚动父元素已不可用，请重新选择。');
  }

  const initial = readBorderVisualRect(element);
  if (initial.width <= 0 || initial.height <= 0) {
    throw new Error('目标元素当前不可见，无法截图。');
  }
  if (
    initial.left < -VIEWPORT_TOLERANCE_CSS_PX ||
    initial.right > window.innerWidth + VIEWPORT_TOLERANCE_CSS_PX
  ) {
    throw new Error('目标元素横向超出当前视口，无法完整截图。');
  }

  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  const originalParentScrollTop = parent.scrollTop;
  const dpr = window.devicePixelRatio;
  const scrollbarStyle = applyHideScrollbars();
  const viewportRect: CssRect = {
    bottom: cssPixels(window.innerHeight),
    height: cssPixels(window.innerHeight),
    left: cssPixels(0),
    right: cssPixels(window.innerWidth),
    top: cssPixels(0),
    width: cssPixels(window.innerWidth),
  };
  const frames: CaptureFrame[] = [];
  let outputWidth = devicePixels(Math.max(1, Math.round(initial.width * dpr)));
  let outputHeight = devicePixels(0);
  let capturedVisualHeight = 0;
  let stableRect: CssRect | null = null;
  let knownScrollHeight = cssPixels(parent.scrollHeight);
  let positions = computeScrollPositions(
    knownScrollHeight,
    cssPixels(parent.clientHeight),
  );
  let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;

  try {
    let positionIndex = 0;
    while (positionIndex < positions.length && frames.length < MAX_CAPTURE_SEGMENTS) {
      throwIfAborted(options.signal);
      parent.scrollTop = Number(positions[positionIndex]);
      await waitForRendering(options.settleDelayMs);
      throwIfAborted(options.signal);

      const measuredHeight = cssPixels(parent.scrollHeight);
      if (measuredHeight > knownScrollHeight) {
        knownScrollHeight = measuredHeight;
        positions = computeScrollPositions(
          knownScrollHeight,
          cssPixels(parent.clientHeight),
        );
      }
      const measuredRect = readBorderVisualRect(element);
      const current = stableRect
        ? positionLockedRect(measuredRect, stableRect)
        : measuredRect;
      if (
        current.left < -VIEWPORT_TOLERANCE_CSS_PX ||
        current.right > window.innerWidth + VIEWPORT_TOLERANCE_CSS_PX
      ) {
        throw new Error('目标元素横向超出当前视口，无法完整截图。');
      }

      const parentRect = readBorderVisualRect(parent);
      const visibleRect = intersectCssRects(current, parentRect, viewportRect);
      if (visibleRect) {
        // A child can reflow while its scroll parent moves it into view (for
        // example, when lazy content is first laid out). Use the first visible
        // frame as the deterministic CSS-pixel size for this capture session.
        // Later reads update position only; they never invalidate the session.
        if (!stableRect) stableRect = measuredRect;
        const visibleStart = Math.max(0, Number(visibleRect.top) - Number(current.top));
        const visibleEnd = Math.min(
          Number(stableRect.height),
          Math.max(0, Number(visibleRect.bottom) - Number(current.top)),
        );
        const segmentStart = capturedVisualHeight;
        const segmentEnd = Math.max(segmentStart, visibleEnd);
        if (
          segmentEnd > segmentStart + VIEWPORT_TOLERANCE_CSS_PX &&
          visibleStart <= segmentStart + VIEWPORT_TOLERANCE_CSS_PX
        ) {
          // Segment geometry is CSS pixels; conversion to physical pixels is
          // performed only when cropping the captureVisibleTab bitmap.
          const segmentRect: CssRect = {
            bottom: cssPixels(Number(current.top) + segmentEnd),
            height: cssPixels(segmentEnd - segmentStart),
            left: current.left,
            right: current.right,
            top: cssPixels(Number(current.top) + segmentStart),
            width: current.width,
          };
          const timeUntilAllowed =
            lastCaptureStartedAt + options.minCaptureIntervalMs - performance.now();
          if (timeUntilAllowed > 0) {
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, timeUntilAllowed),
            );
          }
          lastCaptureStartedAt = performance.now();
          const dataUrl = await requestVisibleTabCapture();
          const clipRect = cssRectToDeviceRect(segmentRect, dpr);
          outputWidth = clipRect.width;
          frames.push({ clipRect, dataUrl });
          capturedVisualHeight = segmentEnd;
          outputHeight = devicePixels(Math.round(capturedVisualHeight * dpr));
          options.onProgress?.(frames.length, positions.length);
        }
      }

      if (
        stableRect &&
        capturedVisualHeight >= Number(stableRect.height) - VIEWPORT_TOLERANCE_CSS_PX
      ) {
        break;
      }
      positionIndex += 1;
    }

    if (frames.length >= MAX_CAPTURE_SEGMENTS) {
      throw new Error('滚动高度持续增长，已达到安全截图上限。');
    }
    if (
      !stableRect ||
      capturedVisualHeight < Number(stableRect.height) - VIEWPORT_TOLERANCE_CSS_PX
    ) {
      throw new Error('可滚动父元素未能显示目标的完整内容。');
    }
    return { frames, outputHeight, outputWidth };
  } finally {
    parent.scrollTop = originalParentScrollTop;
    window.scrollTo(originalScrollX, originalScrollY);
    restoreHiddenScrollbars(scrollbarStyle);
  }
}

function applyHideViewportFixedElements(
  excludedElements: ReadonlySet<HTMLElement> = new Set(),
): HiddenElementState[] {
  const states: HiddenElementState[] = [];
  const viewport = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  try {
    for (const candidate of document.querySelectorAll<HTMLElement>('*')) {
      if (
        candidate.id === 'element-shot-picker-host' ||
        candidate.id === 'element-shot-status-host' ||
        candidate.id === 'element-shot-workflow-host'
      ) {
        continue;
      }
      if (excludedElements.has(candidate)) continue;
      const style = getComputedStyle(candidate);
      if (style.position !== 'fixed' && style.position !== 'sticky') {
        continue;
      }
      if (!intersects(viewport, candidate.getBoundingClientRect())) {
        continue;
      }
      states.push({
        element: candidate,
        hadStyleAttribute: candidate.hasAttribute('style'),
        property: 'visibility',
        priority: candidate.style.getPropertyPriority('visibility'),
        value: candidate.style.getPropertyValue('visibility'),
      });
      candidate.style.setProperty('visibility', 'hidden', 'important');
    }
  } catch (error) {
    restoreHiddenElements(states);
    throw error;
  }
  return states;
}

function readPageHeight(): number {
  return Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0,
    document.documentElement.clientHeight,
  );
}

export async function capturePage(
  options: CaptureElementOptions = {},
): Promise<CaptureResult> {
  const requiredOptions: Required<CaptureElementOptions> = {
    hideFixedElements: options.hideFixedElements ?? true,
    hiddenElements: options.hiddenElements ?? [],
    minCaptureIntervalMs: options.minCaptureIntervalMs ?? MIN_CAPTURE_INTERVAL_MS,
    onProgress: options.onProgress ?? (() => undefined),
    restoreHiddenElements: true,
    // Scroll position is a hard invariant; it is never user-configurable.
    restoreScrollPosition: true,
    scrollParent: options.scrollParent ?? null,
    signal: options.signal ?? new AbortController().signal,
    settleDelayMs: options.settleDelayMs ?? CAPTURE_SETTLE_DELAY_MS,
  };
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  let fixedHiddenElements: HiddenElementState[] = [];
  let explicitlyHiddenElements: HiddenElementState[] = [];
  const dpr = window.devicePixelRatio;
  // captureVisibleTab returns the browser-surface bitmap. Its physical scale
  // can differ from window.devicePixelRatio, so the first PNG establishes the
  // scale used for every page clip and stitched output dimension.
  let captureScaleY = dpr;
  let outputWidth = devicePixels(Math.max(1, Math.round(window.innerWidth * dpr)));
  const viewportHeight = Math.max(1, window.innerHeight);
  let captureViewportHeight = cssPixels(viewportHeight);
  let pageHeight = readPageHeight();
  let positions = computeScrollPositions(cssPixels(pageHeight), cssPixels(viewportHeight));
  const frames: CaptureFrame[] = [];
  let cumulativeHeight = devicePixels(0);
  let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;
  const scrollbarStyle = applyHideScrollbars();

  try {
    explicitlyHiddenElements = applyHideElements(requiredOptions.hiddenElements);
    fixedHiddenElements = requiredOptions.hideFixedElements
      ? applyHideViewportFixedElements(new Set(requiredOptions.hiddenElements))
      : [];
    let positionIndex = 0;
    while (positionIndex < positions.length) {
      if (frames.length >= MAX_CAPTURE_SEGMENTS) {
        throw new Error('页面高度持续增长，已达到安全截图上限。');
      }
      throwIfAborted(requiredOptions.signal);
      const requestedPosition = positions[positionIndex];
      window.scrollTo(originalScrollX, Number(requestedPosition));
      await waitForRendering(requiredOptions.settleDelayMs);
      throwIfAborted(requiredOptions.signal);
      pageHeight = Math.max(pageHeight, readPageHeight());
      positions = computeScrollPositions(cssPixels(pageHeight), captureViewportHeight);
      const actualPosition = Math.max(0, window.scrollY);
      // Scroll positions and page heights are CSS pixels; output and clipRect
      // values below are physical pixels for captureVisibleTab's bitmap.
      positionIndex += 1;

      const timeUntilAllowed =
        lastCaptureStartedAt + requiredOptions.minCaptureIntervalMs - performance.now();
      if (timeUntilAllowed > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, timeUntilAllowed));
      }
      lastCaptureStartedAt = performance.now();
      const dataUrl = await requestVisibleTabCapture();
      const frameDimensions = readPngDimensions(dataUrl);
      if (frames.length === 0) {
        outputWidth = devicePixels(frameDimensions.width);
        const measuredScale = frameDimensions.width / Math.max(1, window.innerWidth);
        if (Number.isFinite(measuredScale) && measuredScale > 0) {
          // captureVisibleTab uses the browser-surface scale. The bitmap
          // height may not equal innerHeight * devicePixelRatio, so derive the
          // physical scale from the stable horizontal viewport dimension.
          captureScaleY = measuredScale;
        }
        captureViewportHeight = cssPixels(frameDimensions.height / captureScaleY);
        positions = computeScrollPositions(
          cssPixels(pageHeight),
          captureViewportHeight,
        );
      }

      const nextCumulativeHeight = devicePixels(
        Math.round(
          Math.min(
            pageHeight,
            Number(captureViewportHeight) + actualPosition,
          ) * captureScaleY,
        ),
      );
      const segmentHeight = devicePixels(
        Math.min(
          frameDimensions.height,
          Math.max(0, Number(nextCumulativeHeight) - Number(cumulativeHeight)),
        ),
      );
      if (segmentHeight <= 0) {
        continue;
      }
      frames.push({
        clipRect: {
          height: segmentHeight,
          width: outputWidth,
          x: devicePixels(0),
          // captureVisibleTab returns one viewport bitmap. The first segment
          // starts at its top; a short final segment is taken from the bitmap
          // bottom to remove overlap with the preceding page segment.
          y: devicePixels(Math.min(
            Math.max(0, frameDimensions.height - Number(segmentHeight)),
            actualPosition <= VIEWPORT_TOLERANCE_CSS_PX
              ? 0
              : frameDimensions.height - Number(segmentHeight),
          )),
        },
        dataUrl,
      });
      cumulativeHeight = nextCumulativeHeight;
      requiredOptions.onProgress(frames.length, positions.length);
    }

    if (frames.length === 0) {
      throw new Error('未能获取任何有效的页面截图帧。');
    }
    return { frames, outputHeight: cumulativeHeight, outputWidth };
  } finally {
    window.scrollTo(originalScrollX, originalScrollY);
    restoreHiddenElements(fixedHiddenElements);
    restoreHiddenElements(explicitlyHiddenElements);
    restoreHiddenScrollbars(scrollbarStyle);
  }
}

async function captureScrollableElement(
  element: HTMLElement,
  options: Required<CaptureElementOptions>,
): Promise<CaptureResult> {
  let knownScrollHeight = cssPixels(element.scrollHeight);
  let clientHeight = cssPixels(element.clientHeight);

  // Visit the current bottom a few times before taking the first frame. This
  // lets lazy-loaded content settle and gives the loop a better initial height
  // estimate without assuming the page has a finite waterfall.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(options.signal);
    element.scrollTop = Math.max(0, Number(knownScrollHeight) - Number(clientHeight));
    await waitForRendering(options.settleDelayMs);
    const measuredHeight = cssPixels(element.scrollHeight);
    if (measuredHeight <= knownScrollHeight) {
      break;
    }
    knownScrollHeight = measuredHeight;
  }

  // Bottom probing may trigger a one-time responsive/lazy-load reflow. No
  // screenshot has been taken yet, so establish the stable CSS-pixel geometry
  // only after that probe instead of comparing against the picker-time shape.
  const initial = readInnerVisualGeometry(element);
  assertFullyVisible(initial.rect);
  knownScrollHeight = cssPixels(Math.max(Number(knownScrollHeight), element.scrollHeight));
  clientHeight = cssPixels(element.clientHeight);

  const dpr = window.devicePixelRatio;
  const outputWidth = devicePixels(
    Math.max(1, Math.round(initial.rect.width * dpr)),
  );

  let positions = computeScrollPositions(knownScrollHeight, clientHeight);
  const frames: CaptureFrame[] = [];
  let cumulativeHeight = devicePixels(0);
  let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;
  const scrollbarStyle = applyHideScrollbars();

  try {
    let positionIndex = 0;
    while (positionIndex < positions.length) {
      if (frames.length >= MAX_CAPTURE_SEGMENTS) {
        throw new Error('滚动高度持续增长，已达到安全截图上限。');
      }
      throwIfAborted(options.signal);
      const requestedPosition = positions[positionIndex];
      element.scrollTop = requestedPosition;
      await waitForRendering(options.settleDelayMs);
      throwIfAborted(options.signal);

      const actualPosition = cssPixels(element.scrollTop);
      const measuredHeight = cssPixels(element.scrollHeight);
      if (measuredHeight > knownScrollHeight) {
        knownScrollHeight = measuredHeight;
        positions = computeScrollPositions(knownScrollHeight, clientHeight);
      }
      const measuredGeometry = readInnerVisualGeometry(element);
      const current = positionLockedRect(measuredGeometry.rect, initial.rect);
      assertFullyVisible(current);

      const nextCumulativeHeight = devicePixels(
        Math.round(
          Math.min(
            Number(knownScrollHeight),
            Number(clientHeight) + Number(actualPosition),
          ) *
            initial.scaleY *
            dpr,
        ),
      );
      const segmentHeight = devicePixels(nextCumulativeHeight - cumulativeHeight);
      if (segmentHeight <= 0) {
        positionIndex += 1;
        continue;
      }

      const timeUntilAllowed =
        lastCaptureStartedAt + options.minCaptureIntervalMs - performance.now();
      if (timeUntilAllowed > 0) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, timeUntilAllowed),
        );
      }

      lastCaptureStartedAt = performance.now();
      const dataUrl = await requestVisibleTabCapture();
      frames.push({
        clipRect: computeBottomSliceDeviceRect(
          current,
          dpr,
          segmentHeight,
          outputWidth,
        ),
        dataUrl,
      });
      cumulativeHeight = nextCumulativeHeight;
      options.onProgress?.(frames.length, positions.length);
      positionIndex += 1;
    }

    if (frames.length === 0) {
      throw new Error('未能获取任何有效截图帧。');
    }

    return {
      frames,
      outputHeight: cumulativeHeight,
      outputWidth,
    };
  } finally {
    restoreHiddenScrollbars(scrollbarStyle);
  }
}

export async function captureElement(
  element: HTMLElement,
  options: CaptureElementOptions = {},
): Promise<CaptureResult> {
  const originalScrollTop = element.scrollTop;
  let fixedHiddenElements: HiddenElementState[] = [];
  let explicitlyHiddenElements: HiddenElementState[] = [];
  const requiredOptions: Required<CaptureElementOptions> = {
    hideFixedElements: options.hideFixedElements ?? true,
    hiddenElements: options.hiddenElements ?? [],
    minCaptureIntervalMs:
      options.minCaptureIntervalMs ?? MIN_CAPTURE_INTERVAL_MS,
    onProgress: options.onProgress ?? (() => undefined),
    restoreHiddenElements: true,
    // Scroll position is a hard invariant; it is never user-configurable.
    restoreScrollPosition: true,
    scrollParent: options.scrollParent ?? null,
    signal: options.signal ?? new AbortController().signal,
    settleDelayMs: options.settleDelayMs ?? CAPTURE_SETTLE_DELAY_MS,
  };

  try {
    throwIfAborted(requiredOptions.signal);
    explicitlyHiddenElements = applyHideElements(requiredOptions.hiddenElements);
    fixedHiddenElements = requiredOptions.hideFixedElements
      ? applyHideFixedElements(element, new Set(requiredOptions.hiddenElements))
      : [];

    if (requiredOptions.scrollParent && requiredOptions.scrollParent !== element) {
      return await captureElementByScrollingParent(
        element,
        requiredOptions.scrollParent,
        requiredOptions,
      );
    }

    if (element.scrollHeight <= element.clientHeight) {
      const borderRect = readBorderVisualRect(element);
      const needsPageScroll =
        borderRect.top < -VIEWPORT_TOLERANCE_CSS_PX ||
        borderRect.bottom > window.innerHeight + VIEWPORT_TOLERANCE_CSS_PX ||
        borderRect.height > window.innerHeight + VIEWPORT_TOLERANCE_CSS_PX;
      return needsPageScroll
        ? await captureElementByScrollingPage(element, requiredOptions)
        : await captureStaticElement(element, requiredOptions);
    }

    return isSelfScrollableElement(element)
      ? await captureScrollableElement(element, requiredOptions)
      : await captureElementByScrollingPage(element, requiredOptions);
  } finally {
    element.scrollTop = originalScrollTop;
    restoreHiddenElements(fixedHiddenElements);
    restoreHiddenElements(explicitlyHiddenElements);
  }
}

function isPageCaptureTarget(element: HTMLElement): boolean {
  return element === document.documentElement || element === document.body;
}

/**
 * Capture the positions visited by the user and remove overlap using the
 * actual CSS-pixel scroll distance converted to physical screenshot pixels.
 */
export async function captureManualScrollElement(
  element: HTMLElement,
  options: CaptureElementOptions = {},
): Promise<CaptureResult> {
  const requiredOptions: Required<CaptureElementOptions> = {
    hideFixedElements: options.hideFixedElements ?? true,
    hiddenElements: options.hiddenElements ?? [],
    minCaptureIntervalMs:
      options.minCaptureIntervalMs ?? MIN_CAPTURE_INTERVAL_MS,
    onProgress: options.onProgress ?? (() => undefined),
    restoreHiddenElements: true,
    restoreScrollPosition: true,
    scrollParent: options.scrollParent ?? null,
    signal: options.signal ?? new AbortController().signal,
    settleDelayMs: options.settleDelayMs ?? CAPTURE_SETTLE_DELAY_MS,
  };
  const pageTarget = isPageCaptureTarget(element);
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  const originalScrollTop = element.scrollTop;
  const dpr = window.devicePixelRatio;
  // Manual mode must never change the page position when capture starts. The
  // user controls every scroll, and a partially visible element is captured
  // through its current viewport intersection instead of being moved.
  const initialGeometry: InnerVisualGeometry = pageTarget
    ? {
        rect: {
          bottom: cssPixels(window.innerHeight),
          height: cssPixels(window.innerHeight),
          left: cssPixels(0),
          right: cssPixels(window.innerWidth),
          top: cssPixels(0),
          width: cssPixels(window.innerWidth),
        },
        scaleX: 1,
        scaleY: 1,
      }
    : readInnerVisualGeometry(element);
  // Manual mode captures the selected region that is actually visible. A
  // partially clipped scroll container is still a valid capture aperture; the
  // user should not have to reposition the page just to start the first frame.
  const initialVisibleRect = pageTarget
    ? initialGeometry.rect
    : intersectWithViewport(initialGeometry.rect);

  const scrollEventTarget: EventTarget = pageTarget ? window : element;
  const readPosition = (): CssPixels =>
    cssPixels(Math.max(0, pageTarget ? window.scrollY : element.scrollTop));
  const readGeometry = (): InnerVisualGeometry =>
    pageTarget
      ? initialGeometry
      : readInnerVisualGeometry(element);
  const manualFrames = new Map<number, ManualCapturedFrame>();
  let fixedHiddenElements: HiddenElementState[] = [];
  let explicitlyHiddenElements: HiddenElementState[] = [];
  let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;
  let scrollEndTimer: number | undefined;
  let captureQueue = Promise.resolve();
  let terminalError: unknown;
  let finishRequested = false;
  let suppressScrollEvents = false;
  const scrollbarStyle = applyHideScrollbars();
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const requestFinish = (): void => {
    if (finishRequested) return;
    finishRequested = true;
    resolveFinished();
  };

  const captureCurrentPosition = async (): Promise<void> => {
    throwIfAborted(requiredOptions.signal);
    await waitForRendering(requiredOptions.settleDelayMs);
    throwIfAborted(requiredOptions.signal);
    const position = readPosition();
    if (manualFrames.has(Number(position))) return;
    if (manualFrames.size >= MAX_CAPTURE_SEGMENTS) {
      throw new Error('手动滚动截图已达到安全截图上限。');
    }

    const geometry = readGeometry();
    let visibleRect = geometry.rect;
    if (!pageTarget) {
      const positionedRect = positionLockedRect(geometry.rect, initialGeometry.rect);
      const currentVisibleRect = intersectWithViewport(positionedRect);
      visibleRect = positionLockedRect(currentVisibleRect, initialVisibleRect);
    }
    const timeUntilAllowed =
      lastCaptureStartedAt + requiredOptions.minCaptureIntervalMs - performance.now();
    if (timeUntilAllowed > 0) {
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, timeUntilAllowed),
      );
    }
    throwIfAborted(requiredOptions.signal);
    lastCaptureStartedAt = performance.now();
    const dataUrl = await requestVisibleTabCapture();
    if (readPosition() !== position) return;

    const dimensions = readPngDimensions(dataUrl);
    const clipRect = pageTarget
      ? {
          height: devicePixels(dimensions.height),
          width: devicePixels(dimensions.width),
          x: devicePixels(0),
          y: devicePixels(0),
        }
      // visibleRect is measured in CSS pixels; element-region captures use
      // devicePixelRatio to crop the physical captureVisibleTab bitmap.
      : cssRectToDeviceRect(visibleRect, dpr);
    manualFrames.set(Number(position), {
      clipRect,
      dataUrl,
      position,
      viewportHeight: cssPixels(Number(visibleRect.height)),
    });
    requiredOptions.onProgress(manualFrames.size, manualFrames.size);
  };

  const enqueueCapture = (): void => {
    captureQueue = captureQueue
      .then(captureCurrentPosition)
      .catch((error: unknown) => {
        terminalError = error;
        requestFinish();
      });
  };

  const handleScroll = (): void => {
    if (suppressScrollEvents || finishRequested) return;
    if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
    const atBottom = pageTarget
      ? window.scrollY + window.innerHeight >= readPageHeight() - VIEWPORT_TOLERANCE_CSS_PX
      : element.scrollTop + element.clientHeight >= element.scrollHeight - VIEWPORT_TOLERANCE_CSS_PX;
    if (atBottom) {
      requestFinish();
      return;
    }
    scrollEndTimer = window.setTimeout(
      enqueueCapture,
      Math.max(120, requiredOptions.settleDelayMs),
    );
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestFinish();
  };
  const handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestFinish();
  };
  const handleAbort = (): void => requestFinish();

  try {
    throwIfAborted(requiredOptions.signal);
    explicitlyHiddenElements = applyHideElements(requiredOptions.hiddenElements);
    fixedHiddenElements = requiredOptions.hideFixedElements
      ? pageTarget
        ? applyHideViewportFixedElements(new Set(requiredOptions.hiddenElements))
        : applyHideFixedElements(element, new Set(requiredOptions.hiddenElements))
      : [];
    scrollEventTarget.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handlePointerDown, true);
    requiredOptions.signal.addEventListener('abort', handleAbort, { once: true });

    await captureCurrentPosition();
    await finished;
    if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
    await captureQueue;
    throwIfAborted(requiredOptions.signal);
    if (terminalError) throw terminalError;
    await captureCurrentPosition();

    const orderedFrames = [...manualFrames.values()].sort(
      (left, right) => Number(left.position) - Number(right.position),
    );
    if (orderedFrames.length === 0) {
      throw new Error('未能获取任何手动滚动截图帧。');
    }
    const outputWidth = orderedFrames[0].clipRect.width;
    const frames: CaptureFrame[] = [];
    let outputHeight = devicePixels(0);
    let previousPosition: CssPixels | null = null;

    for (const frame of orderedFrames) {
      if (frame.clipRect.width !== outputWidth) {
        throw new Error('手动滚动期间目标宽度发生变化。');
      }
      let segmentHeight = frame.clipRect.height;
      if (previousPosition !== null) {
        const scrollDelta = Number(frame.position) - Number(previousPosition);
        const viewportCssHeight = Number(frame.viewportHeight);
        if (scrollDelta > viewportCssHeight + VIEWPORT_TOLERANCE_CSS_PX) {
          throw new Error('两次截图之间滚动超过一屏，无法保证内容完整。');
        }
        const physicalScale = Number(frame.clipRect.height) / viewportCssHeight;
        segmentHeight = devicePixels(
          Math.max(1, Math.min(
            Number(frame.clipRect.height),
            Math.round(scrollDelta * physicalScale),
          )),
        );
      }
      frames.push({
        clipRect: {
          height: segmentHeight,
          width: outputWidth,
          x: frame.clipRect.x,
          y: devicePixels(
            Number(frame.clipRect.y) + Number(frame.clipRect.height) - Number(segmentHeight),
          ),
        },
        dataUrl: frame.dataUrl,
      });
      outputHeight = devicePixels(Number(outputHeight) + Number(segmentHeight));
      previousPosition = frame.position;
    }
    return { frames, outputHeight, outputWidth };
  } finally {
    if (scrollEndTimer !== undefined) window.clearTimeout(scrollEndTimer);
    scrollEventTarget.removeEventListener('scroll', handleScroll);
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('pointerdown', handlePointerDown, true);
    requiredOptions.signal.removeEventListener('abort', handleAbort);
    if (pageTarget) window.scrollTo(originalScrollX, originalScrollY);
    else element.scrollTop = originalScrollTop;
    restoreHiddenElements(fixedHiddenElements);
    restoreHiddenElements(explicitlyHiddenElements);
    restoreHiddenScrollbars(scrollbarStyle);
  }
}

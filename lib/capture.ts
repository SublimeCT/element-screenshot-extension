import {
  CAPTURE_SETTLE_DELAY_MS,
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
  type SiteCaptureTarget,
} from './types';
import { resolveSiteCaptureTarget } from './site-adapters';

interface HiddenElementState {
  element: HTMLElement;
  priority: string;
  value: string;
}

interface InnerVisualGeometry {
  rect: CssRect;
  scaleX: number;
  scaleY: number;
}

interface CaptureElementOptions {
  minCaptureIntervalMs?: number;
  settleDelayMs?: number;
}

const VIEWPORT_TOLERANCE_CSS_PX = 1;
const GEOMETRY_TOLERANCE = 0.002;

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

function intersects(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function restoreHiddenElements(states: HiddenElementState[]): void {
  for (const { element, priority, value } of states) {
    if (value) {
      element.style.setProperty('visibility', value, priority);
    } else {
      element.style.removeProperty('visibility');
    }
  }
}

export function applyHideFixedElements(target: HTMLElement): HiddenElementState[] {
  const targetRect = target.getBoundingClientRect();
  const states: HiddenElementState[] = [];

  for (const candidate of document.querySelectorAll<HTMLElement>('*')) {
    if (
      candidate === target ||
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
      priority: candidate.style.getPropertyPriority('visibility'),
      value: candidate.style.getPropertyValue('visibility'),
    });
    candidate.style.setProperty('visibility', 'hidden', 'important');
  }

  return states;
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

function cssRectToDeviceRect(rect: CssRect, dpr: number): DeviceRect {
  // DOMRect is measured in CSS pixels; captureVisibleTab returns physical pixels.
  const x = Math.round(rect.left * dpr);
  const y = Math.round(rect.top * dpr);
  return {
    height: devicePixels(Math.max(1, Math.round(rect.height * dpr))),
    width: devicePixels(Math.max(1, Math.round(rect.width * dpr))),
    x: devicePixels(x),
    y: devicePixels(y),
  };
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

async function captureStaticElement(element: HTMLElement): Promise<CaptureResult> {
  await waitForRendering(CAPTURE_SETTLE_DELAY_MS);
  const visibleRect = intersectWithViewport(readBorderVisualRect(element));
  const dpr = window.devicePixelRatio;
  const clipRect = cssRectToDeviceRect(visibleRect, dpr);
  const dataUrl = await requestVisibleTabCapture();

  return {
    frames: [{ clipRect, dataUrl }],
    outputHeight: clipRect.height,
    outputWidth: clipRect.width,
  };
}

function assertStableGeometry(
  initial: InnerVisualGeometry,
  current: InnerVisualGeometry,
): void {
  if (
    Math.abs(initial.scaleX - current.scaleX) > GEOMETRY_TOLERANCE ||
    Math.abs(initial.scaleY - current.scaleY) > GEOMETRY_TOLERANCE
  ) {
    throw new Error('截图过程中目标元素尺寸发生变化，请等待页面稳定后重试。');
  }
}

async function captureScrollableElement(
  element: HTMLElement,
  options: Required<CaptureElementOptions>,
): Promise<CaptureResult> {
  const initial = readInnerVisualGeometry(element);
  assertFullyVisible(initial.rect);

  const dpr = window.devicePixelRatio;
  const outputWidth = devicePixels(
    Math.max(1, Math.round(initial.rect.width * dpr)),
  );
  const positions = computeScrollPositions(
    cssPixels(element.scrollHeight),
    cssPixels(element.clientHeight),
  );
  const frames: CaptureFrame[] = [];
  let cumulativeHeight = devicePixels(0);
  let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;

  for (const requestedPosition of positions) {
    element.scrollTop = requestedPosition;
    await waitForRendering(options.settleDelayMs);

    const actualPosition = cssPixels(element.scrollTop);
    const current = readInnerVisualGeometry(element);
    assertFullyVisible(current.rect);
    assertStableGeometry(initial, current);

    const nextCumulativeHeight = devicePixels(
      Math.round((element.clientHeight + actualPosition) * initial.scaleY * dpr),
    );
    const segmentHeight = devicePixels(nextCumulativeHeight - cumulativeHeight);
    if (segmentHeight <= 0) {
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
        current.rect,
        dpr,
        segmentHeight,
        outputWidth,
      ),
      dataUrl,
    });
    cumulativeHeight = nextCumulativeHeight;
  }

  if (frames.length === 0) {
    throw new Error('未能获取任何有效截图帧。');
  }

  return {
    frames,
    outputHeight: cumulativeHeight,
    outputWidth,
  };
}

async function captureSiteSpecificTarget(
  target: SiteCaptureTarget,
  options: Required<CaptureElementOptions>,
): Promise<CaptureResult> {
  const initial = readInnerVisualGeometry(target.viewport);
  assertFullyVisible(initial.rect);
  const session = target.createCaptureSession();

  try {
    const dpr = window.devicePixelRatio;
    // DOM geometry is in CSS pixels; screenshot crop and output dimensions are
    // converted to physical pixels using the viewport's rendered scale and DPR.
    const outputWidth = devicePixels(
      Math.max(1, Math.round(initial.rect.width * dpr)),
    );
    const positions = computeScrollPositions(
      session.contentHeight,
      session.viewportHeight,
    );
    const frames: CaptureFrame[] = [];
    let cumulativeHeight = devicePixels(0);
    let lastCaptureStartedAt = Number.NEGATIVE_INFINITY;

    for (const requestedPosition of positions) {
      session.applyPosition(requestedPosition);
      await waitForRendering(options.settleDelayMs);
      session.assertPosition(requestedPosition);

      const current = readInnerVisualGeometry(target.viewport);
      assertFullyVisible(current.rect);
      assertStableGeometry(initial, current);

      const nextCumulativeHeight = devicePixels(
        Math.round(
          Math.min(
            Number(session.contentHeight),
            Number(session.viewportHeight) + Number(requestedPosition),
          ) *
            initial.scaleY *
            dpr,
        ),
      );
      const segmentHeight = devicePixels(nextCumulativeHeight - cumulativeHeight);
      if (segmentHeight <= 0) {
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
          current.rect,
          dpr,
          segmentHeight,
          outputWidth,
        ),
        dataUrl,
      });
      cumulativeHeight = nextCumulativeHeight;
    }

    if (frames.length === 0) {
      throw new Error('未能获取任何有效的站点适配截图帧。');
    }

    return {
      frames,
      outputHeight: cumulativeHeight,
      outputWidth,
    };
  } finally {
    session.restore();
  }
}

export async function captureElement(
  element: HTMLElement,
  options: CaptureElementOptions = {},
): Promise<CaptureResult> {
  const originalScrollTop = element.scrollTop;
  let hiddenElements: HiddenElementState[] = [];
  const requiredOptions: Required<CaptureElementOptions> = {
    minCaptureIntervalMs:
      options.minCaptureIntervalMs ?? MIN_CAPTURE_INTERVAL_MS,
    settleDelayMs: options.settleDelayMs ?? CAPTURE_SETTLE_DELAY_MS,
  };

  try {
    hiddenElements = applyHideFixedElements(element);

    const siteTarget = resolveSiteCaptureTarget(element);
    if (siteTarget) {
      return await captureSiteSpecificTarget(siteTarget, requiredOptions);
    }

    if (element.scrollHeight <= element.clientHeight) {
      return await captureStaticElement(element);
    }

    return await captureScrollableElement(element, requiredOptions);
  } finally {
    element.scrollTop = originalScrollTop;
    restoreHiddenElements(hiddenElements);
  }
}

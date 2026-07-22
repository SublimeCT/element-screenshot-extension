import {
  cssPixels,
  type CssPixels,
  type SiteCaptureAdapter,
  type SiteCaptureSession,
  type SiteCaptureTarget,
} from '../types';

const MODAO_PROTO_BASE_URL = 'https://modao.cc/proto';
const MODAO_PROTO_ORIGIN = new URL(MODAO_PROTO_BASE_URL).origin;
const MODAO_PROTO_PATH = new URL(MODAO_PROTO_BASE_URL).pathname;
const CANVAS_SELECTOR = '.pcanvas[data-cid]';
const SCREEN_CONTENT_SELECTOR = '.screen-content';
const CONTENT_LAYER_SELECTOR = '.widgets';
const SCROLLBAR_SELECTOR = '.iScrollVerticalScrollbar';
const POSITION_TOLERANCE_CSS_PX = 1;

interface InlinePropertyState {
  priority: string;
  property: 'left' | 'top';
  value: string;
}

interface VisibilityState {
  element: HTMLElement;
  priority: string;
  value: string;
}

interface ModaoTarget {
  canvas: HTMLElement;
  contentLayer: HTMLElement;
  screenContent: HTMLElement;
}

function isModaoProtoPage(): boolean {
  return (
    location.origin === MODAO_PROTO_ORIGIN &&
    (location.pathname === MODAO_PROTO_PATH ||
      location.pathname.startsWith(`${MODAO_PROTO_PATH}/`))
  );
}

function readContentHeight(contentLayer: HTMLElement): number {
  return Math.max(contentLayer.offsetHeight, contentLayer.scrollHeight);
}

function findContentLayer(screenContent: HTMLElement): HTMLElement | null {
  for (const child of screenContent.children) {
    if (
      child instanceof HTMLElement &&
      child.matches(CONTENT_LAYER_SELECTOR)
    ) {
      return child;
    }
  }

  return null;
}

function resolveTarget(element: HTMLElement): ModaoTarget | null {
  if (!isModaoProtoPage()) {
    return null;
  }

  const screenContent = element.matches(SCREEN_CONTENT_SELECTOR)
    ? element
    : element.closest<HTMLElement>(SCREEN_CONTENT_SELECTOR);
  const canvas = screenContent?.closest<HTMLElement>(CANVAS_SELECTOR);
  const contentLayer = screenContent ? findContentLayer(screenContent) : null;
  if (!screenContent || !canvas || !contentLayer) {
    return null;
  }

  const screenContentStyle = getComputedStyle(screenContent);
  const contentLayerStyle = getComputedStyle(contentLayer);
  const isClipped =
    screenContentStyle.overflowY === 'hidden' ||
    screenContentStyle.overflowY === 'clip';
  if (
    !isClipped ||
    (contentLayerStyle.position !== 'relative' &&
      contentLayerStyle.position !== 'absolute') ||
    contentLayerStyle.transform !== 'none' ||
    screenContent.clientWidth <= 0 ||
    screenContent.clientHeight <= 0 ||
    readContentHeight(contentLayer) <= screenContent.clientHeight + 1
  ) {
    return null;
  }

  return { canvas, contentLayer, screenContent };
}

function readInlinePropertyState(
  element: HTMLElement,
  property: InlinePropertyState['property'],
): InlinePropertyState {
  return {
    priority: element.style.getPropertyPriority(property),
    property,
    value: element.style.getPropertyValue(property),
  };
}

function restoreInlineProperty(
  element: HTMLElement,
  state: InlinePropertyState,
): void {
  if (state.value) {
    element.style.setProperty(state.property, state.value, state.priority);
  } else {
    element.style.removeProperty(state.property);
  }
}

function applyHideScrollbars(screenContent: HTMLElement): VisibilityState[] {
  const states: VisibilityState[] = [];
  for (const element of screenContent.querySelectorAll<HTMLElement>(
    SCROLLBAR_SELECTOR,
  )) {
    states.push({
      element,
      priority: element.style.getPropertyPriority('visibility'),
      value: element.style.getPropertyValue('visibility'),
    });
    element.style.setProperty('visibility', 'hidden', 'important');
  }
  return states;
}

function restoreVisibility(states: VisibilityState[]): void {
  for (const { element, priority, value } of states) {
    if (value) {
      element.style.setProperty('visibility', value, priority);
    } else {
      element.style.removeProperty('visibility');
    }
  }
}

function createCaptureSession(target: ModaoTarget): SiteCaptureSession {
  const positionState = {
    element: target.contentLayer,
    left: readInlinePropertyState(target.contentLayer, 'left'),
    top: readInlinePropertyState(target.contentLayer, 'top'),
  };
  const contentHeight = cssPixels(readContentHeight(target.contentLayer));
  const viewportHeight = cssPixels(target.screenContent.clientHeight);
  const computedLeft = Number.parseFloat(
    getComputedStyle(target.contentLayer).left,
  );
  const frozenLeft = Number.isFinite(computedLeft) ? computedLeft : null;
  let scrollbarStates: VisibilityState[] = [];
  let restored = false;

  const restore = (): void => {
    if (restored) {
      return;
    }
    restored = true;
    restoreInlineProperty(positionState.element, positionState.top);
    restoreInlineProperty(positionState.element, positionState.left);
    restoreVisibility(scrollbarStates);
  };

  try {
    scrollbarStates = applyHideScrollbars(target.screenContent);
    if (frozenLeft !== null) {
      target.contentLayer.style.setProperty(
        'left',
        `${frozenLeft}px`,
        'important',
      );
    }
  } catch (error) {
    restore();
    throw error;
  }

  return {
    contentHeight,
    viewportHeight,
    applyPosition(position: CssPixels): void {
      target.contentLayer.style.setProperty(
        'top',
        `${-Number(position)}px`,
        'important',
      );
    },
    assertPosition(position: CssPixels): void {
      if (
        !target.canvas.isConnected ||
        !target.screenContent.isConnected ||
        !target.contentLayer.isConnected ||
        target.contentLayer.parentElement !== target.screenContent
      ) {
        throw new Error('墨刀在截图过程中重新渲染了目标内容，请等待页面稳定后重试。');
      }

      const style = getComputedStyle(target.contentLayer);
      const actualTop = Number.parseFloat(style.top);
      const actualLeft = Number.parseFloat(style.left);
      if (
        !Number.isFinite(actualTop) ||
        Math.abs(actualTop + position) > POSITION_TOLERANCE_CSS_PX ||
        (frozenLeft !== null &&
          (!Number.isFinite(actualLeft) ||
            Math.abs(actualLeft - frozenLeft) > POSITION_TOLERANCE_CSS_PX)) ||
        readContentHeight(target.contentLayer) !== contentHeight ||
        target.screenContent.clientHeight !== viewportHeight
      ) {
        throw new Error('墨刀重置了目标内容的滚动位置，无法保证截图内容完整。');
      }
    },
    restore,
  };
}

export const modaoSiteAdapter: SiteCaptureAdapter = {
  name: 'modao-proto',
  resolve(element: HTMLElement): SiteCaptureTarget | null {
    const target = resolveTarget(element);
    return target
      ? {
          viewport: target.screenContent,
          createCaptureSession: () => createCaptureSession(target),
        }
      : null;
  },
};

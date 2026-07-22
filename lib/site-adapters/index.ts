import type { SiteCaptureAdapter, SiteCaptureTarget } from '../types';
import { modaoSiteAdapter } from './modao';

// Register site-specific strategies here. Each adapter must reject unrelated
// origins and DOM shapes so the generic capture path remains the default.
const SITE_CAPTURE_ADAPTERS: readonly SiteCaptureAdapter[] = [modaoSiteAdapter];

export function resolveSiteCaptureTarget(
  element: HTMLElement,
): SiteCaptureTarget | null {
  for (const adapter of SITE_CAPTURE_ADAPTERS) {
    const target = adapter.resolve(element);
    if (target) {
      return target;
    }
  }

  return null;
}

export function resolveSiteCaptureViewport(
  element: HTMLElement,
): HTMLElement | null {
  return resolveSiteCaptureTarget(element)?.viewport ?? null;
}

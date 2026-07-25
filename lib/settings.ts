import { DEFAULT_CAPTURE_INTERVAL_MS } from './constants';
import { browserLocale } from './i18n';
import type { CaptureSettings, LocaleChoice, SupportedLocale } from './types';

const DEFAULT_SETTLE_DELAY_MS = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Normalize untrusted runtime-message data before any capture work starts. */
export function normalizeCaptureSettings(value: unknown): CaptureSettings {
  const record = isRecord(value) ? value : undefined;
  const intervalMs = record?.intervalMs;
  const settleDelayMs = record?.settleDelayMs;
  const language = record?.language;
  const supportedLocales: readonly SupportedLocale[] = [
    'ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW',
  ];
  // Persist a concrete locale. The UI may have historically stored `browser`,
  // but a settings select must always show the language actually in use.
  const normalizedLanguage: LocaleChoice = language === 'browser'
    ? browserLocale()
    : typeof language === 'string' && supportedLocales.includes(language as SupportedLocale)
      ? language as SupportedLocale
      : browserLocale();

  return {
    intervalMs:
      typeof intervalMs === 'number' && Number.isFinite(intervalMs)
        ? Math.max(520, Math.min(3000, intervalMs))
        : DEFAULT_CAPTURE_INTERVAL_MS,
    language: normalizedLanguage,
    preview: record?.preview === true,
    restoreEditedContent: record?.restoreEditedContent !== false,
    // Hidden-element styling is always temporary and restored after every exit.
    restoreHiddenElements: true,
    // Scroll position is intentionally not configurable.
    restorePage: true,
    settleDelayMs:
      typeof settleDelayMs === 'number' && Number.isFinite(settleDelayMs)
        ? Math.max(0, Math.min(1000, settleDelayMs))
        : DEFAULT_SETTLE_DELAY_MS,
  };
}

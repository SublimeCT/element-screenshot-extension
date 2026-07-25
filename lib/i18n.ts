interface ChromeI18nApi {
  getMessage: (messageName: string, substitutions?: string | string[]) => string;
  getUILanguage?: () => string;
}

interface ChromeWithI18n {
  i18n?: ChromeI18nApi;
}

import type { LocaleChoice, SupportedLocale } from './types';

type LocaleMessages = Record<string, { message?: string }>;

let loadedLocale: SupportedLocale | null = null;
let loadedMessages: LocaleMessages = {};

const supportedLocales: readonly SupportedLocale[] = [
  'ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW',
];

export function browserLocale(): SupportedLocale {
  const chromeLocale = (globalThis as typeof globalThis & { chrome?: ChromeWithI18n }).chrome
    ?.i18n?.getUILanguage?.();
  const raw = (chromeLocale || globalThis.navigator?.language || 'en').toLowerCase();
  if (raw.startsWith('zh-tw') || raw.startsWith('zh-hk') || raw.startsWith('zh-mo')) return 'zh_TW';
  if (raw.startsWith('zh')) return 'zh_CN';
  if (raw.startsWith('pt')) return 'pt_BR';
  const base = raw.slice(0, 2) as SupportedLocale;
  return supportedLocales.includes(base) ? base : 'en';
}

export async function loadLocale(choice: LocaleChoice): Promise<SupportedLocale> {
  const locale = choice === 'browser' ? browserLocale() : choice;
  if (loadedLocale === locale) return locale;
  try {
    const browserApi = (globalThis as typeof globalThis & {
      browser?: { runtime?: { getURL?: (path: string) => string } };
    }).browser;
    const url = browserApi?.runtime?.getURL?.(`_locales/${locale}/messages.json`)
      ?? `/_locales/${locale}/messages.json`;
    const response = await fetch(url);
    if (response.ok) loadedMessages = await response.json() as LocaleMessages;
  } catch {
    loadedMessages = {};
  }
  loadedLocale = locale;
  return locale;
}

export function message(
  key: string,
  fallback: string,
  substitutions?: string | string[],
): string {
  try {
    const localMessage = loadedMessages[key]?.message;
    if (localMessage) {
      const values = typeof substitutions === 'string' ? [substitutions] : substitutions ?? [];
      return localMessage.replace(/\$(\d+)/g, (_match, index: string) => values[Number(index) - 1] ?? '');
    }
    const chromeApi = (globalThis as typeof globalThis & { chrome?: ChromeWithI18n }).chrome;
    const localized = chromeApi?.i18n?.getMessage(key, substitutions);
    return localized || fallback;
  } catch {
    return fallback;
  }
}

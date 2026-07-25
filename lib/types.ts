import { MESSAGE_TYPES } from './constants';

declare const cssPixelsBrand: unique symbol;
declare const devicePixelsBrand: unique symbol;

export type CssPixels = number & { readonly [cssPixelsBrand]: 'CssPixels' };
export type DevicePixels = number & {
  readonly [devicePixelsBrand]: 'DevicePixels';
};

export interface CssRect {
  bottom: CssPixels;
  height: CssPixels;
  left: CssPixels;
  right: CssPixels;
  top: CssPixels;
  width: CssPixels;
}

export interface DeviceRect {
  height: DevicePixels;
  width: DevicePixels;
  x: DevicePixels;
  y: DevicePixels;
}

export interface CaptureFrame {
  clipRect: DeviceRect;
  dataUrl: string;
}

export interface CaptureResult {
  frames: CaptureFrame[];
  outputHeight: DevicePixels;
  outputWidth: DevicePixels;
}

export interface CaptureTabRequest {
  type: typeof MESSAGE_TYPES.CAPTURE_TAB;
}

export type CaptureMode =
  | 'allScrollable'
  | 'custom'
  | 'element'
  | 'focus'
  | 'fullPage'
  | 'region';

export type SupportedLocale =
  | 'ar'
  | 'de'
  | 'en'
  | 'es'
  | 'fr'
  | 'ja'
  | 'ko'
  | 'pt_BR'
  | 'zh_CN'
  | 'zh_TW';

export type LocaleChoice = 'browser' | SupportedLocale;

export interface CaptureSettings {
  intervalMs: number;
  language: LocaleChoice;
  preview: boolean;
  restoreEditedContent: boolean;
  restoreHiddenElements: boolean;
  // Kept in the wire format for backwards compatibility; scroll restoration
  // is always enabled by the picker regardless of this legacy field.
  restorePage: boolean;
  settleDelayMs: number;
}

export interface OpenPreviewRequest {
  dataUrl: string;
  type: typeof MESSAGE_TYPES.OPEN_PREVIEW;
}

export interface PreviewReadyRequest {
  tabId: number;
  type: typeof MESSAGE_TYPES.PREVIEW_READY;
}

export interface SetPreviewDataRequest {
  dataUrl: string;
  tabId: number;
  type: typeof MESSAGE_TYPES.SET_PREVIEW_DATA;
}

export interface ContentPingRequest {
  type: typeof MESSAGE_TYPES.CONTENT_PING;
}

export interface StartPickCommand {
  mode: CaptureMode;
  settings: CaptureSettings;
  type: typeof MESSAGE_TYPES.START_PICK;
}

export interface StartPickRequest {
  mode: CaptureMode;
  settings: CaptureSettings;
  type: typeof MESSAGE_TYPES.START_PICK_REQUEST;
}

export type ExtensionRequest =
  | CaptureTabRequest
  | ContentPingRequest
  | OpenPreviewRequest
  | PreviewReadyRequest
  | SetPreviewDataRequest
  | StartPickCommand
  | StartPickRequest;

export interface CaptureTabSuccessResponse {
  dataUrl: string;
  ok: true;
}

export interface SuccessResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
  ok: false;
}

export type CaptureTabResponse = CaptureTabSuccessResponse | ErrorResponse;
export type CommandResponse = SuccessResponse | ErrorResponse;

export function cssPixels(value: number): CssPixels {
  return value as CssPixels;
}

export function devicePixels(value: number): DevicePixels {
  return value as DevicePixels;
}

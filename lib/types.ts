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

export interface SiteCaptureSession {
  readonly contentHeight: CssPixels;
  readonly viewportHeight: CssPixels;
  applyPosition(position: CssPixels): void;
  assertPosition(position: CssPixels): void;
  restore(): void;
}

export interface SiteCaptureTarget {
  readonly viewport: HTMLElement;
  createCaptureSession(): SiteCaptureSession;
}

export interface SiteCaptureAdapter {
  readonly name: string;
  resolve(element: HTMLElement): SiteCaptureTarget | null;
}

export interface CaptureTabRequest {
  type: typeof MESSAGE_TYPES.CAPTURE_TAB;
}

export interface ContentPingRequest {
  type: typeof MESSAGE_TYPES.CONTENT_PING;
}

export interface StartPickCommand {
  type: typeof MESSAGE_TYPES.START_PICK;
}

export interface StartPickRequest {
  type: typeof MESSAGE_TYPES.START_PICK_REQUEST;
}

export type ExtensionRequest =
  | CaptureTabRequest
  | ContentPingRequest
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

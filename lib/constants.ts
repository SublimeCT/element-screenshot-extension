export const MESSAGE_TYPES = {
  CAPTURE_TAB: 'ELEMENT_SHOT_CAPTURE_TAB',
  CONTENT_PING: 'ELEMENT_SHOT_CONTENT_PING',
  START_PICK: 'ELEMENT_SHOT_START_PICK',
  START_PICK_REQUEST: 'ELEMENT_SHOT_START_PICK_REQUEST',
} as const;

export const CAPTURE_SETTLE_DELAY_MS = 120;

// Chrome currently permits at most two captureVisibleTab calls per second.
export const MIN_CAPTURE_INTERVAL_MS = 520;

export const PICKER_SCRIPT_PATH = '/element-picker.js';

import {
  devicePixels,
  type CaptureResult,
  type DevicePixels,
} from './types';

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/;

function dataUrlToBlob(dataUrl: string): Blob {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    throw new Error('截图帧不是有效的 data URL。');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const encoded = match[3];
  const binary = match[2]
    ? atob(encoded)
    : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function assertClipFitsBitmap(
  bitmap: ImageBitmap,
  x: DevicePixels,
  y: DevicePixels,
  width: DevicePixels,
  height: DevicePixels,
): void {
  if (
    x < 0 ||
    y < 0 ||
    x + width > bitmap.width ||
    y + height > bitmap.height
  ) {
    throw new Error(
      `物理像素裁剪框 ${x},${y},${width}x${height} 超出截图边界 ${bitmap.width}x${bitmap.height}。`,
    );
  }
}

export async function stitchFramesToPng({
  frames,
  outputHeight,
  outputWidth,
}: CaptureResult): Promise<Blob> {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('当前浏览器不支持 OffscreenCanvas。');
  }
  if (frames.length === 0 || outputWidth <= 0 || outputHeight <= 0) {
    throw new Error('没有可供拼接的截图帧。');
  }

  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('无法创建图像拼接上下文。');
  }

  let destinationY = devicePixels(0);

  for (const frame of frames) {
    const bitmap = await createImageBitmap(dataUrlToBlob(frame.dataUrl));
    try {
      const { height, width, x, y } = frame.clipRect;
      assertClipFitsBitmap(bitmap, x, y, width, height);
      if (width !== outputWidth) {
        throw new Error('截图过程中目标元素宽度发生变化。');
      }

      context.drawImage(
        bitmap,
        x,
        y,
        width,
        height,
        0,
        destinationY,
        width,
        height,
      );
      destinationY = devicePixels(destinationY + height);
    } finally {
      bitmap.close();
    }
  }

  if (destinationY !== outputHeight) {
    throw new Error('拼接后的物理像素高度与预期不一致。');
  }

  return await canvas.convertToBlob({ type: 'image/png' });
}

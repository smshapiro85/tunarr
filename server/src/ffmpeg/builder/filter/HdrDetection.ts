import { ColorPrimaries } from '@/ffmpeg/builder/constants.js';
import type { VideoStream } from '@/ffmpeg/builder/MediaStream.js';

export function isHdrContent(videoStream: VideoStream): boolean {
  return videoStream.isHdr() || videoStream.isDolbyVision();
}

/**
 * True when the source uses BT.2020 primaries but an SDR transfer curve —
 * wide gamut without being HDR.
 *
 * These need the same gamut conversion as HDR content even though no dynamic
 * range compression is required. Sent to a BT.709 pipeline untouched they look
 * markedly flat and desaturated, because BT.2020 primaries are being
 * interpreted as BT.709.
 */
export function isWideGamutSdrContent(videoStream: VideoStream): boolean {
  return (
    !isHdrContent(videoStream) &&
    videoStream.colorFormat?.colorPrimaries === ColorPrimaries.Bt2020
  );
}

/** Anything whose colour needs converting before a BT.709 output. */
export function needsColorConversion(videoStream: VideoStream): boolean {
  return isHdrContent(videoStream) || isWideGamutSdrContent(videoStream);
}

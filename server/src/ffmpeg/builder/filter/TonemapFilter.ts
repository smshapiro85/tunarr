import { FilterOption } from '@/ffmpeg/builder/filter/FilterOption.js';
import { PixelFormatYuv420P } from '@/ffmpeg/builder/format/PixelFormat.js';
import { DefaultTonemapPeakNits } from '@/ffmpeg/builder/options/KnownFfmpegOptions.js';
import type { FrameState } from '@/ffmpeg/builder/state/FrameState.js';
import { FrameDataLocation } from '@/ffmpeg/builder/types.js';
import { ColorTransferFormats } from '@/ffmpeg/builder/constants.js';
import { ColorFormat } from '../format/ColorFormat.ts';

export class TonemapFilter extends FilterOption {
  constructor(private currentState: FrameState) {
    super();
  }

  public readonly affectsFrameState = true;

  public get filter(): string {
    const transfer = this.currentState.colorFormat?.colorTransfer;
    // Only pin `tin` for the HDR transfers zscale can actually invert. DV
    // Profile 5 may report color_transfer = null/unknown, so naming smpte2084
    // explicitly stops zscale guessing wrong. Anything else — notably the
    // bt2020-10 curve on wide-gamut SDR sources — is rejected outright
    // ("no path between colorspaces") and would fail the whole filter graph,
    // so let zscale infer it from the stream instead.
    const invertible: (string | null | undefined)[] = [
      ColorTransferFormats.Smpte2084,
      ColorTransferFormats.AribStdB67,
    ];
    const tinParam = invertible.includes(transfer) ? `:tin=${transfer}` : '';
    const tonemap = `zscale=t=linear${tinParam}:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0:peak=${DefaultTonemapPeakNits},zscale=t=bt709:m=bt709:r=tv,format=yuv420p`;
    return this.currentState.frameDataLocation === FrameDataLocation.Hardware
      ? `hwdownload,format=p010le|nv12,${tonemap}`
      : tonemap;
  }

  nextState(currentState: FrameState): FrameState {
    return currentState.update({
      colorFormat: ColorFormat.bt709,
      frameDataLocation: FrameDataLocation.Software,
      pixelFormat: new PixelFormatYuv420P(),
    });
  }
}

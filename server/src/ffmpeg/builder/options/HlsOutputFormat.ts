import type { FrameState } from '@/ffmpeg/builder/state/FrameState.js';
import { OutputOption } from './OutputOption.ts';

export class HlsOutputFormat extends OutputOption {
  public static SegmentSeconds = 4;

  constructor(
    private desiredState: FrameState,
    private mediaFrameRate: number,
    private playlistPath: string,
    private segmentTemplate: string,
    private baseStreamUrl: string,
    private isFirstTranscode: boolean,
    private oneSecondGop: boolean,
    private emitEndList: boolean = false,
    private segmentSeconds: number = HlsOutputFormat.SegmentSeconds,
  ) {
    super();
  }

  options(): string[] {
    const frameRate = this.desiredState.frameRate ?? this.mediaFrameRate;
    const gop = this.oneSecondGop
      ? frameRate
      : frameRate * this.segmentSeconds;
    const opts = [
      '-g',
      `${gop}`,
      '-keyint_min',
      `${frameRate * this.segmentSeconds}`,
      '-force_key_frames',
      `expr:gte(t,n_forced*${this.segmentSeconds})`,
      '-f',
      'hls',
      '-hls_time',
      `${this.segmentSeconds}`,
      '-hls_list_size',
      '0',
      '-segment_list_flags',
      '+live',
      '-hls_segment_type',
      'mpegts',
      '-hls_segment_filename',
      this.segmentTemplate,
      '-hls_base_url',
      this.baseStreamUrl,
      '-master_pl_name',
      'playlist.m3u8',
    ];

    const flags = ['program_date_time', 'append_list', 'independent_segments'];
    if (!this.emitEndList) flags.push('omit_endlist');
    if (!this.isFirstTranscode) flags.push('discont_start');

    opts.push('-hls_flags', flags.join('+'));

    if (!this.isFirstTranscode) {
      opts.push('-mpegts_flags', '+initial_discontinuity');
    }

    opts.push(this.playlistPath);

    return opts;
  }
}

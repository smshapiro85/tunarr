import type { FrameSize } from '@/ffmpeg/builder/types.js';
import { FilterOption } from './FilterOption.ts';

/**
 * Briefly identifies what is playing in the lower-right corner when a channel
 * starts, then fades out.
 *
 * Rendered as one `drawtext` per line rather than a single multi-line one:
 * drawtext has no right-align mode, but each filter resolves `tw` against its
 * own string, so `x=w-tw-margin` right-aligns the lines independently.
 *
 * The fade is an alpha ramp rather than `enable=`, which would pop the text off
 * in a single frame.
 *
 * Requires an ffmpeg built with libfreetype. Callers must check
 * {@link FfmpegCapabilities} for the drawtext filter before adding this.
 */
export class EpisodeOverlayFilter extends FilterOption {
  /** Seconds spent fading out, ending exactly at `holdSeconds`. */
  private static readonly FadeSeconds = 0.75;

  constructor(
    private size: FrameSize,
    private lines: string[],
    private holdSeconds: number,
    private fontFile: string,
  ) {
    super();
  }

  /**
   * drawtext parses `:` as an option separator and `'` as a quote, and neither
   * survives being escaped reliably across shell-free argv passing. Episode
   * titles routinely contain both, so substitute rather than escape:
   * a typographic apostrophe renders identically, and `:` becomes a dash.
   */
  private static sanitize(text: string): string {
    return text
      .replace(/\\/g, '')
      .replace(/%/g, '')
      .replace(/'/g, '’')
      .replace(/:/g, ' -')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 64);
  }

  get filter() {
    const lines = this.lines
      .map((l) => EpisodeOverlayFilter.sanitize(l))
      .filter((l) => l.length > 0);

    if (lines.length === 0 || this.holdSeconds <= 0) {
      return '';
    }

    // Scale with frame height so 720p and 1080p look the same on screen.
    const primary = Math.max(18, Math.round(this.size.height / 24));
    const secondary = Math.max(16, Math.round(this.size.height / 32));
    const margin = Math.round(this.size.height / 20);
    const gap = Math.round(primary * 0.35);
    const border = Math.max(2, Math.round(primary / 14));

    const fadeStart = Math.max(0, this.holdSeconds - EpisodeOverlayFilter.FadeSeconds);
    // Full opacity until fadeStart, linear ramp to 0 at holdSeconds, then off.
    const alpha =
      `if(lt(t,${fadeStart}),1,` +
      `if(lt(t,${this.holdSeconds}),(${this.holdSeconds}-t)/${EpisodeOverlayFilter.FadeSeconds},0))`;

    const sizes = [primary, secondary];
    // Lay the block out from the bottom up so the last line sits on the margin.
    const totalHeight = lines.reduce(
      (acc, _, i) => acc + (sizes[i] ?? secondary) + (i > 0 ? gap : 0),
      0,
    );

    let offset = 0;
    return lines
      .map((text, i) => {
        const fontsize = sizes[i] ?? secondary;
        const y = `h-${margin + totalHeight - offset}`;
        offset += fontsize + gap;
        return [
          `drawtext=fontfile=${this.fontFile}`,
          `text=${text}`,
          `fontsize=${fontsize}`,
          `fontcolor=white`,
          `borderw=${border}`,
          `bordercolor=black@0.75`,
          `x=w-tw-${margin}`,
          `y=${y}`,
          `alpha='${alpha}'`,
        ].join(':');
      })
      .join(',');
  }
}

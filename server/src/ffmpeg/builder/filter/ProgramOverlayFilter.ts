import type { FrameSize } from '@/ffmpeg/builder/types.js';
import { FilterOption } from './FilterOption.ts';

/**
 * Briefly identifies what is playing in the lower-right corner when a channel
 * starts, then fades out. Content-agnostic: it renders whatever lines it is
 * given, so the caller decides how an episode, movie or track is described.
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
export class ProgramOverlayFilter extends FilterOption {
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
   * Makes arbitrary text safe inside a drawtext option value.
   *
   * Each character here was verified by RENDERING, not just by checking that
   * the filter graph parses — several forms parse successfully and then
   * silently swallow the remaining options into the text:
   *
   *   `,` `;` `[` `]`  backslash escape works
   *   `:`              escaping fails to parse; replaced with " -"
   *   `'`              escaping renders nothing (ffmpeg reads it as an opening
   *                    quote and consumes the rest); replaced with U+2019,
   *                    which is visually identical
   *   `%`              left alone; `expansion=none` on the filter makes it
   *                    literal instead of a strftime/expansion token
   *   `\`              removed; it cannot be escaped reliably here and
   *                    interacts with every other escape
   *
   * Without this a title like "Make Love, Not Warcraft" terminates the drawtext
   * filter early and breaks the whole graph, which drops the channel to the
   * error screen. 257 episode titles in the source library contain such
   * characters.
   */
  private static sanitize(text: string): string {
    // Transform the two characters that are supported but cannot be escaped.
    let out = text.replace(/'/g, '’').replace(/:/g, ' -');

    // Allowlist: keep letters, marks and digits in any script, whitespace, and
    // the punctuation below. Everything else — including any character not
    // considered here — is dropped rather than trusted, so an unexpected
    // character can never reach the filter graph.
    out = out.replace(/[^\p{L}\p{M}\p{N}\s,;[\]().!?&#@+*/%"’-]/gu, '');

    // Escape the ones drawtext would otherwise treat as syntax.
    out = out.replace(/([,;[\]])/g, '\\$1');

    return out.replace(/\s+/g, ' ').trim().slice(0, 64);
  }


  get filter() {
    const lines = this.lines
      .map((l) => ProgramOverlayFilter.sanitize(l))
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

    const fadeStart = Math.max(0, this.holdSeconds - ProgramOverlayFilter.FadeSeconds);
    // Full opacity until fadeStart, linear ramp to 0 at holdSeconds, then off.
    const alpha =
      `if(lt(t,${fadeStart}),1,` +
      `if(lt(t,${this.holdSeconds}),(${this.holdSeconds}-t)/${ProgramOverlayFilter.FadeSeconds},0))`;

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
          // Make % and {} literal rather than expansion tokens.
          `expansion=none`,
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

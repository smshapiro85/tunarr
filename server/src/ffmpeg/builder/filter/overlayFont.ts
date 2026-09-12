import { existsSync } from 'node:fs';
import type { Nullable } from '../../../types/util.ts';

/**
 * drawtext needs an explicit font file unless ffmpeg was built with
 * fontconfig, which is not guaranteed. These are ordered most- to
 * least-preferred and cover macOS, Debian/Ubuntu and Alpine images.
 */
const CandidateFonts = [
  // macOS
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial.ttf',
  // Debian / Ubuntu
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  // Alpine
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
];

let cached: Nullable<string> | undefined;

/**
 * First usable font on this machine, or null when none is found. Resolved once
 * and cached -- this runs on the stream start path, which is latency sensitive.
 */
export function resolveOverlayFontFile(): Nullable<string> {
  if (cached !== undefined) {
    return cached;
  }
  cached = CandidateFonts.find((f) => existsSync(f)) ?? null;
  return cached;
}

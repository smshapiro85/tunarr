import { describe, expect, it } from 'vitest';
import { FrameSize } from '../types.ts';
import { ProgramOverlayFilter } from './ProgramOverlayFilter.ts';

const size = FrameSize.create({ width: 1920, height: 1080 });
const FONT = '/System/Library/Fonts/Helvetica.ttc';

const build = (lines: string[], hold = 5) =>
  new ProgramOverlayFilter(size, lines, hold, FONT).filter;

describe('ProgramOverlayFilter', () => {
  it('renders one drawtext per line', () => {
    const f = build(['Season 3 - Episode 8', 'The Puffy Shirt']);
    expect(f.match(/drawtext=/g)).toHaveLength(2);
    expect(f).toContain('text=Season 3 - Episode 8');
    expect(f).toContain('text=The Puffy Shirt');
  });

  it('right-aligns every line against its own width', () => {
    // drawtext has no align option; x must be derived from tw per filter or
    // lines of different lengths would not share a right edge.
    const xs = build(['A', 'Much longer second line']).match(/x=w-tw-\d+/g);
    expect(xs).toHaveLength(2);
    expect(new Set(xs).size).toBe(1);
  });

  it('holds full opacity then ramps to zero at the hold time', () => {
    const f = build(['One'], 5);
    // Full until 4.25, then a linear ramp reaching 0 exactly at 5.
    expect(f).toContain("alpha='if(lt(t,4.25),1,if(lt(t,5),(5-t)/0.75,0))'");
  });

  it('substitutes characters drawtext would parse as syntax', () => {
    // ':' separates options and "'" quotes; escaping them does not survive
    // argv passing reliably, so they are replaced instead.
    const f = build(["Bob's Burgers: The Movie"]);
    expect(f).toContain('text=Bob’s Burgers - The Movie');
    expect(f).not.toMatch(/text=[^:]*:[^=]*'/);
  });

  it('stacks lines upward so the last one sits on the bottom margin', () => {
    const ys = [...build(['First', 'Second']).matchAll(/y=h-(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(ys).toHaveLength(2);
    // Larger offset from h == higher on screen, so line 1 sits above line 2.
    expect(ys[0]).toBeGreaterThan(ys[1]!);
  });

  it('emits nothing when there is no text or no time to show it', () => {
    expect(build([])).toBe('');
    expect(build(['   '])).toBe('');
    expect(build(['Something'], 0)).toBe('');
  });
});

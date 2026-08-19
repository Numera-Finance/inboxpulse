import { describe, it, expect } from 'vitest';
import { solidBarPng } from './bar';

/**
 * The band is the card's only structural device with color, so it has to be a
 * real PNG — a malformed one renders as a broken-image glyph in the panel,
 * which is worse than no band at all.
 */
describe('solidBarPng', () => {
  it('emits a valid PNG signature and IHDR/IDAT/IEND chunks', () => {
    const png = solidBarPng('d93025', 600, 6);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const s = png.toString('latin1');
    expect(s).toContain('IHDR');
    expect(s).toContain('IDAT');
    expect(s).toContain('IEND');
  });

  it('encodes the requested dimensions', () => {
    const png = solidBarPng('1a73e8', 600, 6);
    expect(png.readUInt32BE(16)).toBe(600);
    expect(png.readUInt32BE(20)).toBe(6);
  });

  /** A bad color must not throw — the panel would lose the whole card. */
  it('falls back to grey on invalid input rather than failing', () => {
    expect(() => solidBarPng('nonsense')).not.toThrow();
    expect(() => solidBarPng('')).not.toThrow();
  });

  /** Solid color compresses to almost nothing; a large payload means a bug. */
  it('stays tiny', () => {
    expect(solidBarPng('d93025', 600, 6).length).toBeLessThan(1000);
  });
});

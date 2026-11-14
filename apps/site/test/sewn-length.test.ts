import { describe, expect, it } from 'vitest';
import { sewnLength } from '../src/lib/sewn-length';

describe('sewnLength', () => {
  it('places the needle at 60% of the viewport relative to the cloth', () => {
    expect(sewnLength(-200, 2000, 800)).toBe(680);
  });
  it('clamps before the beginning and before the hem', () => {
    expect(sewnLength(900, 2000, 800)).toBe(40);
    expect(sewnLength(-3000, 2000, 800)).toBe(1850);
  });
  it('keeps short cloth within its usable length', () => {
    expect(sewnLength(900, 170, 800)).toBe(20);
    expect(sewnLength(-900, 100, 800)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';

import { packageName } from '../src/index';

describe('package scaffold', () => {
  it('exports its name', () => {
    expect(packageName).toBe('@handmake/publisher');
  });
});

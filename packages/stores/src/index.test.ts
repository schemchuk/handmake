import { describe, expect, it } from 'vitest';

import { packageName } from './index';

describe('package scaffold', () => {
  it('exports its name', () => {
    expect(packageName).toBe('@handmake/stores');
  });
});

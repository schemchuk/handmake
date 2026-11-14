import { expect, it } from 'vitest';
import { bundledFamilies, familyFallbacks } from '../src/lib/font-families';
import { fontFaceCss, fontStack } from '../src/lib/fonts';

it('self-hosts both scripts for display and body without synthesizing Gabriela weights', () => {
  const css = fontFaceCss();
  for (const family of ['Gabriela', 'Onest']) {
    expect(css).toContain(`font-family:'${family}'`);
    expect(css).toMatch(
      new RegExp(`font-family:'${family}'[^}]+unicode-range:U\\+0301,U\\+0400-045F`),
    );
  }
  expect(css).toContain("font-family:'Gabriela';font-style:normal;font-weight:400;");
  expect(css).not.toMatch(/https?:/);
  expect(fontStack('Gabriela')).toContain('Georgia,serif');
  expect(fontStack('Onest')).toContain('system-ui,sans-serif');
});

it('uses the configured fallback for every bundled family', () => {
  expect(Object.keys(familyFallbacks).sort()).toEqual([...bundledFamilies].sort());
  for (const family of bundledFamilies) {
    expect(fontStack(family)).toBe(`'${family}',${familyFallbacks[family]}`);
  }
  expect(fontStack('Gabriela')).toBe("'Gabriela',Georgia,serif");
  expect(fontStack('Onest')).toBe("'Onest',system-ui,sans-serif");
});

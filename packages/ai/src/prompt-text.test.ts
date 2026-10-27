import { describe, expect, it } from 'vitest';

import { loadPrompt } from './prompts';
import { humanizeDePromptV1 } from './prompt-text';

describe('humanizeDePromptV1', () => {
  it('matches the source-of-truth markdown file byte for byte', async () => {
    expect(humanizeDePromptV1).toBe(await loadPrompt('humanize-de@1'));
  });
});

/**
 * Manual eval (T12): translate the sample posts with the live API and write a
 * side-by-side Markdown report for the author and Volodymyr to judge.
 *
 *   pnpm --filter @handmake/ai eval        (needs ANTHROPIC_API_KEY in .env)
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClaudeTranslator, TranslationError, loadPrompt } from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env['ANTHROPIC_API_KEY'];
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set (see .env.example)');
  process.exit(1);
}

const samples = JSON.parse(await readFile(path.join(here, 'samples.json'), 'utf8')) as {
  id: string;
  uk: string;
}[];
const translator = new ClaudeTranslator({
  apiKey,
  model: process.env['ANTHROPIC_MODEL'] ?? undefined,
  systemPrompt: await loadPrompt('humanize-de@1'),
});

const lines = [
  `# Eval: humanize-de@1 on ${translator.model}`,
  '',
  'Judge each pair: facts kept (names, dates, times, numbers)? Natural German? Anything that sounds machine-written?',
  '',
];
for (const sample of samples) {
  lines.push(`## ${sample.id}`, '', '**UA**', '', sample.uk, '');
  try {
    const result = await translator.translate({
      text: sample.uk,
      sourceLang: 'uk',
      targetLang: 'de',
    });
    lines.push('**DE**', '', result.text, '');
    if (result.notes) lines.push('**Notes for the author**', '', result.notes, '');
  } catch (error) {
    const message = error instanceof TranslationError ? error.message : String(error);
    lines.push(`**FAILED**: ${message}`, '');
  }
}
const out = path.join(here, 'results', 'humanize-de@1.md');
await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(out), { recursive: true }));
await writeFile(out, lines.join('\n'));
console.log(`wrote ${out}`);

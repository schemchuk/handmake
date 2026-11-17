import { parseOptions } from './plan.ts';
import { processReel } from './media.ts';
try {
  const result = await processReel(parseOptions(process.argv.slice(2)));
  console.log(
    `Kept: ${(result.plan.kept / 60).toFixed(2)} min; dropped: ${(result.plan.dropped / 60).toFixed(2)} min; speed: ${result.plan.speed.toFixed(2)}x`,
  );
  console.log(
    `${result.out}: ${(result.size / 1_000_000).toFixed(2)} MB, ${result.duration.toFixed(2)} s`,
  );
  console.log(
    'Прослухайте відео перед надсиланням: жодних голосів інших людей, музики з радіо чи телевізора.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

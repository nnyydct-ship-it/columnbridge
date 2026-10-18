#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { matchHeaders, createLocalEmbedder, readCsvHeaders, buildReview, applyReview } from '../src/index.js';
import { assertSeparateOutputs, writeJsonAtomic } from '../src/files.js';

const help = `ColumnBridge — local AI CSV column matching

match --input file.csv --schema schema.json --out report.json [--offline]
      [--cache-dir .cache/models] [--min-score 0.48] [--min-margin 0.08]
apply --input file.csv --review report.json.review.json --out new.csv

match writes a report and an unapproved review template. It never changes CSV.
First run downloads one pinned q8 model. --offline prohibits remote model loads.
Only headers + schema descriptions are embedded locally. Row values are not used.
apply requires manual approved:true, checks source headers and rejects collisions.
Scores are cosine similarities, not probabilities. Never trust a mapping unreviewed.
`;

let embedder;
try {
  const args = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, schema: { type: 'string' }, out: { type: 'string' },
    review: { type: 'string' }, offline: { type: 'boolean', default: false },
    'cache-dir': { type: 'string', default: '.cache/models' },
    'min-score': { type: 'string', default: '0.48' }, 'min-margin': { type: 'string', default: '0.08' },
    help: { type: 'boolean', short: 'h' }
  } });
  const [command] = args.positionals, v = args.values;
  if (v.help || !command) { process.stdout.write(help); process.exit(0); }
  if (!v.input || !v.out) throw new Error('--input and --out are required.');
  if (command === 'match') {
    if (!v.schema) throw new Error('--schema is required.');
    await assertSeparateOutputs([v.out, `${v.out}.review.json`], [v.input, v.schema]);
    const headers = await readCsvHeaders(v.input);
    const schema = JSON.parse(await readFile(v.schema, 'utf8'));
    embedder = await createLocalEmbedder({ cacheDir: v['cache-dir'], offline: v.offline,
      progress: (event) => { if (event.status === 'initiate') process.stderr.write(`Loading ${event.file}\n`); } });
    const report = await matchHeaders(headers, schema, embedder, { offline: v.offline, minScore: Number(v['min-score']), minMargin: Number(v['min-margin']) });
    await writeJsonAtomic(v.out, report);
    await writeJsonAtomic(`${v.out}.review.json`, buildReview(report));
    for (const mapping of report.mappings) {
      const margin = mapping.margin === null ? 'n/a' : mapping.margin.toFixed(3);
      process.stdout.write(`${mapping.source} → ${mapping.proposedTarget} | cosine ${mapping.score.toFixed(3)} | margin ${margin} | ${mapping.reasons.join(', ') || 'suggested; review before applying'}\n`);
    }
    process.stdout.write(`Report: ${v.out}\nCSV unchanged. Review template: ${v.out}.review.json\n`);
  } else if (command === 'apply') {
    if (!v.review) throw new Error('--review is required.');
    const result = await applyReview(v.input, v.out, JSON.parse(await readFile(v.review, 'utf8')));
    process.stdout.write(`Wrote ${result.rows} rows to ${v.out}; only column names changed.\n`);
  } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  process.stderr.write(`ColumnBridge: ${error.message}\n`);
  process.exitCode = 1;
} finally { await embedder?.dispose(); }

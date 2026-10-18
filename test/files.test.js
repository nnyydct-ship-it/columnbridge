import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, link, rm } from 'node:fs/promises';
import path from 'node:path';
import { assertSeparateOutputs, writeJsonAtomic } from '../src/files.js';

async function fixture(fn) {
  const dir = await mkdtemp(path.resolve('.test-files-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('atomic report write replaces symlink without changing CSV bytes', () => fixture(async (dir) => {
  const input = path.join(dir, 'input.csv'), output = path.join(dir, 'report.json');
  await writeFile(input, 'private,data\nKEEP,UNCHANGED\n');
  await symlink(input, output);
  await assertSeparateOutputs([output], [input]);
  await writeJsonAtomic(output, { report: true });
  assert.equal(await readFile(input, 'utf8'), 'private,data\nKEEP,UNCHANGED\n');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { report: true });
}));

test('atomic report write replaces hardlink without changing CSV bytes', () => fixture(async (dir) => {
  const input = path.join(dir, 'input.csv'), output = path.join(dir, 'report.json');
  await writeFile(input, 'header\nKEEP\n');
  await link(input, output);
  await assertSeparateOutputs([output], [input]);
  await writeJsonAtomic(output, { report: true });
  assert.equal(await readFile(input, 'utf8'), 'header\nKEEP\n');
}));

test('directory symlink cannot disguise the same input entry as a report path', () => fixture(async (dir) => {
  const input = path.join(dir, 'input.csv'), alias = path.join(dir, 'alias');
  await writeFile(input, 'a\nKEEP\n');
  await symlink(dir, alias, 'dir');
  await assert.rejects(assertSeparateOutputs([path.join(alias, 'input.csv')], [input]), /differ/);
  assert.equal(await readFile(input, 'utf8'), 'a\nKEEP\n');
}));

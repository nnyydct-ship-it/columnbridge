import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { readCsvHeaders, applyReview, headerDigest } from '../src/index.js';

// Scratch stays under this project and is removed after each test.
async function fixture(fn) {
  const dir = await mkdtemp(path.resolve('.test-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('header reader handles BOM, CRLF and quoted embedded newline without using samples', () => fixture(async (dir) => {
  const file = path.join(dir, 'in.csv');
  await writeFile(file, '\uFEFF"full\nname",email\r\n"Mira, Chen",mira@example.invalid\r\n');
  assert.deepEqual(await readCsvHeaders(file), ['full\nname', 'email']);
}));

test('duplicate headers and missing inputs fail explicitly', () => fixture(async (dir) => {
  const file = path.join(dir, 'in.csv');
  await writeFile(file, 'a,a\n1,2\n');
  await assert.rejects(readCsvHeaders(file), /Duplicate/);
  await assert.rejects(readCsvHeaders(path.join(dir, 'missing.csv')), /ENOENT/);
}));

test('explicit approved rename preserves CSV cell values, source bytes and formula text', () => fixture(async (dir) => {
  const file = path.join(dir, 'in.csv'), output = path.join(dir, 'out.csv');
  const source = 'old,notes\r\n"Mira, Chen","=SUM(1,2)"\r\n"Line\nbreak","<script>not executed</script>"\r\n';
  await writeFile(file, source);
  const review = { approved: true, sourceHeadersSha256: headerDigest(['old', 'notes']), schemaFields: ['name'], rename: { old: 'name', notes: null } };
  const result = await applyReview(file, output, review);
  assert.equal(result.rows, 2);
  assert.equal(await readFile(file, 'utf8'), source);
  const before = parse(source), after = parse(await readFile(output, 'utf8'));
  assert.deepEqual(after[0], ['name', 'notes']);
  assert.deepEqual(after.slice(1), before.slice(1));
}));

test('unapproved or colliding review writes no output and no temp residue', () => fixture(async (dir) => {
  const file = path.join(dir, 'in.csv'), output = path.join(dir, 'out.csv');
  await writeFile(file, 'a,b\n1,2\n');
  const review = { approved: false, sourceHeadersSha256: headerDigest(['a', 'b']), schemaFields: ['same'], rename: { a: 'same', b: 'same' } };
  await assert.rejects(applyReview(file, output, review), /approved/);
  review.approved = true;
  await assert.rejects(applyReview(file, output, review), /conflict/);
  assert.deepEqual(await readdir(dir), ['in.csv']);
}));

test('malformed row length cleans partial output; existing output/input cannot be overwritten', () => fixture(async (dir) => {
  const file = path.join(dir, 'in.csv'), output = path.join(dir, 'out.csv');
  await writeFile(file, 'a,b\n1,2,3\n');
  const review = { approved: true, sourceHeadersSha256: headerDigest(['a', 'b']), schemaFields: ['one', 'two'], rename: { a: 'one', b: 'two' } };
  await assert.rejects(applyReview(file, output, review), /Invalid Record Length/);
  assert.deepEqual(await readdir(dir), ['in.csv']);
  await writeFile(output, 'KEEP');
  await assert.rejects(applyReview(file, output, review), /already exists/);
  assert.equal(await readFile(output, 'utf8'), 'KEEP');
  await assert.rejects(applyReview(file, file, review), /never overwritten/);
}));

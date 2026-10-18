import test from 'node:test';
import assert from 'node:assert/strict';
import { matchHeaders, rankMappings, headerDigest, buildReview, approvedOutputHeaders } from '../src/index.js';
import { cosine, validateHeaders, validateSchema } from '../src/matching.js';

const fields = [{ name: 'one', required: true }, { name: 'two', required: false }];

test('cosine uses vector geometry, including non-normalized vectors', () => {
  assert.equal(cosine([3, 0], [7, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.throws(() => cosine([0, 0], [1, 0]), /zero norm/);
  assert.throws(() => cosine([1], [1, 0]), /dimensions/);
  assert.throws(() => cosine([NaN], [1]), /non-finite/);
});

test('ranking depends on embeddings, not a string alias table', () => {
  const a = rankMappings(['unseen_alpha'], fields, [[1, 0]], [[1, 0], [0, 1]]);
  const b = rankMappings(['unseen_alpha'], fields, [[0, 1]], [[1, 0], [0, 1]]);
  assert.equal(a.mappings[0].proposedTarget, 'one');
  assert.equal(b.mappings[0].proposedTarget, 'two');
  assert.equal(a.mappings[0].margin, 1);
});

test('small margin and low similarity remain reviewable suggestions', () => {
  const tie = rankMappings(['x'], fields, [[1, 1]], [[1, 0], [0, 1]]);
  assert.ok(tie.mappings[0].reasons.includes('small_margin'));
  assert.equal(tie.mappings[0].status, 'needs_review');
  const low = rankMappings(['x'], fields, [[-1, -1]], [[1, 0], [0, 1]]);
  assert.ok(low.mappings[0].reasons.includes('low_similarity'));
  assert.deepEqual(low.requiredUnmapped, ['one']);
});

test('both sides of a target collision require review, no forced runner-up', () => {
  const result = rankMappings(['x', 'y'], fields, [[1, 0], [1, 0]], [[1, 0], [0, 1]]);
  assert.deepEqual(result.conflicts, [{ target: 'one', sources: ['x', 'y'] }]);
  assert.ok(result.mappings.every((m) => m.reasons.includes('target_collision')));
  assert.ok(result.mappings.every((m) => m.proposedTarget === 'one'));
  assert.deepEqual(result.requiredUnmapped, ['one']);
});

test('single-target schema has no invented runner-up confidence', () => {
  const result = rankMappings(['x'], fields.slice(0, 1), [[1, 0]], [[1, 0]]);
  assert.equal(result.mappings[0].runnerUp, null);
  assert.equal(result.mappings[0].margin, null);
});

test('weak unknown top-1 cannot poison a strong one-to-one suggestion', () => {
  const result = rankMappings(['strong', 'unknown'], fields, [[1, 0, 0], [0.1, 0.05, 1]], [[1, 0, 0], [0, 1, 0]]);
  assert.equal(result.mappings[0].status, 'suggested');
  assert.equal(result.mappings[1].status, 'needs_review');
  assert.ok(result.mappings[1].reasons.includes('low_similarity'));
  assert.deepEqual(result.conflicts, []);
});

test('library inference sees exactly headers and user schema, not arbitrary properties', async () => {
  let received;
  const embedder = { metadata: { id: 'test-double' }, async embed(texts) { received = texts; return [[1, 0], [1, 0]]; } };
  const report = await matchHeaders(['my_column'], { fields: [{ name: 'target', description: 'User written meaning' }], samples: ['DO_NOT_SEND'] }, embedder);
  assert.deepEqual(received, ['my column', 'target: User written meaning']);
  assert.equal(report.privacy.rowValuesUsed, false);
  assert.equal(report.action, 'report_only_no_csv_changed');
  assert.equal(report.inference.embeddingDimensions, 2);
});

test('schema and header input bounds reject unclear/duplicate identity', () => {
  assert.throws(() => validateHeaders(['a', 'a']), /Duplicate/);
  assert.throws(() => validateHeaders(['']), /nonempty/);
  assert.throws(() => validateHeaders(Array(129).fill('x')), /128/);
  assert.throws(() => validateSchema({ fields: [{ name: 'a' }, { name: 'a' }] }), /unique/);
  assert.throws(() => validateSchema({ fields: [{ name: 'a', required: 'yes' }] }), /boolean/);
});

test('review starts unapproved and source header fingerprint is bound', () => {
  const report = { sourceHeadersSha256: headerDigest(['x']), schemaFields: ['one'], mappings: [{ source: 'x', status: 'suggested', proposedTarget: 'one' }] };
  const review = buildReview(report);
  assert.equal(review.approved, false);
  assert.throws(() => approvedOutputHeaders(['x'], review), /approved/);
  review.approved = true;
  assert.deepEqual(approvedOutputHeaders(['x'], review), ['one']);
  assert.throws(() => approvedOutputHeaders(['other'], review), /different source/);
});

test('apply rejects collision with an unchanged column, unknown target and incomplete review', () => {
  const review = { approved: true, sourceHeadersSha256: headerDigest(['x', 'one']), schemaFields: ['one', 'two'], rename: { x: 'one', one: null } };
  assert.throws(() => approvedOutputHeaders(['x', 'one'], review), /conflict/);
  review.rename = { x: 'unknown', one: null };
  assert.throws(() => approvedOutputHeaders(['x', 'one'], review), /Unknown/);
  review.rename = { x: null };
  assert.throws(() => approvedOutputHeaders(['x', 'one'], review), /exactly/);
});

test('special object-key names are plain headers, never prototype operations', () => {
  const headers = ['__proto__', 'constructor'];
  const review = { approved: true, sourceHeadersSha256: headerDigest(headers), schemaFields: ['one', 'two'], rename: JSON.parse('{"__proto__":"one","constructor":"two"}') };
  assert.deepEqual(approvedOutputHeaders(headers, review), ['one', 'two']);
});

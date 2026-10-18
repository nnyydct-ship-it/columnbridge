import { createHash } from 'node:crypto';

export function headerDigest(headers) {
  return createHash('sha256').update(JSON.stringify(headers)).digest('hex');
}

export function validateHeaders(headers) {
  if (!Array.isArray(headers) || headers.length < 1 || headers.length > 128) {
    throw new Error('CSV must have between 1 and 128 columns.');
  }
  if (headers.some((h) => typeof h !== 'string' || !h.trim() || h.length > 160)) {
    throw new Error('Headers must be nonempty strings, at most 160 characters each.');
  }
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate source headers need explicit cleanup first.');
  return headers;
}

export function validateSchema(schema) {
  if (!schema || !Array.isArray(schema.fields) || schema.fields.length < 1 || schema.fields.length > 128) {
    throw new Error('Schema needs a fields array with 1–128 entries.');
  }
  const fields = schema.fields.map((field) => {
    if (!field || typeof field.name !== 'string' || !field.name.trim() || field.name.length > 160) {
      throw new Error('Each schema field needs a nonempty name, at most 160 characters.');
    }
    if (field.description !== undefined && (typeof field.description !== 'string' || field.description.length > 400)) {
      throw new Error('Field descriptions must be strings, at most 400 characters.');
    }
    if (field.required !== undefined && typeof field.required !== 'boolean') throw new Error('required must be boolean.');
    return { name: field.name, description: field.description ?? '', required: field.required ?? false };
  });
  if (new Set(fields.map((f) => f.name)).size !== fields.length) throw new Error('Target field names must be unique.');
  return fields;
}

// Formatting only: no synonyms, target-specific aliases, or fuzzy-string matching.
export function readableName(text) {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) throw new Error('Embedding dimensions do not match.');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Embedding contains a non-finite value.');
    dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  if (!aa || !bb) throw new Error('Embedding has zero norm.');
  return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}

/** Rank actual embedding similarities. Never force a second-best assignment to hide a collision. */
export function rankMappings(headers, fields, headerVectors, targetVectors, { minScore = 0.48, minMargin = 0.08 } = {}) {
  validateHeaders(headers);
  if (headerVectors.length !== headers.length || targetVectors.length !== fields.length) throw new Error('Missing embeddings.');
  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1 || !Number.isFinite(minMargin) || minMargin < 0 || minMargin > 2) {
    throw new Error('Invalid similarity threshold or margin.');
  }
  const mappings = headers.map((source, index) => {
    const ranked = fields.map((field, j) => ({ target: field.name, score: cosine(headerVectors[index], targetVectors[j]) }))
      .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
    const best = ranked[0], runnerUp = ranked[1] ?? null;
    const margin = runnerUp ? best.score - runnerUp.score : null;
    const reasons = [];
    if (best.score < minScore) reasons.push('low_similarity');
    if (runnerUp && margin < minMargin) reasons.push('small_margin');
    return { source, proposedTarget: best.target, score: best.score, runnerUp, margin, status: reasons.length ? 'needs_review' : 'suggested', reasons, alternatives: ranked.slice(0, 3) };
  });
  const groups = new Map();
  // An uncertain header is not eligible for rename, so its weak top-1 guess must
  // not veto a different header with a strong, well-separated match.
  for (const m of mappings.filter((m) => m.status === 'suggested')) {
    groups.set(m.proposedTarget, [...(groups.get(m.proposedTarget) ?? []), m.source]);
  }
  const conflicts = [];
  for (const [target, sources] of groups) {
    if (sources.length < 2) continue;
    conflicts.push({ target, sources });
    for (const m of mappings.filter((m) => m.proposedTarget === target && m.status === 'suggested')) {
      m.status = 'needs_review'; m.reasons.push('target_collision');
    }
  }
  const suggestedTargets = new Set(mappings.filter((m) => m.status === 'suggested').map((m) => m.proposedTarget));
  return { mappings, conflicts, requiredUnmapped: fields.filter((f) => f.required && !suggestedTargets.has(f.name)).map((f) => f.name) };
}

export function buildReview(report) {
  return {
    approved: false,
    sourceHeadersSha256: report.sourceHeadersSha256,
    schemaFields: report.schemaFields,
    rename: Object.fromEntries(report.mappings.map((m) => [m.source, m.status === 'suggested' ? m.proposedTarget : null])),
    instructions: 'Review every entry. null keeps the original header. Resolve collisions, then explicitly set approved to true. Similarity is not a probability.'
  };
}

export function approvedOutputHeaders(headers, review) {
  validateHeaders(headers);
  if (review.approved !== true) throw new Error('Review must explicitly set approved: true.');
  if (review.sourceHeadersSha256 !== headerDigest(headers)) throw new Error('Review belongs to different source headers.');
  if (!review.rename || typeof review.rename !== 'object' || Array.isArray(review.rename)) throw new Error('Review needs a rename object.');
  if (Object.keys(review.rename).some((key) => !headers.includes(key)) || headers.some((key) => !Object.hasOwn(review.rename, key))) {
    throw new Error('Review must contain exactly the input headers.');
  }
  const allowed = new Set(review.schemaFields);
  const output = headers.map((source) => {
    const target = review.rename[source];
    if (target === null) return source;
    if (typeof target !== 'string' || !allowed.has(target)) throw new Error(`Unknown schema target for ${source}.`);
    return target;
  });
  if (new Set(output).size !== output.length) throw new Error('One-to-one conflict: output headers would collide. Nothing was renamed.');
  return output;
}

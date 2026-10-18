import { performance } from 'node:perf_hooks';
import { validateHeaders, validateSchema, readableName, rankMappings, headerDigest } from './matching.js';
export { createLocalEmbedder, MODEL_ID, MODEL_REVISION } from './model.js';
export { rankMappings, headerDigest, buildReview, approvedOutputHeaders } from './matching.js';
export { readCsvHeaders, applyReview } from './csv.js';

export async function matchHeaders(headers, schema, embedder, options = {}) {
  validateHeaders(headers);
  const fields = validateSchema(schema);
  const headerTexts = headers.map(readableName);
  const targetTexts = fields.map((f) => `${readableName(f.name)}${f.description ? `: ${f.description}` : ''}`);
  const started = performance.now();
  const vectors = await embedder.embed([...headerTexts, ...targetTexts]);
  const inferenceMs = performance.now() - started;
  const result = rankMappings(headers, fields, vectors.slice(0, headers.length), vectors.slice(headers.length), options);
  return {
    formatVersion: 1,
    sourceHeaders: headers,
    sourceHeadersSha256: headerDigest(headers),
    schemaFields: fields.map((f) => f.name),
    model: embedder.metadata,
    inference: { textCount: headerTexts.length + targetTexts.length, embeddingDimensions: vectors[0]?.length, inferenceMs },
    privacy: { inference: 'local_cpu', rowValuesUsed: false, remoteInference: false, offline: options.offline ?? false },
    thresholds: { minScore: options.minScore ?? 0.48, minMargin: options.minMargin ?? 0.08, calibratedProbability: false },
    ...result,
    needsReview: result.mappings.some((m) => m.status === 'needs_review') || result.requiredUnmapped.length > 0,
    action: 'report_only_no_csv_changed'
  };
}

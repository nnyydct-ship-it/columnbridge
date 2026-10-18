import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';

/** Only text passed here reaches the local model; downloads never contain that text. */
export async function createLocalEmbedder({ cacheDir = '.cache/models', offline = false, progress = () => {} } = {}) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.resolve(cacheDir);
  env.allowLocalModels = true;
  env.localModelPath = path.resolve(cacheDir);
  env.allowRemoteModels = !offline;
  env.useBrowserCache = false;
  const started = performance.now();
  const extractor = await pipeline('feature-extraction', MODEL_ID, {
    revision: MODEL_REVISION,
    dtype: 'q8', device: 'cpu', local_files_only: offline,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    progress_callback: progress
  });
  const loadMs = performance.now() - started;
  return {
    metadata: { id: MODEL_ID, revision: MODEL_REVISION, dtype: 'q8', device: 'cpu', threads: 2, license: 'Apache-2.0', loadMs },
    async embed(texts) {
      const vectors = [];
      // Small batches bound peak memory on laptops. No samples or rows enter this call.
      for (let start = 0; start < texts.length; start += 8) {
        const tensor = await extractor(texts.slice(start, start + 8), { pooling: 'mean', normalize: true, truncation: true, max_length: 128 });
        vectors.push(...tensor.tolist());
        tensor.dispose?.();
      }
      return vectors;
    },
    async dispose() { await extractor.dispose(); }
  };
}

import { realpath, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

async function canonicalEntry(file) {
  return path.join(await realpath(path.dirname(path.resolve(file))), path.basename(file));
}

/** Protect both the input directory entry and its real target, including directory aliases. */
export async function assertSeparateOutputs(outputs, inputs) {
  const protectedEntries = new Set();
  for (const input of inputs) {
    protectedEntries.add(await canonicalEntry(input));
    protectedEntries.add(await realpath(input));
  }
  for (const output of outputs) {
    if (protectedEntries.has(await canonicalEntry(output))) throw new Error('Report paths must differ from CSV and schema inputs.');
  }
}

/** Atomic replacement breaks an existing symlink/hardlink rather than writing through it. */
export async function writeJsonAtomic(file, value) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

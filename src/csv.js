import { createReadStream, createWriteStream } from 'node:fs';
import { link, rm, access } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import { validateHeaders, approvedOutputHeaders } from './matching.js';

export async function readCsvHeaders(input) {
  const reader = createReadStream(input);
  const parser = parse({ bom: true, to: 1, max_record_size: 32768 });
  reader.on('error', (error) => parser.destroy(error));
  reader.pipe(parser);
  try {
    for await (const headers of parser) return validateHeaders(headers);
    throw new Error('CSV is empty.');
  } finally { reader.destroy(); parser.destroy(); }
}

export async function applyReview(input, output, review) {
  if (path.resolve(input) === path.resolve(output)) throw new Error('Choose a new output path; input CSV is never overwritten.');
  try { await access(output); throw new Error('Output already exists; choose a new path.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const headers = await readCsvHeaders(input);
  const outputHeaders = approvedOutputHeaders(headers, review);
  const temporary = `${output}.${randomUUID()}.tmp`;
  let first = true, rows = 0;
  const renameHeader = new Transform({
    objectMode: true,
    transform(record, _encoding, callback) {
      if (first) {
        first = false;
        try { approvedOutputHeaders(record, review); callback(null, outputHeaders); }
        catch (error) { callback(error); }
      }
      else { rows++; callback(null, record); }
    }
  });
  try {
    await pipeline(createReadStream(input), parse({ bom: true }), renameHeader, stringify(), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    // Atomic no-clobber publication: a racing writer cannot be overwritten.
    await link(temporary, output);
    await rm(temporary);
    return { outputHeaders, rows, output, rowValuesChanged: false };
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

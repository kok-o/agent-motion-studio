import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { StudioError } from './errors.js';

/** UTF-8 with an optional leading BOM. Never echo malformed input contents. */
export function parseJsonInput(content: string, input: string): unknown {
  try { return JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new StudioError('INVALID_JSON', 'input', `${basename(input)}: provide valid UTF-8 JSON (an optional leading BOM is supported).`, 2); }
}
export async function readJsonInput(file: string) {
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StudioError('FILE_NOT_FOUND', 'input', `File does not exist: ${file}`, 2);
    }
    throw error;
  }
  return parseJsonInput(content, file);
}

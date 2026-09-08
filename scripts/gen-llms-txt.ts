/**
 * Writes `llms.txt` from the current manifest.
 *
 * Two callers, for two reasons:
 *
 * - `scripts/build_site.sh` writes it into `_site/`, so the published file is
 *   always built from the same manifest as the data next to it.
 * - A human runs it with no arguments after editing `web/src/aiGuide.ts`, to
 *   refresh the copy committed at the repo root. That copy exists so the wording
 *   an AI actually reads shows up in a diff and can be reviewed; it holds no row
 *   counts or timestamps, so it only changes when someone changes it.
 *
 * Usage: npx tsx scripts/gen-llms-txt.ts [manifest.json] [out.txt]
 * Run it from `web/` (or via `npm exec`) so `tsx` resolves.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLlmsTxt } from '../web/src/aiGuide';
import type { Manifest } from '../web/src/manifest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const manifestPath =
  process.argv[2] ?? join(root, 'web', 'public', 'data', 'manifest.json');
const outPath = process.argv[3] ?? join(root, 'llms.txt');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
writeFileSync(outPath, buildLlmsTxt(manifest));
console.log(`Wrote ${outPath} from ${manifestPath}`);

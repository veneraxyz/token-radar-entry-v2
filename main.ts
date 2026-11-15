// Launch Radar's entry program, version 3 (Node 22, standard library only).
//
// It reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), calibrates the market's TVL-to-value ratio and category
// momentum from the protocols whose token already trades, scores every
// pre-token launch candidate with the model in lib/model.ts, writes the
// ranked board to /output/board.json and the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ to
// /output, and writes /output/dossier.json with the vendored make.fun
// library. The dashboard is a static page, no framework and no network.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUNING, assembleRadar, calibrateMarket, payloadScript, readSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASH_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function opt(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputOpt = opt('input', '/input');
const inputPath = inputOpt.endsWith('.json') ? inputOpt : join(inputOpt, 'snapshot.json');
if (!existsSync(inputPath)) {
  process.stderr.write(`launch radar: no snapshot at ${inputPath}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const outDir = opt('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = readSnapshot(readFileSync(inputPath, 'utf8'));
const calibration = calibrateMarket(snapshot.protocols, TUNING);
const { board, payload } = assembleRadar(snapshot, calibration, TUNING);
const problem = validateBoard(board, snapshot);
if (problem !== null) {
  process.stderr.write(`launch radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), payloadScript(payload));

/** Copy one directory's regular files into `to`, skipping dot-names, and report what copied. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyTree(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3 || shotFiles.length > SHOT_LIMITS.max) {
  process.stderr.write(`launch radar: screenshots/ holds ${shotFiles.length} image${shotFiles.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view, a filtered view and the method\n`);
  process.exit(1);
}
for (const name of shotFiles) {
  if (!PLAIN_FILE.test(name)) {
    process.stderr.write(`launch radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = statSync(join(outDir, 'screenshots', name)).size;
  if (bytes > SHOT_LIMITS.max_bytes) {
    process.stderr.write(`launch radar: screenshots/${name} is ${bytes} bytes: the gate refuses any image over ${SHOT_LIMITS.max_bytes}\n`);
    process.exit(1);
  }
}

// The gate wants a page, a stylesheet and a script — refuse here, loudly,
// rather than handing in a dashboard the gate rejects.
const dashSet = new Set(dashFiles);
const hasCss = dashFiles.some((n) => n.endsWith('.css'));
const hasJs = dashFiles.some((n) => n.endsWith('.js'));
if (!dashSet.has('index.html') || !hasCss || !hasJs) {
  process.stderr.write(`launch radar: dashboard/ holds ${dashFiles.join(', ') || 'nothing'}: the gate wants index.html plus at least one .css and one .js\n`);
  process.exit(1);
}

// The dossier carries at most TEXT_CAP_BYTES of source text: past that the
// judge sees a truncated page, so say so loudly instead of handing in a
// cut-down dossier without noticing.
let dashBytes = 0;
for (const name of dashFiles) dashBytes += statSync(join(outDir, 'dashboard', name)).size;
if (dashBytes > TEXT_CAP_BYTES) {
  process.stderr.write(`launch radar: dashboard source is ${dashBytes} bytes, past the ${TEXT_CAP_BYTES}-byte dossier text cap: the judge would see a truncated page\n`);
  process.exit(1);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_LIMITS, dashboard: DASH_LIMITS }));

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${payload.early_size} early, ${payload.live_size} live set aside)\n` +
    `launch radar: global mcap/TVL ${payload.global_ratio}, ${calibration.by_category.size} categories calibrated\n` +
    `launch radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dashFiles.length} files), ${join(outDir, 'screenshots')} (${shotFiles.length} images) and ${join(outDir, 'dossier.json')}\n`,
);

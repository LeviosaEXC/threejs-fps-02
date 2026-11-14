// EMBERLINE — the entry program (Node 22, standard library only). It hands the
// game in: the whole game/ folder and screenshots/ are copied beside this file
// into /output, and /output/dossier.json is written with the kit's vendored
// library, exactly as the sealed gate rebuilds it. The copy is deterministic —
// the same repository always writes the same bytes — and a small pre-flight
// refuses the run early when a gate cap would refuse the entry anyway
// (too many files, a screenshot over its cap, a game folder over its cap).
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function countEntries(dir) {
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      const sub = countEntries(path);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += info.size;
    }
  }
  return { files, bytes };
}

function preflight() {
  const game = countEntries(join(here, 'game'));
  if (game.files > 993) throw new Error(`game/ holds ${game.files} files, the gate allows 993`);
  if (game.bytes > 48 * 1024 * 1024) throw new Error(`game/ is ${game.bytes} bytes, the gate allows 48 MiB`);
  const indexSize = statSync(join(here, 'game', 'index.html')).size;
  if (indexSize > 1024 * 1024) throw new Error(`game/index.html is ${indexSize} bytes, the gate allows 1 MiB`);
  if (!existsSync(join(here, 'LICENSE'))) throw new Error('LICENSE is missing');
  const shots = join(here, 'screenshots');
  if (!existsSync(shots)) throw new Error('screenshots/ is missing');
  const names = readdirSync(shots).filter((n) => !n.startsWith('.')).sort();
  if (names.length < 3 || names.length > 4) throw new Error(`screenshots/ holds ${names.length} images, the gate wants 3 or 4`);
  for (const name of names) {
    const size = statSync(join(shots, name)).size;
    if (size > 256 * 1024) throw new Error(`screenshots/${name} is ${size} bytes, the gate allows 256 KiB`);
  }
}

preflight();
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse, so they are
// checked again here before the dossier is written.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
console.log('wrote', out);

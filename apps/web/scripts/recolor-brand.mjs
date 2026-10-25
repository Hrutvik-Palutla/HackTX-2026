// Recolour the SideQuest brand art to the minimal palette without redrawing it: same shapes, ink + one gold dot,
// transparent background. Each pixel is unmixed from the white ground against its nearest source colour, so
// anti-aliased edges keep their coverage. Run: node apps/web/scripts/recolor-brand.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// sharp ships with Next.js; resolve it through Next rather than adding a dependency.
const fromNext = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
const sharp = fromNext('sharp');
const brand = (name) => fileURLToPath(new URL(`../public/brand/${name}`, import.meta.url));

const INK = [23, 23, 26]; // near-black, matches the illustrations' ink
const GOLD = [163, 131, 79]; // antique gold for the single accent dot
const SOURCES = [
  { from: [92, 86, 250], to: INK }, // purple route "S"
  { from: [255, 165, 96], to: GOLD }, // orange dot
  { from: [35, 40, 82], to: INK }, // navy wordmark text
];

async function recolor(input, output) {
  const { data, info } = await sharp(brand(input)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const ink = [255 - data[i], 255 - data[i + 1], 255 - data[i + 2]];
    const strength = Math.max(...ink);
    if (strength < 6) continue; // paper: leave fully transparent
    // Nearest source colour by direction of its difference from white, then its coverage along that direction.
    let best = SOURCES[0], bestScore = -Infinity, coverage = 0;
    for (const s of SOURCES) {
      const d = s.from.map((v) => 255 - v);
      const dd = d.reduce((a, v) => a + v * v, 0);
      const t = ink.reduce((a, v, k) => a + v * d[k], 0) / dd;
      const err = ink.reduce((a, v, k) => a + (v - t * d[k]) ** 2, 0);
      if (-err > bestScore) { bestScore = -err; best = s; coverage = t; }
    }
    const alpha = Math.max(0, Math.min(1, coverage));
    out[i] = best.to[0]; out[i + 1] = best.to[1]; out[i + 2] = best.to[2];
    out[i + 3] = Math.round(alpha * 255);
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(brand(output));
  console.log(`${output} ${info.width}x${info.height}`);
}

await recolor('sidequest-mark-color.png', 'sidequest-mark-ink.png');
await recolor('sidequest-wordmark-color.png', 'sidequest-wordmark-ink.png');

// Three friends canoeing on a river: a wooden canoe diorama on a plinth.
// node apps/web/illustrations/canoe/build.mjs        writes public/illustrations/canoe.svg and preview.html
// node apps/web/illustrations/canoe/build.mjs --audit  also proves the canoe group's geometry
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import {
  WIDTH,
  HEIGHT,
  P,
  at,
  local,
  PLINTH,
  PLINTH_Z,
  PLINTH_H,
  FOOT_H,
  GROUND,
  GROUND_Z,
  WATER,
  hullPoint,
  hullOutward,
  gunwalePoint,
  uOf,
  B0,
  C0,
  E_A,
  BOW_SEAT,
  MID_SEAT,
  STERN_SEAT,
} from "./geometry.mjs";
import { surfaceOf, surfaceSvg, polyD } from "./surface.mjs";
import { figure, MOTION_CSS } from "../kit/figure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../public/illustrations/canoe.svg");

const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

// ---------- polygon helpers ----------
const area2 = (ring) => ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0);
function clipConvex(subject, clip) {
  const ccw = area2(clip) > 0;
  let out = subject;
  for (let i = 0; i < clip.length; i++) {
    const [ax, ay] = clip[i];
    const [bx, by] = clip[(i + 1) % clip.length];
    const side = ([x, y]) => ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * (ccw ? 1 : -1);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

// ---------- base ----------
function plinth() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLINTH, PLINTH_Z - FOOT_H, PLINTH_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLINTH, 20))) {
    out.push(S(k.cylinder(x, y, 7, PLINTH_Z - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, PLINTH_Z - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLINTH, PLINTH_Z, PLINTH_H, P, 8, 1.2), { tone: "mid", inner: L(k.sideSeam(PLINTH, PLINTH_Z + 2.4, P, 8), { tone: "faint" }) }));
  return out.join("");
}

const GROUND_RING = k.roundedPlan(GROUND, 4);
const farEdge = (a) => -44 + 3.5 * Math.sin(a / 21 + 0.6) + 2 * Math.sin(a / 8.5 + 2.1);
const nearEdge = (a) => 50 + 3 * Math.sin(a / 19 + 1.7) + 1.8 * Math.sin(a / 7 + 0.3);
function bankRing(edge, side) {
  const pts = [];
  for (let a = -170; a <= 170; a += 2) pts.push(local(a, edge(a), 0).slice(0, 2));
  pts.push(local(170, side * 320, 0).slice(0, 2), local(-170, side * 320, 0).slice(0, 2));
  return clipConvex(pts, GROUND_RING);
}
const BANKS = [
  { ring: bankRing(farEdge, -1), z: 0, h: 3.2 },
  { ring: bankRing((a) => farEdge(a) - 11 + 3 * Math.sin(a / 15 + 1), -1), z: 3.2, h: 3.2 },
  { ring: bankRing((a) => farEdge(a) - 25 + 4 * Math.sin(a / 18 + 2.5), -1), z: 6.4, h: 3.2 },
  { ring: bankRing(nearEdge, 1), z: 0, h: 2.6 },
  { ring: bankRing((a) => nearEdge(a) + 12 + 3 * Math.sin(a / 13), 1), z: 2.6, h: 2.6 },
];

function ground() {
  const out = [];
  const slab = k.slabOf(GROUND, GROUND_Z, WATER - GROUND_Z, P, 4, 0.6);
  out.push(S(slab, { tone: "mid", inner: L(k.sideSeam(GROUND, GROUND_Z + 2.6, P, 4), { tone: "faint" }) }));
  return out.join("");
}

function banks(which) {
  return BANKS.filter((_, i) => (which === "far" ? i < 3 : i >= 3))
    .map((bank) => S(k.extrude(bank.ring, bank.z, bank.h, P, { convex: false }), { tone: "mid" }))
    .join("");
}

// ---------- hull ----------
const N = 140;
const M = 44;
const inner = surfaceOf(hullPoint, { N, M, P, outward: hullOutward, flip: true });
const outer = surfaceOf(hullPoint, { N, M, P, outward: hullOutward, keep: (p) => (p[2] - WATER) * 2 });
const SAMPLES = 160;
const nearGunwale = Array.from({ length: SAMPLES + 1 }, (_, i) => gunwalePoint(i / SAMPLES, 1));
const farGunwale = Array.from({ length: SAMPLES + 1 }, (_, i) => gunwalePoint(i / SAMPLES, -1));
const OPENING = polyD([...nearGunwale, ...[...farGunwale].reverse()].map(at));

function hullInterior() {
  const ribs = [];
  for (let a = -66; a <= 66; a += 4.5) {
    for (const run of inner.curve("u", uOf(a), { samples: 60 })) ribs.push(path3(run));
  }
  const body = surfaceSvg(inner, { edge: false, inner: L(ribs.join(""), { tone: "faint" }) });
  return `<clipPath id="cn-open"><path d="${OPENING}"/></clipPath><g clip-path="url(#cn-open)">${body}</g>` + L(path3(farGunwale), { tone: "hi" });
}

function hullNear() {
  const planks = [];
  for (let w = 0.56; w < 0.995; w += 0.055) {
    for (const run of outer.curve("w", w, { samples: 240 })) planks.push(path3(run));
  }
  return surfaceSvg(outer, { tone: "hi", inner: L(planks.join(""), { tone: "faint" }) });
}


// ---------- the three paddlers ----------
// Bow and stern paddle on the near side, the middle paddler on the far side: everyone mid-stroke.
const U = 0.46;
const CREW = [
  { a: BOW_SEAT, side: 1, reach: 10 },
  { a: MID_SEAT, side: -1, reach: 6 },
  { a: STERN_SEAT, side: 1, reach: 2 },
];
const paddleOf = ({ a, side, reach }) => {
  const grip = local(a + reach - 4, C0 + side * 5, 30);
  const tip = local(a + reach + 10, C0 + side * (B0 + 10), -8);
  const bladeFrom = G.lerp3(grip, tip, 0.66);
  const lower = G.lerp3(grip, tip, 0.42);
  return { grip, tip, bladeFrom, lower };
};
function paddleSvg(crew) {
  const { grip, tip, bladeFrom } = paddleOf(crew);
  const dir = G.unit3(G.sub3(tip, grip));
  const across = G.mul3(G.unit3(G.cross3(dir, G.cross3(E_A, dir))), 2.6);
  const blade = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.08)) * (t > 0.85 ? 1 - (t - 0.85) * 2.4 : 1);
    blade.push(G.add3(G.lerp3(bladeFrom, tip, t), G.mul3(across, Math.max(0.35, w))));
  }
  const back = blade.map((p, i) => G.sub3(G.mul3(G.lerp3(bladeFrom, tip, i / 12), 2), p)).reverse();
  const ring = [...blade, ...back];
  const d = path3(ring, true);
  const shaft = L(path3([G.add3(grip, G.mul3(dir, -1.5)), bladeFrom]), { tone: "hi" });
  return shaft + `<path class="iso-fill" d="${d}"/><path class="iso-shade" data-shade="1" d="${d}"/>` + L(d, { tone: "hi" }) + L(path3([bladeFrom, G.lerp3(bladeFrom, tip, 0.85)]), { tone: "faint" });
}
function ripples(crew) {
  const { tip } = paddleOf(crew);
  const [cx, cy] = [tip[0], tip[1]];
  return [0, 1.6].map((delay) => k.lineSvg(k.ring(cx, cy, 7, WATER, P, 40), { tone: "lo", className: "sq-ripple" }).replace("<path ", `<path style="animation-delay:${delay}s" `)).join("");
}
function paddler(crew, index) {
  const { grip, lower } = paddleOf(crew);
  const hands = crew.side > 0 ? [lower, grip] : [grip, lower];
  const parts = figure(P, { id: `paddler${index}`, hip: local(crew.a, C0, WATER - 1), facing: E_A, u: U, hands, lean: 0.18, legs: "none", hair: index === 1 ? "bun" : "none" });
  return parts.sort((x, y) => k.depthOf(x.at, P) - k.depthOf(y.at, P)).map((part) => part.svg).join("");
}
const wake = (c, from, to) => L(path3([local(from, c, WATER), local(to, c, WATER)]), { tone: "faint", flow: true });

// ---------- assemble ----------
const far = CREW.filter((c) => c.side < 0);
const near = CREW.filter((c) => c.side > 0);
const body = [
  MOTION_CSS,
  plinth(),
  ground(),
  banks("far"),
  wake(-25, -20, -95),
  wake(-31, 50, -10),
  ...far.map(ripples),
  hullInterior(),
  ...far.map(paddleSvg),
  ...CREW.map(paddler),
  hullNear(),
  wake(24, -60, -120),
  wake(30, 30, -30),
  ...near.map(ripples),
  ...near.map(paddleSvg),
  banks("near"),
];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "Three friends paddling a wooden canoe down a river, mid-stroke, on a wooden base with layered banks.",
  body,
  standalone: "light",
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
const preview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Canoe preview</title><style>html,body{margin:0;background:#fbfbfa}main{max-width:960px;margin:40px auto;padding:0 16px}main svg{display:block;width:100%;height:auto}</style></head><body><main>${svg}</main></body></html>`;
writeFileSync(join(HERE, "preview.html"), preview);
console.log("wrote", OUT, `${(svg.length / 1024).toFixed(0)} KB`);

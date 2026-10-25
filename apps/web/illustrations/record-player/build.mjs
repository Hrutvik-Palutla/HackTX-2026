// A record player for a music night: a turntable on a wooden plinth with four feet, the record playing under an
// S-shaped tonearm, the dust cover propped open behind on two hinges, and a short fanned stack of LP sleeves beside it.
// Static and decorative. `node build.mjs` writes ../../public/illustrations/record-player.svg and preview.html;
// `node build.mjs --audit` also proves the geometry with the kit's audit.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as A from "../kit/audit.mjs";
import { tubePieces, tubeSvg } from "../kit/tube.mjs";
import { MOTION_CSS } from "../kit/figure.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../public/illustrations/record-player.svg");
const W = 480;
const H = 360;
const DEG = Math.PI / 180;
const UP = [0, 0, 1];

// ---------------------------------------------------------------- world (1 unit ≈ 2.5 mm; x = front, y = right, z = up)
const FLOOR = -7;
const PLINTH = { x: -72, y: -95, w: 144, d: 190, r: 3 };
const PLINTH_TOP = 22;
const DECK = { x: -67, y: -90, w: 134, d: 180, r: 2 };
const DECK_TOP = PLINTH_TOP + 1.2;

const SPIN = [0, -20];
const SUB_R = 54;
const PLATTER_R = 64;
const PLATTER_Z = DECK_TOP + 2;
const PLATTER_TOP = PLATTER_Z + 7;
const MAT_R = 61.5;
const MAT_TOP = PLATTER_TOP + 0.8;
const RECORD_R = 60.5;
const RECORD_TOP = MAT_TOP + 0.8;
const LABEL_R = 17;

const PIVOT = [-36, 66];
const Z_ARM = 41;
const ARM_R = 1.5;
const EFFECTIVE = 95;
const STYLUS_AT = 50;

const HINGE = { x: -75, z: PLINTH_TOP, r: 3 };
const LID_OPEN = 99 * DEG;
const LID_H = 26;
const LID_T = 1.2;
const LID_FROM = 4;
const LID_TO = 148;

// ---------------------------------------------------------------- tonearm geometry from the real alignment
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (a) => Math.hypot(a[0], a[1]);
const unit2 = (a) => [a[0] / len2(a), a[1] / len2(a)];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const STYLUS = (() => {
  const d = len2(sub2(SPIN, PIVOT));
  const e = unit2(sub2(SPIN, PIVOT));
  const a = (EFFECTIVE ** 2 - STYLUS_AT ** 2 + d * d) / (2 * d);
  const h = Math.sqrt(EFFECTIVE ** 2 - a * a);
  const n = [e[1], -e[0]];
  const front = n[0] > 0 ? n : [-n[0], -n[1]];
  return [PIVOT[0] + a * e[0] + h * front[0], PIVOT[1] + a * e[1] + h * front[1]];
})();
const ALONG = unit2(sub2(STYLUS, PIVOT));
const ACROSS = (() => {
  const p = [-ALONG[1], ALONG[0]];
  return dot2(sub2(SPIN, PIVOT), p) < 0 ? p : [-p[0], -p[1]];
})();
const armAt = (a, p, z = Z_ARM) => [PIVOT[0] + ALONG[0] * a + ACROSS[0] * p, PIVOT[1] + ALONG[1] * a + ACROSS[1] * p, z];
const SHELL = (() => {
  const radial = unit2(sub2(STYLUS, SPIN));
  const t = [radial[1], -radial[0]];
  return dot2(t, ALONG) > 0 ? t : [-t[0], -t[1]];
})();
const SHELL_LEN = 14.5;
const SHELL3 = [SHELL[0], SHELL[1], 0];
const SHELL_SIDE = G.cross3(UP, SHELL3);
const SHELL_OUT = dot2([SHELL_SIDE[0], SHELL_SIDE[1]], ACROSS) > 0 ? 1 : -1;
const P3 = [STYLUS[0] - SHELL[0] * SHELL_LEN, STYLUS[1] - SHELL[1] * SHELL_LEN, Z_ARM];

// ---------------------------------------------------------------- lid frame (rotates about the hinge line)
const LID = G.frameOf([HINGE.x, 0, HINGE.z], [-Math.sin(LID_OPEN), 0, Math.cos(LID_OPEN)], [Math.cos(LID_OPEN), 0, Math.sin(LID_OPEN)], [0, 1, 0]);
const lidPoint = (dx, y, dz) => G.add3(G.add3(LID.o, G.mul3(LID.u, dx)), G.add3(G.mul3(LID.v, y), G.mul3(LID.a, dz)));

// ---------------------------------------------------------------- sleeves on the floor beside it
const SLEEVE = 124;
const SLEEVE_T = 1.3;
const SLEEVES = [
  { c: [12, -168], turn: 4 },
  { c: [16, -170], turn: -5 },
  { c: [10, -166], turn: 9 },
  { c: [15, -171], turn: -1 },
];

const rotRing = (c, w, d, turn, r = 0.8, steps = 3) => {
  const cs = Math.cos(turn * DEG);
  const sn = Math.sin(turn * DEG);
  return k.ringOf({ x: -w / 2, y: -d / 2, w, d, r }, steps).map(([x, y]) => [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
};
const local2 = (c, turn, x, y) => [c[0] + x * Math.cos(turn * DEG) - y * Math.sin(turn * DEG), c[1] + x * Math.sin(turn * DEG) + y * Math.cos(turn * DEG)];

// ---------------------------------------------------------------- camera
const fit = [
  ...k.boxCorners(PLINTH, FLOOR, PLINTH_TOP),
  ...[LID_FROM, LID_TO].flatMap((dx) => [-95, 95].flatMap((y) => [0, LID_H].map((dz) => lidPoint(dx, y, dz)))),
  ...SLEEVES.flatMap((s) => rotRing(s.c, SLEEVE, SLEEVE, s.turn).map(([x, y]) => [x, y, FLOOR])),
  [PIVOT[0], PIVOT[1], Z_ARM + 6],
];
const P = k.fitProjection(fit, W, H, { pad: 24, azimuth: 45 });
const V = G.viewOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const FADE = [0.04, 0.42];
const vertical = (cx, cy) => G.frameOf([cx, cy, 0], UP, [1, 0, 0], [0, 1, 0]);

// ---------------------------------------------------------------- recorder: every drawn item records its true shape
const R = A.recorder(P);
const put = (name, ref, svg, shapes, bias = 0) => R.put({ name: R.nameFor(name), at: ref, bias, svg, shapes: shapes.map((shape) => R.solid({ name: R.nameFor(name), ...shape })) });
R.solid(A.box([-400, -400, FLOOR - 10], [400, 400, FLOOR], { name: "stand.floor" }));
const halos = [];

function cyl(name, cx, cy, r, z, h, style = {}, { extra = "", inner = "", steps = 48, bevel = 0, owner, bias = 0 } = {}) {
  put(name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [A.cylinder(cx, cy, r, z, h, { owner })], bias);
}
function slab(name, plan, z, h, style = {}, { extra = "", inner = "", steps = 3, bevel = 0.5, owner, bias = 0 } = {}) {
  put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [A.slab(plan, z, h, { owner }, steps)], bias);
}
function prism(name, F, polygon, s0, s1, style = {}, { extra = "", inner = "", owner, bias = 0 } = {}) {
  const cx = polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length;
  const cy = polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length;
  const centre = G.add3(G.add3(F.o, G.mul3(F.u, cx)), G.add3(G.mul3(F.v, cy), G.mul3(F.a, (s0 + s1) / 2)));
  put(name, centre, S(G.prismOf(F, polygon, s0, s1, P), { tone: "mid", ...style, inner }) + extra, [A.prism(F, polygon, s0, s1, { owner })], bias);
}
function turned(name, F, profile, style = {}, { extra = "", inner = "", owner, bias = 0, bevel = 0 } = {}) {
  const smooth = profile.some((point) => point[2]);
  const paths = G.solidOf(profile, F, P, { bevel, smooth: smooth ? { rows: 3 } : false });
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  put(name, G.add3(F.o, G.mul3(F.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [A.solid(F, profile, { owner, curve: smooth ? profile : undefined })], bias);
}
function tube(name, route, r, { tone = "hi", maxLength = 16, ends = [true, true], gaps = [], bias = 0, rings } = {}) {
  const id = R.nameFor(name);
  R.route(id, route, r, { gaps, ends });
  tubePieces(route, r, P, { maxLength, gaps, rings }).forEach((piece, index) =>
    R.put({ name: `${id}:${index}`, at: piece.mid, bias, svg: tubeSvg(piece, { tone }), route: id, chunk: index, shapes: [A.tube(piece.points, piece.radii)] }),
  );
}

// ---------------------------------------------------------------- base: feet, wooden plinth, deck plate
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
halos.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(PLINTH, -2), FLOOR, 6, P)}"/>`);
for (const [x, y] of byDepth(k.corners(PLINTH, 17))) {
  cyl("stand.foot-pad", x, y, 9.4, FLOOR, 1.4, { tone: "lo" }, { steps: 40 });
  cyl("stand.foot", x, y, 8, FLOOR + 1.4, -FLOOR - 1.4, { tone: "mid" }, { steps: 40, inner: Ln(k.sideArc(x, y, 8, FLOOR + 3.4, P, 32) + k.sideArc(x, y, 8, FLOOR + 4.4, P, 32), { tone: "faint" }) });
}

// Wood grain: long, gently wavy lines that wrap the two visible sides and end on the silhouette edges.
function grain(plan, steps, z0, amp, wave, phase) {
  const ring = k.ringOf(plan, steps);
  const n = ring.length;
  const [vx, vy] = k.towardViewer(P);
  const area = ring.reduce((sum, [x, y], i) => sum + x * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * y, 0);
  const facing = ring.map(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % n];
    const [nx, ny] = area > 0 ? [by - ay, -(bx - ax)] : [-(by - ay), bx - ax];
    return nx * vx + ny * vy > 1e-9;
  });
  let start = facing.findIndex((f, i) => f && !facing[(i + n - 1) % n]);
  const points = [];
  let walked = 0;
  for (let i = start; facing[i % n]; i++) {
    const a = ring[i % n];
    const b = ring[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / 2));
    for (let j = 0; j <= count; j++) {
      if (j === 0 && points.length) continue;
      const t = j / count;
      const s = walked + length * t;
      const z = z0 + amp * Math.sin((s / wave) * 2 * Math.PI + phase) + amp * 0.45 * Math.sin((s / (wave * 0.41)) * 2 * Math.PI + phase * 1.7);
      points.push(at([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z]));
    }
    walked += length;
  }
  return k.pathOf(points);
}
const GRAIN = [
  [4.2, 0.9, 120, 0.4],
  [8.6, 1.1, 150, 2.1],
  [12.4, 0.8, 96, 4.0],
  [16.2, 1.0, 132, 1.2],
  [19.4, 0.5, 88, 3.1],
]
  .map(([z0, amp, wave, phase]) => grain(PLINTH, 6, z0, amp, wave, phase))
  .join("");
const PLINTH_TOP_RIM = k.planOutline(k.insetPlan(PLINTH, 2.2), PLINTH_TOP, P, 6);
slab("stand.plinth", PLINTH, 0, PLINTH_TOP, { tone: "lo", crease: "faint" }, { steps: 6, bevel: 1.2, inner: Ln(GRAIN, { tone: "faint" }), extra: Ln(PLINTH_TOP_RIM, { tone: "faint" }) });

const DECK_SCREWS = k.corners(DECK, 4.2);
slab(
  "deck",
  DECK,
  PLINTH_TOP,
  DECK_TOP - PLINTH_TOP,
  { tone: "mid" },
  {
    steps: 4,
    bevel: 0.7,
    extra:
      Ln(DECK_SCREWS.map(([x, y]) => k.ring(x, y, 1.5, DECK_TOP, P, 16)).join(""), { tone: "lo" }) +
      Dots(DECK_SCREWS.map(([x, y]) => at([x, y, DECK_TOP])), { size: 0.45 }),
  },
);

// ---------------------------------------------------------------- controls on the deck
// Speed selector: a knurled knob on a collar, its pointer at 33, index dots for 33 and 45.
const KNOB = [55, -76];
const SPEED_PLATE = { x: KNOB[0] - 8.5, y: KNOB[1] - 8.5, w: 17, d: 17, r: 8.5 };
slab("speed-plate", SPEED_PLATE, DECK_TOP, 0.6, { tone: "lo" }, { steps: 10, bevel: 0, extra: Dots([-38, 38].map((deg) => at([KNOB[0] - Math.cos(deg * DEG) * 7.2, KNOB[1] + Math.sin(deg * DEG) * 7.2, DECK_TOP + 0.6])), { size: 0.55, tone: "hi" }) });
cyl("speed-collar", KNOB[0], KNOB[1], 5.6, DECK_TOP + 0.6, 1.2, { tone: "mid" }, { steps: 40 });
cyl("speed-knob", KNOB[0], KNOB[1], 4.6, DECK_TOP + 1.8, 4.4, { tone: "hi", crease: "lo" }, {
  steps: 40,
  bevel: 0.4,
  inner: Ln(k.knurl(KNOB[0], KNOB[1], 4.6, DECK_TOP + 1.8, DECK_TOP + 6.2, 30, P, 0.5), { tone: "lo" }),
  extra: Ln(k.lineOnTop([KNOB[0] - Math.cos(38 * DEG) * 1.2, KNOB[1] - Math.sin(38 * DEG) * 1.2], [KNOB[0] - Math.cos(38 * DEG) * 4.6, KNOB[1] - Math.sin(38 * DEG) * 4.6], DECK_TOP + 6.2, P), { tone: "hi" }) + Ln(k.ring(KNOB[0], KNOB[1], 1.2, DECK_TOP + 6.2, P, 16), { tone: "lo" }),
});

// Start/stop: a square push button in a bezel at the front-left corner.
const START = { x: 31, y: -88, w: 11, d: 8, r: 1.2 };
slab("start-bezel", START, DECK_TOP, 0.8, { tone: "lo" }, { steps: 3, bevel: 0 });
slab("start-button", k.insetPlan(START, 1.2), DECK_TOP + 0.8, 1.8, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Ln(k.planOutline(k.insetPlan(START, 2.6), DECK_TOP + 2.6, P, 3), { tone: "faint" }) });

// 45 adapter in its well at the back-left corner.
const ADAPTER = [-54, -79];
cyl("adapter-well", ADAPTER[0], ADAPTER[1], 6.6, DECK_TOP, 0.5, { tone: "lo" }, { steps: 40 });
cyl("adapter", ADAPTER[0], ADAPTER[1], 5.4, DECK_TOP + 0.5, 1.6, { tone: "mid" }, { steps: 40, bevel: 0.4, extra: Ln(k.ring(ADAPTER[0], ADAPTER[1], 1.6, DECK_TOP + 2.1, P, 20), { tone: "lo" }) + Ln(k.ring(ADAPTER[0], ADAPTER[1], 3.6, DECK_TOP + 2.1, P, 28), { tone: "faint" }) });

// Pitch fader: a plate with a closed slot, a ruler rooted on its baseline, and the slider at zero.
const PITCH = { x: 24, y: 76, w: 40, d: 11, r: 1.4 };
const SLOT = { x: 28, y: 79.4, w: 32, d: 2, r: 1 };
const RULE_Y = 83.2;
const PITCH_TICKS = k.topTicks(29, 59, 2, 5, RULE_Y, DECK_TOP + 0.8, [1.3, 2.4], P);
slab("pitch-plate", PITCH, DECK_TOP, 0.8, { tone: "mid" }, {
  steps: 3,
  bevel: 0.4,
  extra:
    Ln(k.planOutline(SLOT, DECK_TOP + 0.8, P, 4), { tone: "lo" }) +
    Ln(k.lineOnTop([29, RULE_Y], [59, RULE_Y], DECK_TOP + 0.8, P), { tone: "faint" }) +
    Ln(PITCH_TICKS.minor, { tone: "lo" }) +
    Ln(PITCH_TICKS.major, { tone: "mid" }) +
    Dots([at([PITCH.x + 2, PITCH.y + PITCH.d / 2, DECK_TOP + 0.8]), at([PITCH.x + PITCH.w - 2, PITCH.y + PITCH.d / 2, DECK_TOP + 0.8])], { size: 0.45 }),
});
const FADER = { x: 41.6, y: 77.8, w: 6.8, d: 5.4, r: 1 };
slab("pitch-fader", FADER, DECK_TOP + 0.8, 3, { tone: "hi", crease: "lo" }, { steps: 3, bevel: 0.4, extra: Ln(k.lineOnTop([45, FADER.y], [45, FADER.y + FADER.d], DECK_TOP + 3.8, P), { tone: "hi" }) });

// ---------------------------------------------------------------- platter, mat and the record
const [SX, SY] = SPIN;
const SPINF = vertical(SX, SY);
halos.push(`<path class="iso-halo" style="opacity:.18" d="${k.haloOf({ x: SX - PLATTER_R, y: SY - PLATTER_R, w: PLATTER_R * 2, d: PLATTER_R * 2, r: PLATTER_R }, DECK_TOP, 0.1, P)}"/>`);
cyl("sub-platter", SX, SY, SUB_R, DECK_TOP, PLATTER_Z - DECK_TOP, { tone: "lo" }, { steps: 120 });
const STROBE = [0, 1, 2, 3].map((row) => Dots(G.dotsOf(SPINF, PLATTER_Z + 1.5 + row * 1.45, PLATTER_R, 88 + row * 6, P, { fade: FADE, phase: row * 0.02 }), { size: 0.36, tone: row % 2 ? "mid" : "hi" })).join("");
cyl("platter", SX, SY, PLATTER_R, PLATTER_Z, PLATTER_TOP - PLATTER_Z, { tone: "hi", crease: "lo" }, {
  steps: 144,
  bevel: 0.6,
  inner: Ln(k.sideArc(SX, SY, PLATTER_R, PLATTER_Z + 0.8, P, 72), { tone: "faint" }),
  extra: STROBE + Ln(k.ring(SX, SY, 62.9, PLATTER_TOP, P, 144), { tone: "faint" }),
});
cyl("mat", SX, SY, MAT_R, PLATTER_TOP, MAT_TOP - PLATTER_TOP, { tone: "lo" }, { steps: 144 });

// The record: vinyl annulus, a soft bow-tie sheen across the grooves, tracks with blank bands, a two-tone label.
const ellipse = (r, z, steps = 144) => k.ring(SX, SY, r, z, P, steps);
const TRACKS = [24.5, 32, 39, 46.5, 53];
const grooves = [];
for (let r = 19.4; r <= 59.6; r += 1.15) if (!TRACKS.some((t) => Math.abs(r - t) < 0.9)) grooves.push(ellipse(r, RECORD_TOP));
const sector = (r0, r1, mid, half, z) => {
  const points = [];
  for (let i = 0; i <= 16; i++) points.push(at([SX + r1 * Math.cos(mid - half + (2 * half * i) / 16), SY + r1 * Math.sin(mid - half + (2 * half * i) / 16), z]));
  for (let i = 16; i >= 0; i--) points.push(at([SX + r0 * Math.cos(mid - half + (2 * half * i) / 16), SY + r0 * Math.sin(mid - half + (2 * half * i) / 16), z]));
  return k.pathOf(points, true);
};
const SHEEN_AT = Math.atan2(G.lightOf(P)[1] + V[1], G.lightOf(P)[0] + V[0]);
const sheen = [7, 12, 18, 25]
  .map((half, i) => `<path class="iso-top" style="opacity:${[0.55, 0.4, 0.28, 0.18][i]}" d="${sector(LABEL_R + 1.5, RECORD_R - 1.2, SHEEN_AT, half * DEG, RECORD_TOP) + sector(LABEL_R + 1.5, RECORD_R - 1.2, SHEEN_AT + Math.PI, half * DEG, RECORD_TOP)}"/>`)
  .join("");
const vinyl = `<path class="iso-shade" data-shade="0" fill-rule="evenodd" d="${ellipse(RECORD_R - 0.3, RECORD_TOP) + ellipse(LABEL_R, RECORD_TOP)}"/>`;
const LABEL_CUT = 6;
const labelHalf = (() => {
  const points = [];
  const a0 = Math.acos(LABEL_CUT / LABEL_R);
  for (let i = 0; i <= 40; i++) {
    const a = -a0 + (2 * a0 * i) / 40;
    points.push(at([SX + LABEL_R * 0.94 * Math.cos(a + SHEEN_AT), SY + LABEL_R * 0.94 * Math.sin(a + SHEEN_AT), RECORD_TOP]));
  }
  return k.pathOf(points, true);
})();
const cutEnds = [-1, 1].map((side) => {
  const a = Math.acos(LABEL_CUT / (LABEL_R * 0.94)) * side + SHEEN_AT;
  return [SX + LABEL_R * 0.94 * Math.cos(a), SY + LABEL_R * 0.94 * Math.sin(a)];
});
const record =
  vinyl +
  sheen +
  Ln(grooves.join(""), { tone: "faint" }) +
  Ln(TRACKS.map((r) => ellipse(r, RECORD_TOP)).join(""), { tone: "lo" }) +
  Ln(ellipse(59.9, RECORD_TOP), { tone: "lo" }) +
  `<path class="iso-top" d="${ellipse(LABEL_R, RECORD_TOP, 96)}"/>` +
  `<path class="iso-shade" data-shade="1" d="${labelHalf}"/>` +
  Ln(ellipse(LABEL_R, RECORD_TOP, 96), { tone: "mid" }) +
  Ln(ellipse(LABEL_R * 0.94, RECORD_TOP, 96), { tone: "faint" }) +
  Ln(k.lineOnTop(cutEnds[0], cutEnds[1], RECORD_TOP, P), { tone: "lo" }) +
  Ln(ellipse(9, RECORD_TOP, 64), { tone: "faint" }) +
  Ln(ellipse(2.4, RECORD_TOP, 32), { tone: "lo" });
put("record", [SX, SY, RECORD_TOP - 0.4], S(k.cylinder(SX, SY, RECORD_R, MAT_TOP, RECORD_TOP - MAT_TOP, P, 160), { tone: "hi", crease: "lo", lit: true }) + record, [A.cylinder(SX, SY, RECORD_R, MAT_TOP, RECORD_TOP - MAT_TOP)]);
turned("spindle", SPINF, [[RECORD_TOP, 1.4], [RECORD_TOP + 4.6, 1.4], [RECORD_TOP + 5.2, 1.3, 1], [RECORD_TOP + 5.8, 1.0, 1], [RECORD_TOP + 6.2, 0.55, 1], [RECORD_TOP + 6.35, 0]], { tone: "hi" });

// ---------------------------------------------------------------- tonearm: base, height ring, pillar, gimbal
const [PX, PY] = PIVOT;
const PIVOTF = vertical(PX, PY);
const BASE_Z = DECK_TOP;
cyl("arm-base", PX, PY, 15, BASE_Z, 1.4, { tone: "mid" }, {
  steps: 72,
  bevel: 0.5,
  extra: Dots([30, 150, 270].map((deg) => at([PX + 12.6 * Math.cos(deg * DEG), PY + 12.6 * Math.sin(deg * DEG), BASE_Z + 1.4])), { size: 0.45 }),
});
const RING_Z = BASE_Z + 1.4;
const RING_TOP = RING_Z + 5;
const HEIGHT_TICKS = k.radialTicks(PX, PY, 11.6, 48, 4, RING_TOP, [1.1, 2], P);
cyl("arm-height-ring", PX, PY, 11.6, RING_Z, 5, { tone: "mid" }, {
  steps: 72,
  bevel: 0.4,
  inner: Ln(k.knurl(PX, PY, 11.6, RING_Z, RING_Z + 2.6, 60, P, 0.4), { tone: "faint" }) + Ln(k.sideArc(PX, PY, 11.6, RING_Z + 2.6, P, 48), { tone: "faint" }),
  extra: Ln(HEIGHT_TICKS.minor, { tone: "lo" }) + Ln(HEIGHT_TICKS.major, { tone: "mid" }),
});
const LOCK_DIR = [Math.cos(25 * DEG), Math.sin(25 * DEG)];
turned("arm-height-lock", G.frameAlong([PX + LOCK_DIR[0] * 11.6, PY + LOCK_DIR[1] * 11.6, RING_Z + 2.4], [LOCK_DIR[0], LOCK_DIR[1], 0]), [[-0.4, 1.1], [1.6, 1.1], [1.6, 1.8], [3.6, 1.8]], { tone: "mid" }, { inner: "" });
const PILLAR_TOP = Z_ARM - 5.2;
cyl("arm-pillar", PX, PY, 7.2, RING_TOP, PILLAR_TOP - RING_TOP, { tone: "mid", crease: "none" }, { steps: 56, inner: Ln(k.sideArc(PX, PY, 7.2, RING_TOP + 2.2, P, 40), { tone: "faint" }) });
const GIMBAL_R = 6.2;
cyl("arm-gimbal", PX, PY, GIMBAL_R, PILLAR_TOP, 9.4, { tone: "hi", crease: "lo" }, { steps: 56, bevel: 0.4, inner: Ln(k.sideArc(PX, PY, GIMBAL_R, PILLAR_TOP + 1.4, P, 40), { tone: "faint" }) });
cyl("arm-gimbal-cap", PX, PY, 4.4, PILLAR_TOP + 9.4, 1.2, { tone: "hi", crease: "lo" }, { steps: 40, extra: Dots([at([PX, PY, PILLAR_TOP + 10.6])], { size: 0.5, tone: "hi" }) });

// ---------------------------------------------------------------- the arm tube, headshell, cartridge, finger lift
const TILT = 10 * DEG;
const U1 = [Math.cos(TILT), Math.sin(TILT)];
const start = Math.sqrt(GIMBAL_R ** 2 - ARM_R ** 2);
const P3L = [dot2(sub2(P3, PIVOT), ALONG), dot2(sub2(P3, PIVOT), ACROSS)];
const SHELLL = [dot2(SHELL, ALONG), dot2(SHELL, ACROSS)];
const ARM = G.fillet(
  [armAt(U1[0] * start, U1[1] * start), armAt(U1[0] * 40, U1[1] * 40), armAt(P3L[0] - SHELLL[0] * 13, P3L[1] - SHELLL[1] * 13), P3],
  26,
  14,
  { P, tube: ARM_R },
);
tube("arm-tube", ARM, ARM_R, { tone: "hi", maxLength: 14 });

const SH = G.frameOf(P3, UP, SHELL3, SHELL_SIDE);
turned("arm-collar", G.frameAlong(P3, SHELL3), [[0, 2.3], [3.2, 2.3]], { tone: "hi", crease: "lo" });
const SHELL_POLY = [[3.2, -2.6], [5, -3.2], [15.4, -3.2], [16.4, -2.4], [16.4, 2.4], [15.4, 3.2], [5, 3.2], [3.2, 2.6]];
prism("headshell", SH, SHELL_POLY, -1.7, -0.5, { tone: "hi", crease: "lo" }, {
  extra: Dots([[9.2, -1.8], [9.2, 1.8]].map(([u, v]) => at(G.add3(G.add3(P3, G.mul3(SHELL3, u)), G.add3(G.mul3(SHELL_SIDE, v), [0, 0, -0.5])))), { size: 0.42, tone: "hi" }),
});
const CART_BOTTOM = RECORD_TOP + 1.8;
prism("cartridge", SH, [[6.6, -1.9], [13.6, -1.9], [13.6, 1.9], [6.6, 1.9]], CART_BOTTOM - Z_ARM, -1.7, { tone: "mid" }, {
  inner: "",
});
tube("stylus", [G.add3(P3, [SHELL3[0] * 13.95, SHELL3[1] * 13.95, CART_BOTTOM - Z_ARM]), [STYLUS[0], STYLUS[1], RECORD_TOP]], 0.34, { tone: "hi", maxLength: 4 });
const LIFT0 = G.add3(G.add3(P3, G.mul3(SHELL3, 12.2)), G.add3(G.mul3(SHELL_SIDE, SHELL_OUT * 3.2), [0, 0, -1.1]));
const LIFT_TIP = G.add3(G.add3(LIFT0, G.mul3(SHELL_SIDE, SHELL_OUT * 5.4)), G.add3(G.mul3(SHELL3, 1.2), [0, 0, 2.6]));
const LIFT_BALL = 0.85;
const LIFT_DIR = G.unit3(G.sub3(LIFT_TIP, G.add3(LIFT0, G.mul3(SHELL_SIDE, SHELL_OUT * 2.6))));
tube("finger-lift", G.fillet([LIFT0, G.add3(LIFT0, G.mul3(SHELL_SIDE, SHELL_OUT * 2.6)), G.sub3(LIFT_TIP, G.mul3(LIFT_DIR, Math.sqrt(LIFT_BALL ** 2 - 0.45 ** 2)))], 2.2, 8, { P, tube: 0.45 }), 0.45, { tone: "hi", maxLength: 8 });
put("finger-lift-ball", LIFT_TIP, S(G.sphereOf(LIFT_TIP, LIFT_BALL, P), { tone: "hi" }), [A.ball(LIFT_TIP, LIFT_BALL)]);

// Rear stub and counterweight with a gauge ring.
const BACK = [-U1[0], -U1[1]];
const BACK3 = G.unit3([ALONG[0] * BACK[0] + ACROSS[0] * BACK[1], ALONG[1] * BACK[0] + ACROSS[1] * BACK[1], 0]);
const STUB_R = 2;
const stubStart = Math.sqrt(GIMBAL_R ** 2 - STUB_R ** 2);
const CW = G.frameAlong([PX, PY, Z_ARM], BACK3);
tube("arm-stub", [G.pointOf(CW, stubStart, 0, 0), G.pointOf(CW, 13, 0, 0)], STUB_R, { tone: "hi", maxLength: 10 });
const CW_TICKS = G.ribsOf(CW, 13.4, 15.6, 7.1, 40, P, { fade: [0.1, 0.55], seams: false });
turned("counterweight-dial", CW, [[13, 7.1], [16, 7.1]], { tone: "hi", crease: "lo" }, { extra: k.fadedSvg(CW_TICKS, { tone: "lo" }) });
turned("counterweight", CW, [[16, 6.6], [24.6, 6.6], [25.4, 6.1, 1], [25.8, 5.2, 1]], { tone: "hi", crease: "lo" }, { inner: Ln(G.arcOf(CW, 20.3, 6.6, P), { tone: "faint" }) });
turned("counterweight-cap", CW, [[25.8, 2.6], [27.4, 2.6], [27.8, 2.1]], { tone: "hi" });

// Anti-skating dial beside the base.
const SKATE = [-49, 47];
cyl("skate-dial", SKATE[0], SKATE[1], 3.6, DECK_TOP, 3.2, { tone: "mid" }, {
  steps: 36,
  inner: Ln(k.knurl(SKATE[0], SKATE[1], 3.6, DECK_TOP, DECK_TOP + 3.2, 22, P, 0.5), { tone: "lo" }),
  extra: Ln(k.lineOnTop([SKATE[0], SKATE[1]], [SKATE[0] + 3.6 * Math.cos(-60 * DEG), SKATE[1] + 3.6 * Math.sin(-60 * DEG)], DECK_TOP + 3.2, P), { tone: "hi" }),
});

// Arm rest: a post with a cradle and rubber pad; the arm is out playing, so it stands empty.
const REST = [PX + 57, PY + 6];
const REST_TOP = Z_ARM - 4.2;
cyl("rest-post", REST[0], REST[1], 1.4, DECK_TOP, REST_TOP - DECK_TOP, { tone: "mid", crease: "none" }, { steps: 20, inner: Ln(k.sideArc(REST[0], REST[1], 1.4, DECK_TOP + 3, P, 12), { tone: "faint" }) });
cyl("rest-foot", REST[0], REST[1], 2.8, DECK_TOP, 1, { tone: "mid" }, { steps: 28, bias: -0.2 });
const RESTF = G.frameOf([REST[0], REST[1], 0], UP, [1, 0, 0], [0, 1, 0]);
prism("rest-cradle", RESTF, [[-2.2, -3.6], [2.2, -3.6], [2.2, 3.6], [-2.2, 3.6]], REST_TOP, REST_TOP + 1.2, { tone: "mid" });
prism("rest-prong", RESTF, [[-2.2, -3.6], [2.2, -3.6], [2.2, -2.5], [-2.2, -2.5]], REST_TOP + 1.2, REST_TOP + 4.2, { tone: "mid" });
prism("rest-prong", RESTF, [[-2.2, 2.5], [2.2, 2.5], [2.2, 3.6], [-2.2, 3.6]], REST_TOP + 1.2, REST_TOP + 4.2, { tone: "mid" });
prism("rest-pad", RESTF, [[-2.2, -2.5], [2.2, -2.5], [2.2, 2.5], [-2.2, 2.5]], REST_TOP + 1.2, REST_TOP + 1.8, { tone: "lo" });

// Cue lift: a post beside the arm with its bar lowered under the tube, and the cue lever in its housing.
const CUE_ALONG = 24;
const cueP = CUE_ALONG * Math.tan(TILT);
const CUE_POST = armAt(CUE_ALONG, cueP + 7.4, 0);
const CUE_TOP = Z_ARM - 4.4;
cyl("cue-post", CUE_POST[0], CUE_POST[1], 1.4, DECK_TOP, CUE_TOP - DECK_TOP, { tone: "mid", crease: "none" }, { steps: 20 });
const CUEF = G.frameOf([PX, PY, 0], UP, [ALONG[0], ALONG[1], 0], [ACROSS[0], ACROSS[1], 0]);
prism("cue-bar", CUEF, [[CUE_ALONG - 1, cueP - 4.6], [CUE_ALONG + 1, cueP - 4.6], [CUE_ALONG + 1, cueP + 8.6], [CUE_ALONG - 1, cueP + 8.6]], CUE_TOP, CUE_TOP + 1.4, { tone: "mid" });
const CUE_HOUSING = { x: -18, y: 77, w: 10, d: 8, r: 1.4 };
slab("cue-housing", CUE_HOUSING, DECK_TOP, 3.6, { tone: "mid" }, { steps: 3, bevel: 0.5, extra: Ln(k.planOutline({ x: -16.5, y: 80.2, w: 7, d: 1.6, r: 0.8 }, DECK_TOP + 3.6, P, 3), { tone: "lo" }) });
slab("cue-lever", { x: -14.6, y: 80.3, w: 11, d: 1.4, r: 0.6 }, DECK_TOP + 3.6, 1.4, { tone: "hi", crease: "lo" }, { steps: 2, bevel: 0 });
cyl("cue-knob", -2.6, 81, 1.8, DECK_TOP + 3.6, 2.8, { tone: "hi", crease: "lo" }, { steps: 24 });

// ---------------------------------------------------------------- dust cover on two hinges, propped open behind
const HINGES = [-68, 68];
for (const y0 of HINGES) {
  const F = G.frameAlong([HINGE.x, y0, HINGE.z], [0, 1, 0]);
  turned("hinge-barrel", F, [[-7, HINGE.r], [7, HINGE.r]], { tone: "mid" }, { owner: `hinge${y0}`, extra: Dots([at([HINGE.x + HINGE.r * 0.7, y0 - 7, HINGE.z + HINGE.r * 0.7])], { size: 0.45 }) });
  prism("hinge-leaf", LID, [[HINGE.r, y0 - 6], [LID_FROM, y0 - 6], [LID_FROM, y0 + 6], [HINGE.r, y0 + 6]], 0, 13, { tone: "mid" }, { owner: `hinge${y0}` });
}
const GLARE = [
  [40, 80],
  [56, 92],
  [104, 140],
]
  .map(([a, b]) => k.pathOf([at(lidPoint(a, -95, LID_H - LID_T)), at(lidPoint(b, 95, LID_H - LID_T))]))
  .join("");
prism("lid-panel", LID, [[LID_FROM, -95], [LID_TO, -95], [LID_TO, 95], [LID_FROM, 95]], LID_H - LID_T, LID_H, { tone: "lo", crease: "faint" }, { extra: Ln(GLARE, { tone: "faint" }) });
prism("lid-skirt-back", LID, [[LID_FROM, -93.8], [LID_FROM + LID_T, -93.8], [LID_FROM + LID_T, 93.8], [LID_FROM, 93.8]], 0, LID_H - LID_T, { tone: "lo" });
prism("lid-skirt-front", LID, [[LID_TO - LID_T, -93.8], [LID_TO, -93.8], [LID_TO, 93.8], [LID_TO - LID_T, 93.8]], 0, LID_H - LID_T, { tone: "lo" });
prism("lid-skirt-left", LID, [[LID_FROM, -95], [LID_TO, -95], [LID_TO, -93.8], [LID_FROM, -93.8]], 0, LID_H - LID_T, { tone: "lo" });
prism("lid-skirt-right", LID, [[LID_FROM, 93.8], [LID_TO, 93.8], [LID_TO, 95], [LID_FROM, 95]], 0, LID_H - LID_T, { tone: "lo" });

// ---------------------------------------------------------------- the stack of LP sleeves
halos.push(`<path class="iso-halo" style="opacity:.22" d="${k.pathOf(G.hullOf(SLEEVES.flatMap((s) => rotRing(s.c, SLEEVE, SLEEVE, s.turn).map(([x, y]) => at([x, y, FLOOR])))), true)}"/>`);
SLEEVES.forEach((sleeve, index) => {
  const z = FLOOR + index * SLEEVE_T;
  const ring = rotRing(sleeve.c, SLEEVE, SLEEVE, sleeve.turn);
  const top = z + SLEEVE_T;
  let extra = "";
  if (index === SLEEVES.length - 1) {
    // Jacket art: a printed disc and ring with a horizon band, run edge to edge.
    const art = local2(sleeve.c, sleeve.turn, -14, 10);
    const disc = k.ring(art[0], art[1], 24, top, P, 96);
    extra += `<path class="iso-shade" data-shade="0" d="${disc}"/>` + Ln(disc, { tone: "lo" }) + Ln(k.ring(art[0], art[1], 31, top, P, 96), { tone: "faint" });
    const band = [-34, -40].map((x) => k.lineOnTop(local2(sleeve.c, sleeve.turn, x, -SLEEVE / 2), local2(sleeve.c, sleeve.turn, x, SLEEVE / 2), top, P)).join("");
    extra += Ln(band, { tone: "lo" });
  }
  if (index === 1) {
    // The record half out of its jacket, toward the far side.
    const out = local2(sleeve.c, sleeve.turn, -24, -36);
    put(`sleeve-record`, [out[0], out[1], z + 0.65], S(k.cylinder(out[0], out[1], RECORD_R, z + 0.4, 0.5, P, 144), { tone: "hi", crease: "lo" }) + `<path class="iso-shade" data-shade="0" fill-rule="evenodd" d="${k.ring(out[0], out[1], RECORD_R - 0.3, z + 0.9, P, 144) + k.ring(out[0], out[1], LABEL_R, z + 0.9, P, 96)}"/>` + Ln([28, 40, 52].map((r) => k.ring(out[0], out[1], r, z + 0.9, P, 144)).join(""), { tone: "faint" }), [A.cylinder(out[0], out[1], RECORD_R, z + 0.4, 0.5, { owner: "sleeve1" })]);
  }
  put("sleeve", [sleeve.c[0], sleeve.c[1], z + SLEEVE_T / 2], S(k.extrude(ring, z, SLEEVE_T, P, { bevel: 0.5 }), { tone: index === SLEEVES.length - 1 ? "mid" : "lo", crease: "faint", inner: Ln(k.ringSeam(ring, z + SLEEVE_T * 0.5, P), { tone: "faint" }) }) + extra, [A.extruded(ring, z, SLEEVE_T, { name: index === 0 ? "stand.sleeve" : `sleeve${index}`, owner: `sleeve${index}` })]);
});

// ---------------------------------------------------------------- settle the painter's order, write the SVG
A.settle(R, P);
const items = R.items.slice().sort((a, b) => a.key - b.key);
const LABEL = "A record playing on a turntable, music notes drifting up: a record player on a wooden plinth with four feet: the record turning under an S-shaped tonearm with its counterweight, headshell and cue lever, a speed selector knob and pitch fader on the deck, the dust cover propped open behind on two hinges, and a small stack of LP sleeves beside it.";
// Music drifting up off the record: three notes in screen space, staggered.
const [nx, ny] = k.iso([SX, SY, RECORD_TOP], P);
const NOTE = (x, y, s, double) =>
  `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s})"><ellipse cx="0" cy="0" rx="3.4" ry="2.4" transform="rotate(-22)" fill="#a3834f"/>` +
  (double
    ? `<ellipse cx="9" cy="-3" rx="3.4" ry="2.4" transform="rotate(-22 9 -3)" fill="#a3834f"/><path d="M3,-1V-15L12,-18V-4" fill="none" stroke="#a3834f" stroke-width="1.2"/>`
    : `<path d="M3,-1V-15q5,2 6,8" fill="none" stroke="#a3834f" stroke-width="1.2"/>`) +
  `</g>`;
const notes = [
  [nx - 22, ny - 34, 1.5, false, 0],
  [nx + 6, ny - 48, 1.6, true, 1.6],
  [nx + 32, ny - 30, 1.35, false, 3.2],
].map(([x, y, s, d, delay]) => `<g class="sq-note" style="animation-delay:${delay}s">${NOTE(x, y, s, d)}</g>`).join("");
const svg = k.figureSvg({ width: W, height: H, label: LABEL, body: [MOTION_CSS, ...halos, ...items.map((item) => item.svg), notes], standalone: "light" });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
const preview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Record player</title><style>html,body{margin:0;background:#fbfbfa}body{padding:24px 16px}.stage{max-width:720px;margin:0 auto}</style></head><body><div class="stage">${svg}</div></body></html>`;
writeFileSync(join(HERE, "preview.html"), preview);
console.log(`wrote ${OUT} · ${(svg.length / 1024).toFixed(0)} KB · ${items.length} items · ${R.solids.length} solids · ${R.tubes.length} tubes`);
A.auditOrExit(R, P);

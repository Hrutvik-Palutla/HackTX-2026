// A dinner table set for four, as a crafted model on a plinth with a rug.
// Static, light theme. `node apps/web/illustrations/dinner-table/build.mjs` writes
// apps/web/public/illustrations/dinner-table.svg and a preview page next to this script.
// `--audit` runs the geometry audit (kit/audit.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as A from "../kit/audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../public/illustrations/dinner-table.svg");

const WIDTH = 480;
const HEIGHT = 360;

// ---------------------------------------------------------------- world (units ≈ cm)
const PLINTH = { x: -104, y: -104, w: 208, d: 208, r: 5 };
const PLINTH_H = 7;
const FOOT_H = 4;
const RUG = { x: -91.5, y: -91.5, w: 183, d: 183, r: 1.2 };
const RUG_H = 0.8;
const FLOOR = RUG_H;

const TOP = { x: -56, y: -56, w: 112, d: 112, r: 1.5 };
const TOP_Z = 72;
const TOP_H = 3.5;
const TABLE = TOP_Z + TOP_H; // the surface everything is set on
const BREAD_END = 9; // breadboard ends across the plank ends
const PLANKS = 6;
const LEG_AT = 49;
const POMMEL = 6.4;
const POMMEL_Z = 62;
const APRON_T = 1.8;

const SEAT_Z = 44;
const SEAT_H = 3;
const POST_TOP = 92;
const CHAIR_FRONT = 44; // pushed in: the seat front sits 12 under the table top
const CHAIR_BACK = 84;
const LEG = 3.4;

const SIDES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const flameTop = TABLE + 14.9 + 15 + 1.2 + 5.2;
const P = k.fitProjection(
  [
    ...k.boxCorners(PLINTH, -PLINTH_H - FOOT_H, 0),
    ...SIDES.flatMap((n) => [
      [...pointOn(n, CHAIR_BACK + LEG, -20), POST_TOP + 1.4],
      [...pointOn(n, CHAIR_BACK + LEG, 20), POST_TOP + 1.4],
    ]),
    [0, 0, flameTop],
  ],
  WIDTH,
  HEIGHT,
  { pad: 24, azimuth: 45 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const UP = (x, y, z) => G.frameOf([x, y, z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// Side n: a runs out from the table centre along n, b runs across it (b > 0 is the diner's right hand).
function tangentOf([nx, ny]) {
  return [-ny, nx];
}
function pointOn(n, a, b) {
  const t = tangentOf(n);
  return [n[0] * a + t[0] * b, n[1] * a + t[1] * b];
}
function planOn(n, a0, a1, b0, b1, r = 0.5) {
  const [x0, y0] = pointOn(n, a0, b0);
  const [x1, y1] = pointOn(n, a1, b1);
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), d: Math.abs(y1 - y0), r };
}

// ---------------------------------------------------------------- recorder
const R = A.recorder(P);
const centreOf = (plan, z, h) => [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2];

function item(base, centre, svg, shapes, bias = 0) {
  const name = R.nameFor(base);
  R.put({ name, at: centre, bias, svg, shapes: shapes.map((shape) => R.solid({ ...shape, name: shape.name ?? name })) });
  return name;
}

function box(base, plan, z, h, { tone = "mid", steps = 3, bevel = 0.4, crease, inner = "", extra = "", lit = false, bias = 0 } = {}) {
  const svg = S(k.slabOf(plan, z, h, P, steps, bevel), { tone, crease, inner, lit }) + extra;
  return item(base, centreOf(plan, z, h), svg, [A.slab(plan, z, h, {}, steps)], bias);
}

// ---------------------------------------------------------------- plinth, floorboards, rug (drawn first)
const back = [];
const STAND = { owner: "stand.plinth" };
back.push(`<path class="iso-halo" d="${k.haloOf(PLINTH, -PLINTH_H - FOOT_H, PLINTH_H, P)}"/>`);
for (const [x, y] of byDepth(k.corners(PLINTH, 18))) {
  back.push(S(k.cylinder(x, y, 6.4, -PLINTH_H - FOOT_H, 1.4, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5, -PLINTH_H - FOOT_H + 1.4, FOOT_H - 1.4, P, 28), { tone: "mid" }));
  R.solid(A.cylinder(x, y, 6.4, -PLINTH_H - FOOT_H, 1.4, { name: "stand.foot-flange", ...STAND }));
  R.solid(A.cylinder(x, y, 5, -PLINTH_H - FOOT_H + 1.4, FOOT_H - 1.4, { name: "stand.foot", ...STAND }));
}
back.push(S(k.slabOf(PLINTH, -PLINTH_H, PLINTH_H, P, 6, 1.2), { tone: "mid", inner: Ln(k.sideSeam(PLINTH, -2.6, P, 6), { tone: "faint" }) }));
R.solid(A.slab(PLINTH, -PLINTH_H, PLINTH_H, { name: "stand.plinth", ...STAND }, 6));

back.push(Ln(k.planOutline(k.insetPlan(PLINTH, 4.5), 0, P, 6), { tone: "lo" }));

// Rug fringe hangs from the two x ends, drawn before the rug so its roots tuck under the edge.
const fringe = [];
for (let y = RUG.y + 3; y <= RUG.y + RUG.d - 3; y += 3) {
  fringe.push(k.lineOnTop([RUG.x + RUG.w, y], [RUG.x + RUG.w + 3.6, y], 0, P));
  fringe.push(k.lineOnTop([RUG.x - 3.6, y], [RUG.x, y], 0, P));
}
back.push(Ln(fringe.join(""), { tone: "lo" }));
back.push(S(k.slabOf(RUG, 0, RUG_H, P, 3), { tone: "lo", crease: "faint" }));
R.solid(A.slab(RUG, 0, RUG_H, { name: "stand.rug", ...STAND }, 3));
// woven border: two rules with a chain of diamonds between them, and the field line inside
back.push(Ln(k.planOutline(k.insetPlan(RUG, 3.2), RUG_H, P, 3) + k.planOutline(k.insetPlan(RUG, 10.8), RUG_H, P, 3), { tone: "lo" }));
back.push(Ln(k.planOutline(k.insetPlan(RUG, 14), RUG_H, P, 3), { tone: "faint" }));
{
  const band = k.insetPlan(RUG, 7);
  const count = Math.round(band.w / 5);
  const step = band.w / count;
  const half = step / 2;
  const diamonds = [];
  const diamond = (cx, cy) => k.onTop([[cx - half, cy], [cx, cy - half], [cx + half, cy], [cx, cy + half]], RUG_H, P, true);
  for (let index = 0; index < count; index++) {
    const s = band.x + step * index;
    diamonds.push(diamond(s, band.y), diamond(band.x + band.w, s), diamond(s + step, band.y + band.d), diamond(band.x, s + step));
  }
  back.push(Ln(diamonds.join(""), { tone: "lo" }));
  const field = k.insetPlan(RUG, 14);
  const spandrels = [];
  for (const [cx, cy, sx, sy] of [
    [field.x, field.y, 1, 1],
    [field.x + field.w, field.y, -1, 1],
    [field.x, field.y + field.d, 1, -1],
    [field.x + field.w, field.y + field.d, -1, -1],
  ]) {
    for (const [d0, d1] of [
      [2.5, 16],
      [5.5, 11],
    ])
      spandrels.push(k.onTop([[cx + sx * d0, cy + sy * d0], [cx + sx * d1, cy + sy * d0], [cx + sx * d0, cy + sy * d1]], RUG_H, P, true));
  }
  back.push(Ln(spandrels.join(""), { tone: "faint" }));
}
// soft shadow of the table on the rug
back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(TOP, 8), FLOOR, 0.1, P)}" style="opacity:.22"/>`);

// ---------------------------------------------------------------- table
const legProfile = [
  [FLOOR, 2.3],
  [3.4, 2.3],
  [3.4, 1.8],
  [7.2, 1.86],
  [7.2, 2.2],
  [8.8, 2.2],
  [8.8, 1.88],
  [42, 2.45],
  [42, 2.9],
  [44.6, 2.9],
  [44.6, 2.3],
  [46.2, 2.3],
  [57.4, 2.75],
  [57.4, 3.0],
  [59.6, 3.0],
  [59.6, 2.5],
  [POMMEL_Z, 2.5],
];
for (const sx of [-1, 1]) {
  for (const sy of [-1, 1]) {
    const cx = sx * LEG_AT;
    const cy = sy * LEG_AT;
    const F = UP(cx, cy, 0);
    const pommel = { x: cx - POMMEL / 2, y: cy - POMMEL / 2, w: POMMEL, d: POMMEL, r: 0.5 };
    const turned = G.solidOf(legProfile, F, P, { steps: 20 });
    const rings = [24, 30].map((s) => G.arcOf(F, s, 1.88 + ((2.45 - 1.88) * (s - 8.8)) / (42 - 8.8), P, { slope: (2.45 - 1.88) / (42 - 8.8) })).join("");
    const svg = S(turned, { tone: "mid", inner: Ln(rings, { tone: "faint" }) }) + S(k.slabOf(pommel, POMMEL_Z, TOP_Z - POMMEL_Z, P, 2, 0.4), { tone: "mid" });
    item("table.leg", [cx, cy, 36], svg, [A.solid(F, legProfile), A.slab(pommel, POMMEL_Z, TOP_Z - POMMEL_Z, {}, 2)]);
  }
}
// Apron boards between the legs, set back 0.6 from the leg faces, each with a bead line along its face.
const APRON_OUT = LEG_AT + POMMEL / 2 - 0.6;
const apronPlans = [
  { x: APRON_OUT - APRON_T, y: -LEG_AT + POMMEL / 2, w: APRON_T, d: 2 * (LEG_AT - POMMEL / 2), r: 0 },
  { x: -LEG_AT + POMMEL / 2, y: APRON_OUT - APRON_T, w: 2 * (LEG_AT - POMMEL / 2), d: APRON_T, r: 0 },
  { x: -APRON_OUT, y: -LEG_AT + POMMEL / 2, w: APRON_T, d: 2 * (LEG_AT - POMMEL / 2), r: 0 },
  { x: -LEG_AT + POMMEL / 2, y: -APRON_OUT, w: 2 * (LEG_AT - POMMEL / 2), d: APRON_T, r: 0 },
];
for (const plan of apronPlans) {
  box("table.apron", plan, POMMEL_Z + 1, TOP_Z - POMMEL_Z - 1, { steps: 1, bevel: 0, inner: Ln(k.sideSeam(plan, POMMEL_Z + 2.6, P, 1), { tone: "faint" }) });
}
// The top: six planks along x between two breadboard ends, pegged.
{
  const lines = [];
  const xIn = TOP.w / 2 - BREAD_END;
  for (const x of [-xIn, xIn]) {
    lines.push(k.lineOnTop([x, TOP.y], [x, TOP.y + TOP.d], TABLE, P));
    lines.push(k.segment([x, TOP.y + TOP.d, TOP_Z], [x, TOP.y + TOP.d, TABLE], P));
  }
  const plank = TOP.d / PLANKS;
  for (let index = 1; index < PLANKS; index++) lines.push(k.lineOnTop([-xIn, TOP.y + plank * index], [xIn, TOP.y + plank * index], TABLE, P));
  // end-grain-free ends: the breadboards show a faint grain line each
  const grain = [-1, 1].map((sx) => k.lineOnTop([sx * (xIn + BREAD_END * 0.62), TOP.y], [sx * (xIn + BREAD_END * 0.62), TOP.y + TOP.d], TABLE, P));
  const pegs = [-1, 1].flatMap((sx) => Array.from({ length: PLANKS }, (_, index) => at([sx * (xIn + BREAD_END * 0.32), TOP.y + plank * (index + 0.5), TABLE])));
  const svg = S(k.slabOf(TOP, TOP_Z, TOP_H, P, 3, 0.6), { tone: "mid", inner: Ln(lines.join(""), { tone: "lo" }) + Ln(grain.join(""), { tone: "faint" }) }) + Dots(pegs, { size: 0.42, tone: "mid" });
  item("table.top", centreOf(TOP, TOP_Z, TOP_H), svg, [A.slab(TOP, TOP_Z, TOP_H, {}, 3)]);
}

// ---------------------------------------------------------------- chairs (ladder backs, pushed in)
for (const n of SIDES) {
  const seat = planOn(n, CHAIR_FRONT, CHAIR_BACK, -20, 20, 2);
  const cushion = planOn(n, CHAIR_FRONT + 2.2, CHAIR_BACK - 1.6, -17.8, 17.8, 3.2);
  const cushionSvg =
    S(k.slabOf(cushion, SEAT_Z + SEAT_H, 1.6, P, 6, 0.4), { tone: "mid" }) +
    Ln(k.planOutline(k.insetPlan(cushion, 1.4), SEAT_Z + SEAT_H + 1.6, P, 6), { tone: "faint" }) +
    Dots([at([...pointOn(n, (CHAIR_FRONT + CHAIR_BACK) / 2, 0), SEAT_Z + SEAT_H + 1.6])], { size: 0.5, tone: "mid" });
  item(
    "chair.seat",
    centreOf(seat, SEAT_Z, SEAT_H),
    S(k.slabOf(seat, SEAT_Z, SEAT_H, P, 4, 0.6), { tone: "mid", inner: Ln(k.sideSeam(seat, SEAT_Z + 1.2, P, 4), { tone: "faint" }) }) + cushionSvg,
    [A.slab(seat, SEAT_Z, SEAT_H, {}, 4), A.slab(cushion, SEAT_Z + SEAT_H, 1.6, {}, 6)],
  );
  for (const side of [-1, 1]) {
    const b0 = side > 0 ? 20 - LEG - 1 : -20 + 1;
    const front = planOn(n, CHAIR_FRONT + 1, CHAIR_FRONT + 1 + LEG, b0, b0 + LEG, 0.5);
    box("chair.leg", front, FLOOR, SEAT_Z - FLOOR, { steps: 2, bevel: 0 });
    const post = planOn(n, CHAIR_BACK, CHAIR_BACK + LEG, b0, b0 + LEG, 0.5);
    box("chair.post", post, FLOOR, POST_TOP - FLOOR, { steps: 2, bevel: 0.3 });
    const [px, py] = pointOn(n, CHAIR_BACK + LEG / 2, b0 + LEG / 2);
    item("chair.finial", [px, py, POST_TOP + 0.6], S(k.cylinder(px, py, 1.5, POST_TOP, 1.2, P, 12, 0.3), { tone: "mid" }), [A.cylinder(px, py, 1.5, POST_TOP, 1.2)]);
    const stretcher = planOn(n, CHAIR_FRONT + 1 + LEG, CHAIR_BACK, b0 + 0.7, b0 + LEG - 0.7, 0.6);
    box("chair.stretcher", stretcher, 13, 2.2, { steps: 2, bevel: 0 });
    const rail = planOn(n, CHAIR_FRONT + 1 + LEG, CHAIR_BACK, b0 + 0.4, b0 + LEG - 0.4, 0.3);
    box("chair.rail", rail, SEAT_Z - 4.5, 4.5, { steps: 2, bevel: 0 });
  }
  const inner = 20 - LEG - 1;
  const frontRail = planOn(n, CHAIR_FRONT + 1.6, CHAIR_FRONT + 1 + LEG - 0.6, -inner, inner, 0.3);
  box("chair.rail", frontRail, SEAT_Z - 4.5, 4.5, { steps: 2, bevel: 0 });
  for (const [z0, z1] of [
    [58, 62.5],
    [69, 73.5],
    [81, 89.5],
  ]) {
    const slat = planOn(n, CHAIR_BACK + 1, CHAIR_BACK + LEG - 1, -inner, inner, 0.4);
    const groove = z1 - z0 > 6 ? Ln(k.sideSeam(slat, z0 + 2.2, P, 2) + k.sideSeam(slat, z1 - 2.2, P, 2), { tone: "faint" }) : "";
    box("chair.slat", slat, z0, z1 - z0, { steps: 2, bevel: 0.3, inner: groove });
  }
}

// ---------------------------------------------------------------- place settings
const PLATE = [
  [0, 7.4],
  [0.5, 8.4],
  [1.5, 12.2],
  [1.9, 12.6],
  [2.2, 12.6],
];
const glassBowl = (t) => 0.6 + 0.95 * t - 0.086 * t * t;
const glassSlope = (s) => 0.95 - 0.172 * (s - 6.4);
const BOWL = Array.from({ length: 15 }, (_, index) => {
  const t = (7 * index) / 14;
  return [6.4 + t, glassBowl(t), 1];
});

function polygonOn(n, ring, bc) {
  return ring.map(([a, db]) => pointOn(n, a, bc + db));
}
function flatPiece(base, n, ring, bc, z, h, extra = "", tone = "hi") {
  const world = polygonOn(n, ring, bc);
  const svg = S(k.extrude(world, z, h, P, { convex: false }), { tone }) + extra;
  const cx = world.reduce((sum, p) => sum + p[0], 0) / world.length;
  const cy = world.reduce((sum, p) => sum + p[1], 0) / world.length;
  return item(base, [cx, cy, z + h / 2], svg, [A.extruded(world, z, h)]);
}

const FORK = [
  [33.6, -1.35],
  [33.6, 1.35],
  [37, 1.35],
  [38.2, 0.9],
  [40, 0.42],
  [49.6, 0.85],
  [50.3, 0.7],
  [50.6, 0.3],
  [50.6, -0.3],
  [50.3, -0.7],
  [49.6, -0.85],
  [40, -0.42],
  [38.2, -0.9],
  [37, -1.35],
];
const KNIFE = [
  [33.2, 0.45],
  [33.6, 0.8],
  [42.2, 0.85],
  [42.6, 0.65],
  [50.9, 0.78],
  [51.5, 0.5],
  [51.7, 0],
  [51.5, -0.5],
  [50.9, -0.78],
  [42.6, -0.65],
  [42.2, -0.85],
  [37, -0.85],
  [35, -0.6],
  [33.8, -0.1],
];
const SPOON = (() => {
  const ca = 35.6;
  const ea = 2.5;
  const eb = 1.5;
  const t0 = Math.acos((38 - ca) / ea);
  const ring = [];
  for (let index = 0; index <= 24; index++) {
    const t = t0 + ((2 * Math.PI - 2 * t0) * index) / 24;
    ring.push([ca + ea * Math.cos(t), eb * Math.sin(t)]);
  }
  ring.push([50.6, -0.8], [51.2, -0.6], [51.5, 0], [51.2, 0.6], [50.6, 0.8]);
  return ring;
})();
const CUTLERY_H = 0.45;
const NAPKIN_H = 0.8;

for (const n of SIDES) {
  // plate
  const [pcx, pcy] = pointOn(n, 40, 0);
  const PF = UP(pcx, pcy, TABLE);
  const plateTop = PLATE[PLATE.length - 1][0];
  const plateSvg = S(G.solidOf(PLATE, PF, P), { tone: "hi" }) + Ln(G.circleOf(PF, plateTop, 11.5, P), { tone: "lo" }) + Ln(G.circleOf(PF, plateTop, 8.6, P), { tone: "faint" });
  item("setting.plate", [pcx, pcy, TABLE + 1], plateSvg, [A.solid(PF, PLATE)]);

  // napkin, folded lengthwise, with the fork on it
  const napkin = planOn(n, 32.5, 51.5, -26.5, -14, 0.6);
  const foldA = pointOn(n, 32.5, -23.2);
  const foldB = pointOn(n, 51.5, -23.2);
  box("setting.napkin", napkin, TABLE, NAPKIN_H, {
    steps: 2,
    bevel: 0,
    tone: "mid",
    extra: Ln(k.lineOnTop(foldA, foldB, TABLE + NAPKIN_H, P), { tone: "faint" }) + Ln(k.planOutline(k.insetPlan(napkin, 1), TABLE + NAPKIN_H, P, 2), { tone: "faint" }),
  });
  const forkZ = TABLE + NAPKIN_H;
  const tines = [-0.68, 0, 0.68].map((db) => k.lineOnTop(pointOn(n, 33.6, -19.8 + db), pointOn(n, 35.9, -19.8 + db), forkZ + CUTLERY_H, P)).join("");
  flatPiece("setting.fork", n, FORK, -19.8, forkZ, CUTLERY_H, Ln(tines, { tone: "mid" }));

  const bolster = k.lineOnTop(pointOn(n, 42.4, 16 - 0.75), pointOn(n, 42.4, 16 + 0.75), TABLE + CUTLERY_H, P);
  flatPiece("setting.knife", n, KNIFE, 16, TABLE, CUTLERY_H, Ln(bolster, { tone: "mid" }));
  const bowlLine = k.onTop(
    Array.from({ length: 24 }, (_, index) => {
      const t = (index / 24) * Math.PI * 2;
      return pointOn(n, 35.6 + 1.8 * Math.cos(t), 19.8 + 0.95 * Math.sin(t));
    }),
    TABLE + CUTLERY_H,
    P,
    true,
  );
  flatPiece("setting.spoon", n, SPOON, 19.8, TABLE, CUTLERY_H, Ln(bowlLine, { tone: "faint" }));

  // wine glass: foot, stem, tulip bowl
  const [gx, gy] = pointOn(n, 26.5, 17);
  const GF = UP(gx, gy, TABLE);
  const top = BOWL[BOWL.length - 1];
  const glassSvg =
    S(k.cylinder(gx, gy, 3, TABLE, 0.45, P, 24, 0.3), { tone: "hi" }) +
    S(k.cylinder(gx, gy, 0.42, TABLE + 0.45, 6.4 - 0.45, P, 12), { tone: "hi", crease: "none" }) +
    S(G.solidOf(BOWL, GF, P, { steps: 20, smooth: { slope: glassSlope, rows: 3 } }), { tone: "hi" }) +
    Ln(G.circleOf(GF, top[0], top[1] - 0.35, P), { tone: "faint" });
  item("setting.glass", [gx, gy, TABLE + 7], glassSvg, [A.cylinder(gx, gy, 3, TABLE, 0.45), A.cylinder(gx, gy, 0.42, TABLE + 0.45, 6.4 - 0.45), A.solid(GF, BOWL, { radius: (s) => glassBowl(s - 6.4) })]);
}

// ---------------------------------------------------------------- centrepiece
// candlestick: base, bell, stem with a knop, drip pan, cup; the candle is the one lit part
{
  const CF = UP(0, 0, TABLE);
  const base = [
    [0, 5.2],
    [1, 5.2],
    [1, 4.4],
    [1.5, 4.4],
  ];
  const bell = (s) => 1.05 + 3.35 * (1 - (s - 1.5) / 3.5) ** 2;
  const bellSlope = (s) => (-2 * 3.35 * (1 - (s - 1.5) / 3.5)) / 3.5;
  const BELL = Array.from({ length: 11 }, (_, index) => {
    const s = 1.5 + (3.5 * index) / 10;
    return [s, bell(s), 1];
  });
  const stem = [
    [5, 0.95],
    [8, 0.95],
    [8, 1.6],
    [9.3, 1.6],
    [9.3, 0.95],
    [11.4, 0.95],
  ];
  const cup = [
    [12.2, 1.75],
    [14.3, 1.75],
    [14.3, 2.05],
    [14.9, 2.05],
  ];
  const svg =
    S(G.solidOf(base, CF, P, { bevel: 0.3 }), { tone: "hi", inner: Ln(G.arcOf(CF, 0.5, 5.2, P), { tone: "faint" }) }) +
    S(G.solidOf(BELL, CF, P, { smooth: { slope: bellSlope, rows: 4 } }), { tone: "hi" }) +
    S(G.solidOf(stem, CF, P), { tone: "hi" }) +
    S(G.disc(11.4, 12.2, 3.4, CF, P, { bevel: 0.3 }), { tone: "hi" }) +
    Ln(G.circleOf(CF, 12.2, 2.5, P), { tone: "faint" }) +
    S(G.solidOf(cup, CF, P), { tone: "hi" });
  item("centre.candlestick", [0, 0, TABLE + 7], svg, [A.solid(CF, base), A.solid(CF, BELL, { radius: bell }), A.solid(CF, stem), A.disc(CF, 11.4, 12.2, 3.4), A.solid(CF, cup)]);

  const candleZ = TABLE + 14.9;
  const candleH = 15;
  const tipZ = candleZ + candleH;
  const wickTop = tipZ + 1.2;
  const base0 = at([0, 0, wickTop - 0.3]);
  const unit = G.scaleOf(P);
  const flame = [];
  for (let index = 0; index <= 28; index++) {
    const u = index / 28;
    const w = 1.05 * Math.sin(Math.PI * u ** 0.55) * (1 - 0.15 * u);
    flame.push([base0[0] + w * unit * (index <= 14 ? 1 : 1), base0[1] - 5.2 * u * unit]);
  }
  const outline = [...flame, ...flame.slice(1, -1).reverse().map(([x, y]) => [2 * base0[0] - x, y])];
  const flamePath = k.pathOf(outline, true);
  const core = outline.map(([x, y]) => [base0[0] + (x - base0[0]) * 0.45, base0[1] + (y - base0[1]) * 0.5 + 0.2 * unit]);
  const candleSvg =
    S(k.cylinder(0, 0, 1.3, candleZ, candleH, P, 24), { tone: "hi", lit: true, inner: Ln(k.sideArc(0, 0, 1.3, candleZ + 1.1, P, 16), { tone: "faint" }) }) +
    Ln(k.ring(0, 0, 0.75, tipZ, P, 16), { tone: "faint" }) +
    Ln(k.pathOf([at([0, 0, tipZ]), at([0, 0, wickTop])]), { tone: "hi" }) +
    `<path class="iso-fill" d="${flamePath}"/>` +
    Ln(flamePath, { tone: "lit" }) +
    Ln(k.pathOf(core, true), { tone: "lo" });
  item("centre.candle", [0, 0, candleZ + candleH / 2], candleSvg, [A.cylinder(0, 0, 1.3, candleZ, candleH)]);
}

// bread board with a scored loaf
{
  const board = { x: 3, y: -21, w: 19, d: 10.5, r: 1.2 };
  const tab = { x: 22, y: -17.55, w: 4.6, d: 3.6, r: 1.4 };
  const BOARD_H = 1.4;
  const boardTop = TABLE + BOARD_H;
  const grain = [-18.3, -15.2, -12.6].map((y) => k.lineOnTop([board.x, y], [board.x + board.w, y], boardTop, P)).join("");
  const svg =
    S(k.slabOf(board, TABLE, BOARD_H, P, 4, 0.4), { tone: "mid", inner: Ln(grain, { tone: "faint" }) }) +
    S(k.slabOf(tab, TABLE, BOARD_H, P, 4, 0.3), { tone: "mid" }) +
    Ln(k.ring(tab.x + tab.w - 1.7, tab.y + tab.d / 2, 0.8, boardTop, P, 16), { tone: "mid" });
  item("centre.board", [board.x + board.w / 2, board.y + board.d / 2, TABLE + BOARD_H / 2], svg, [A.slab(board, TABLE, BOARD_H, {}, 4), A.slab(tab, TABLE, BOARD_H, {}, 4)]);

  const LOAF_R = 3.3;
  const LOAF_L = 15;
  const LF = G.frameOf([board.x + 2, board.y + board.d / 2, boardTop + LOAF_R], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const half = LOAF_L / 2;
  const loaf = (s) => LOAF_R * Math.sqrt(Math.max(0, 1 - ((s - half) / half) ** 2));
  const loafSlope = (s) => {
    const x = (s - half) / half;
    return (-LOAF_R * x) / (half * Math.sqrt(Math.max(1e-4, 1 - x * x)));
  };
  const N = 28;
  const LOAF = Array.from({ length: N + 1 }, (_, index) => {
    const s = half - half * Math.cos((Math.PI * index) / N);
    return index === 0 || index === N ? [s, 0] : [s, loaf(s), 1];
  });
  // three diagonal scores, each a closed lens cut into the crust
  const scores = [4.2, 7.5, 10.8].map((sc) => {
    const along = [];
    const back = [];
    for (let index = 0; index <= 12; index++) {
      const u = index / 12;
      const s = sc - 1.7 + 3.4 * u;
      const theta = Math.PI / 2 + 0.62 - 1.24 * u;
      const w = 0.16 * Math.sin(Math.PI * u);
      const r = loaf(s) + 0.02;
      along.push(at(G.pointOf(LF, s, r, theta + w)));
      back.push(at(G.pointOf(LF, s, r, theta - w)));
    }
    return k.pathOf([...along, ...back.slice(1, -1).reverse()], true);
  });
  const loafSvg = S(G.solidOf(LOAF, LF, P, { smooth: { slope: loafSlope, rows: 4 } }), { tone: "hi" }) + Ln(scores.join(""), { tone: "mid" });
  item("centre.loaf", G.pointOf(LF, half, 0, 0), loafSvg, [A.solid(LF, LOAF, { radius: loaf })]);
}

// wine bottle with a label band and a foil
{
  const BF = UP(-13, 11, TABLE);
  const BODY_R = 3.4;
  const NECK_R = 1.15;
  const shoulder = (s) => NECK_R + ((BODY_R - NECK_R) * (1 + Math.cos((Math.PI * (s - 15)) / 4.5))) / 2;
  const slope = (s) => (s <= 15 || s >= 19.5 ? 0 : (-(BODY_R - NECK_R) * Math.PI * Math.sin((Math.PI * (s - 15)) / 4.5)) / 9);
  const BOTTLE = [[0, BODY_R], [15, BODY_R, 1], ...Array.from({ length: 11 }, (_, index) => [15 + (4.5 * (index + 1)) / 12, shoulder(15 + (4.5 * (index + 1)) / 12), 1]), [19.5, NECK_R, 1], [25.6, NECK_R]];
  const label = [4, 11.5].map((s) => G.arcOf(BF, s, BODY_R, P)).join("") + G.arcOf(BF, 21.4, NECK_R, P);
  const svg =
    S(G.solidOf(BOTTLE, BF, P, { smooth: { slope, rows: 4 } }), { tone: "hi", inner: Ln(label, { tone: "lo" }) }) +
    S(G.disc(25.6, 26.6, 1.42, BF, P, { bevel: 0.2 }), { tone: "hi" });
  item("centre.bottle", [-13, 11, TABLE + 13], svg, [A.solid(BF, BOTTLE, { radius: (s) => (s <= 15 ? BODY_R : s >= 19.5 ? NECK_R : shoulder(s)) }), A.disc(BF, 25.6, 26.6, 1.42)]);
}

// salt and pepper
for (const [x, y, holes] of [
  [10, 12.5, 3],
  [13.8, 9, 1],
]) {
  const F = UP(x, y, TABLE);
  const body = [
    [0, 1.55],
    [0.5, 1.55],
    [0.5, 1.3],
    [3.8, 1.5],
  ];
  const capTop = TABLE + 5;
  const dots = holes === 1 ? [at([x, y, capTop])] : [0, 1, 2].map((index) => at([x + 0.6 * Math.cos((index * 2 * Math.PI) / 3), y + 0.6 * Math.sin((index * 2 * Math.PI) / 3), capTop]));
  const svg = S(G.solidOf(body, F, P, { steps: 16 }), { tone: "hi" }) + S(G.disc(3.8, 5, 1.62, F, P, { bevel: 0.2, steps: 16 }), { tone: "hi" }) + Dots(dots, { size: 0.32, tone: "hi" });
  item("centre.shaker", [x, y, TABLE + 2.5], svg, [A.solid(F, body), A.disc(F, 3.8, 5, 1.62)]);
}

// covered serving dish: footed bowl, domed lid, knob
{
  const [x, y] = [-6, -20];
  const F = UP(x, y, TABLE);
  const bowl = [
    [0, 3.4],
    [0.6, 3.4],
    [0.6, 3.9],
    [3.4, 5.6],
    [3.4, 5.9],
    [3.9, 5.9],
  ];
  const LID_R = 5.5;
  const LID_H = 3;
  const lidZ = 3.9;
  const lid = (s) => LID_R * Math.sqrt(Math.max(0, 1 - ((s - lidZ) / LID_H) ** 2));
  const lidSlope = (s) => {
    const u = (s - lidZ) / LID_H;
    return (-LID_R * u) / (LID_H * Math.sqrt(Math.max(1e-4, 1 - u * u)));
  };
  const N = 18;
  const LID = Array.from({ length: N + 1 }, (_, index) => {
    const s = lidZ + LID_H * Math.sin((Math.PI / 2) * (index / N));
    return index === N ? [s, 0] : [s, lid(s), index ? 1 : 0];
  });
  const knobAt = [x, y, TABLE + lidZ + LID_H + 0.75];
  const svg =
    S(G.solidOf(bowl, F, P), { tone: "hi", inner: Ln(G.arcOf(F, 3.4, 5.6, P), { tone: "faint" }) }) +
    S(G.solidOf(LID, F, P, { smooth: { slope: lidSlope, rows: 4 } }), { tone: "hi", inner: Ln(G.arcOf(F, lidZ + 1, lid(lidZ + 1), P, { slope: lidSlope(lidZ + 1) }), { tone: "faint" }) }) +
    S(G.sphereOf(knobAt, 0.9, P), { tone: "hi" });
  item("centre.dish", [x, y, TABLE + 3.5], svg, [A.solid(F, bowl), A.solid(F, LID, { radius: lid }), A.ball(knobAt, 0.9)]);
}

// ---------------------------------------------------------------- assemble
A.settle(R, P);
if (process.argv.includes("--sizes")) { const by = {}; for (const it of R.items) { const b = it.name.split("#")[0]; by[b] = (by[b] ?? 0) + it.svg.length; } console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${(v / 1024).toFixed(1)}K`).join("\n"), "\nback", (back.join("").length / 1024).toFixed(1) + "K"); }
R.items.sort((a, b) => a.key - b.key);
const body = [...back, ...R.items.map((entry) => entry.svg)];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "A wooden dinner table set for four on a rug: four ladder-back chairs pulled in, plates, cutlery, napkins and wine glasses at each place, with a lit candle, a loaf on a bread board, a bottle of wine and a covered dish in the middle.",
  body,
  standalone: "light",
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg + "\n");
const preview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dinner table</title><style>
*{box-sizing:border-box}html,body{margin:0;background:#fbfbfa}
.stage{width:100%;max-width:512px;margin:24px auto;padding:0 16px}
.stage svg{display:block;width:100%;height:auto}
</style></head><body><div class="stage">${svg}</div></body></html>
`;
writeFileSync(join(HERE, "preview.html"), preview);
console.log(`wrote ${OUT} (${(svg.length / 1024).toFixed(1)} KB) · ${R.items.length} items · ${R.solids.length} shapes`);

A.auditOrExit(R, P);

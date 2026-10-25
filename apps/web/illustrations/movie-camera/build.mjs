// A vintage hand-cranked movie camera on a short tripod, standing on a turned plinth.
// Decorative home-page figure for SideQuest (movie nights). Static, light theme, no words.
//
//   node apps/web/illustrations/movie-camera/build.mjs           writes the SVG and preview.html
//   node apps/web/illustrations/movie-camera/build.mjs --audit   also proves the geometry (kit/audit.mjs)
//
// World units are about one screen px of the real object: x runs from the back of the camera to the
// lens, y from its far side to the near (crank) side, z up. The plinth top is z = 0.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as A from "../kit/audit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../public/illustrations/movie-camera.svg");
const PREVIEW = join(HERE, "preview.html");

const W = 480;
const H = 360;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Layout (all heights in world units)

const PLINTH_R = 51; // lower step
const PLINTH_TOP_R = 46; // upper step
const GROOVE_R = PLINTH_TOP_R - 2.4;
const PLINTH_Z = [-10, -4, 0]; // bottom, step, top

const LEG_ANGLES = [-15, 105, 225];
const FOOT_RADIUS = 37.5;
const PAD_R = 4.6;
const PAD_H = 2.2;
const FOOT_BALL = 3.2;
const TOP_BALL = 3.4;
const LEG_TOP_RADIUS = 12;
const CAST = { r: 18, z: 26, h: 6 }; // tripod top casting
const PAN = { r: 13, z: CAST.z + CAST.h, h: 6 }; // pan base
const CRADLE = { x: -9, y: -12, w: 18, d: 24, r: 2 };
const CRADLE_Z = PAN.z + PAN.h; // 58
const CRADLE_H = 5;
const DRUM = { r: 6, z: CRADLE_Z + CRADLE_H + 4, y0: -12, y1: 12 };
const DECK = { x: -30, y: -16, w: 60, d: 32, r: 2.5 }; // camera platform
const DECK_Z = DRUM.z + DRUM.r; // 73
const DECK_H = 4;

const BODY_Z = DECK_Z + DECK_H; // 57
const BODY = { x: -46, y: -24, w: 92, d: 48, r: 4 };
const BAND_H = 5;
const BODY_TOP = BODY_Z + 60;
const LID_H = 3;
const LID_TOP = BODY_TOP + LID_H;
const SIDE = BODY.y + BODY.d; // the near (+y) face, y = 24
const FRONT = BODY.x + BODY.w; // the lens (+x) face, x = 46

const REEL = { r: 26, z: LID_TOP + 3 + 26, x: [29, -29], packs: [20, 12] };
const REEL_Y = { collar: 3, back: 4.4, pack: 5.4, front: 13.4, face: 14.4, hub: 16.2, nut: 18.6 };
const THROAT = { x: -7.5, y: 4.4, w: 15, d: 10, r: 1.5 };
const THROAT_TOP = LID_TOP + 3.5;
const FILM_X = [3.5, -3.5];

const TURRET = { o: [FRONT, 0, BODY_Z + 35], r: 20, t: 3 };
const LENS_AT = [FRONT + TURRET.t, 0, TURRET.o[2] + 9];
const SMALL_LENSES = [
  [FRONT + TURRET.t, 10.5, TURRET.o[2] - 8],
  [FRONT + TURRET.t, -10.5, TURRET.o[2] - 8],
];
const FINDER = { x: -40, y: SIDE, w: 84, d: 8, r: 1.2 };
const FINDER_Z = [BODY_TOP - 15, BODY_TOP - 6];

const CRANK_AT = [-26, SIDE, BODY_Z + 23];
const DOOR = { x0: -6, x1: 38, z0: BODY_Z + 7, z1: BODY_Z + 39 };
const CRANK_ARM = 14;
const CRANK_DIR = [-0.6, 0, 0.8]; // arm points up and back

// ---------------------------------------------------------------------------------------------
// Camera

const lensTip = LENS_AT[0] + 36;
const fitPoints = [];
for (let index = 0; index < 24; index++) {
  const t = (index / 24) * TAU;
  fitPoints.push([PLINTH_R * Math.cos(t), PLINTH_R * Math.sin(t), PLINTH_Z[0] - 3]);
  fitPoints.push([PLINTH_R * Math.cos(t), PLINTH_R * Math.sin(t), 0]);
}
for (const x of REEL.x)
  for (let index = 0; index < 24; index++) {
    const t = (index / 24) * TAU;
    for (const y of [REEL_Y.back, REEL_Y.face]) fitPoints.push([x + REEL.r * Math.cos(t), y, REEL.z + REEL.r * Math.sin(t)]);
  }
for (let index = 0; index < 12; index++) {
  const t = (index / 12) * TAU;
  fitPoints.push([lensTip, 10.5 * Math.cos(t), LENS_AT[2] + 10.5 * Math.sin(t)]);
}
fitPoints.push([-86, 28, 30], [-36, 44, 92], [-50, 28, FINDER_Z[1]]);

const P = k.fitProjection(fitPoints, W, H, { pad: 24, azimuth: 45, elevation: 30 });
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const Faded = (list, style) => k.fadedSvg(list, style);
const FADE_RIBS = [0.1, 0.55];
const pathOf = (points, closed = false) => {
  if (!points.length) return "";
  const f = (v) => (Math.round(v * 10) / 10).toString();
  return `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}${closed ? "Z" : ""}`;
};

// Frames for parts turned about the three world axes. (u × v = a, so prism faces shade correctly.)
const alongX = (o) => G.frameOf(o, [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const alongY = (o) => G.frameOf(o, [0, 1, 0], [0, 0, 1], [1, 0, 0]);
const alongNegX = (o) => G.frameOf(o, [-1, 0, 0], [0, 0, 1], [0, 1, 0]);

// ---------------------------------------------------------------------------------------------
// Recording: every drawn item carries its true shape, so A.settle measures the painter's order.

const R = A.recorder(P);
const SVG_DEFS = [];
const AFTER = []; // flat marks drawn on top of everything (none use depth)

function put(name, ref, svg, shapes, { bias = 0 } = {}) {
  const id = R.nameFor(name);
  shapes.forEach((shape) => (shape.name = shape.name ?? id));
  R.put({ name: id, at: ref, bias, svg, shapes: shapes.map((shape) => R.solid(shape)) });
  return id;
}

function turned(name, F, profile, { tone = "hi", lit = false, crease, inner = "", extra = "", owner, bias = 0, steps, rims, shapeOnly = false } = {}) {
  const soft = profile.some((point) => point[2]);
  const paths = G.solidOf(profile, F, P, { ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) });
  const s0 = profile[0][0];
  const s1 = profile[profile.length - 1][0];
  const shape = A.solid(F, profile, { owner, curve: soft ? profile : undefined });
  if (shapeOnly) return { paths, shape };
  return put(name, G.pointOf(F, (s0 + s1) / 2, 0, 0), S(paths, { tone, lit, inner, ...(crease ? { crease } : {}) }) + extra, [shape], { bias });
}

function disc(name, F, s0, s1, r, options = {}) {
  return turned(name, F, [
    [s0, r],
    [s1, r],
  ], options);
}

function box(name, plan, z, h, { tone = "hi", steps = 4, bevel = 0.5, crease, inner = "", extra = "", owner, bias = 0 } = {}) {
  const paths = k.slabOf(plan, z, h, P, steps, bevel);
  return put(name, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(paths, { tone, inner, ...(crease ? { crease } : {}) }) + extra, [A.slab(plan, z, h, { owner }, steps)], { bias });
}

function post(name, cx, cy, r, z, h, { tone = "hi", steps = 32, bevel = 0, inner = "", extra = "", owner, bias = 0, crease } = {}) {
  const paths = k.cylinder(cx, cy, r, z, h, P, steps, bevel);
  return put(name, [cx, cy, z + h / 2], S(paths, { tone, inner, ...(crease ? { crease } : {}) }) + extra, [A.cylinder(cx, cy, r, z, h, { owner })], { bias });
}

function ball(name, centre, r, { tone = "mid", owner, bias = 0 } = {}) {
  return put(name, centre, S(G.sphereOf(centre, r, P), { tone, crease: "none" }), [A.ball(centre, r, { owner })], { bias });
}

// A closed outline in a vertical face plane: corners are rounded by r.
function faceRect(face, a0, a1, z0, z1, r, steps = 5) {
  const pts = [];
  const corner = (ca, cz, from) => {
    for (let index = 0; index <= steps; index++) {
      const t = (from + (index / steps) * 90) * DEG;
      pts.push([ca + r * Math.cos(t), cz + r * Math.sin(t)]);
    }
  };
  corner(a1 - r, z0 + r, -90);
  corner(a1 - r, z1 - r, 0);
  corner(a0 + r, z1 - r, 90);
  corner(a0 + r, z0 + r, 180);
  return pathOf(pts.map(([a, z]) => at(face(a, z))), true);
}
const onSide = (y) => (x, z) => [x, y, z];
const onFront = (x) => (y, z) => [x, y, z];

// Chaikin corner rounding for closed 2D polygons.
function rounded(points, passes = 3) {
  let pts = points;
  for (let pass = 0; pass < passes; pass++) {
    const next = [];
    for (let index = 0; index < pts.length; index++) {
      const a = pts[index];
      const b = pts[(index + 1) % pts.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// 1. Plinth (stand.*, tone lo)

const PLINTH = G.frameOf([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const halo = `<path class="iso-halo" d="${k.haloOf({ x: -PLINTH_R, y: -PLINTH_R, w: PLINTH_R * 2, d: PLINTH_R * 2, r: PLINTH_R }, PLINTH_Z[0] - 3, 3, P)}"/>`;

for (const t of [0, 90, 180, 270]) {
  const x = 44 * Math.cos((t + 45) * DEG);
  const y = 44 * Math.sin((t + 45) * DEG);
  post("stand.foot", x, y, 5, PLINTH_Z[0] - 2.4, 2.4, { tone: "lo", steps: 28 });
}
post("stand.plinth", 0, 0, PLINTH_R, PLINTH_Z[0], PLINTH_Z[1] - PLINTH_Z[0], {
  tone: "lo",
  steps: 120,
  bevel: 1.2,
  inner: Ln(k.sideArc(0, 0, PLINTH_R, PLINTH_Z[0] + 2.4, P, 64), { tone: "faint" }),
});
{
  const plate = (() => {
    // A small engraved plaque, laid along the plinth's front edge (facing the viewer).
    const c = [32 * Math.cos(45 * DEG), 32 * Math.sin(45 * DEG)];
    const along = [Math.cos(-45 * DEG), Math.sin(-45 * DEG)];
    const across = [Math.cos(45 * DEG), Math.sin(45 * DEG)];
    const ring = rounded(
      [
        [-12, -4],
        [12, -4],
        [12, 4],
        [-12, 4],
      ],
      2,
    ).map(([a, b]) => [c[0] + along[0] * a + across[0] * b, c[1] + along[1] * a + across[1] * b]);
    const local = (a, b) => [c[0] + along[0] * a + across[0] * b, c[1] + along[1] * a + across[1] * b];
    return { ring, local };
  })();
  const top = PLINTH_Z[2] + 0.7;
  const rules = [
    [-7, 7, -1.6],
    [-7, 4, 0],
    [-7, 6, 1.6],
  ]
    .map(([a0, a1, b]) => pathOf([at([...plate.local(a0, b), top]), at([...plate.local(a1, b), top])]))
    .join("");
  const inset = rounded(
    [
      [-10.6, -2.8],
      [10.6, -2.8],
      [10.6, 2.8],
      [-10.6, 2.8],
    ],
    2,
  ).map(([a, b]) => at([...plate.local(a, b), top]));
  const top0 = PLINTH_Z[1];
  put(
    "stand.plinth-top",
    [0, 0, (top0 + PLINTH_Z[2]) / 2],
    S(k.cylinder(0, 0, PLINTH_TOP_R, top0, PLINTH_Z[2] - top0, P, 120, 1.4), { tone: "lo" }) +
      Ln(k.ring(0, 0, GROOVE_R, PLINTH_Z[2], P, 120), { tone: "faint" }) +
      // three screws on the groove, between the tripod feet
      Ln([165, 285].map((t) => k.ring((GROOVE_R) * Math.cos(t * DEG), (GROOVE_R) * Math.sin(t * DEG), 1.6, PLINTH_Z[2], P, 16)).join(""), { tone: "lo" }) +
      Dots([165, 285].map((t) => at([(GROOVE_R) * Math.cos(t * DEG), (GROOVE_R) * Math.sin(t * DEG), PLINTH_Z[2]])), { size: 0.5 }) +
      S(k.extrude(plate.ring, PLINTH_Z[2], 0.7, P), { tone: "lo", crease: "faint" }) +
      Ln(pathOf(inset, true), { tone: "faint" }) +
      Ln(rules, { tone: "lo", free: true }) +
      Dots([at([...plate.local(-10.3 + 0.9, 0), top]), at([...plate.local(10.3 - 0.9, 0), top])], { size: 0.45 }),
    [A.cylinder(0, 0, PLINTH_TOP_R, top0, PLINTH_Z[2] - top0), A.extruded(plate.ring, PLINTH_Z[2], 0.7)],
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Tripod (tone mid): pads, ball feet, three legs, top casting with a pan scale

const legOf = (deg) => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  const foot = [FOOT_RADIUS * c, FOOT_RADIUS * s];
  const lower = [foot[0], foot[1], PAD_H + FOOT_BALL];
  const upper = [LEG_TOP_RADIUS * c, LEG_TOP_RADIUS * s, CAST.z - TOP_BALL];
  return { foot, lower, upper };
};

LEG_ANGLES.forEach((deg, index) => {
  const { foot, lower, upper } = legOf(deg);
  const owner = `tripod.leg${index}`;
  post("tripod.pad", foot[0], foot[1], PAD_R, 0, PAD_H, { tone: "mid", steps: 28, owner, bevel: 0.4 });
  // The leg meets both balls rim-on-sphere. Leg and balls are one item, painted in the order the
  // leg runs relative to the viewer: a ball the leg recedes into is painted over the leg's end.
  const axis = G.sub3(upper, lower);
  const L = G.len3(axis);
  const F = G.frameAlong(lower, axis);
  const s0 = Math.sqrt(FOOT_BALL ** 2 - 2.4 ** 2);
  const s1 = L - Math.sqrt(TOP_BALL ** 2 - 2.8 ** 2);
  const leg = turned("tripod.leg", F, [
    [s0, 2.4],
    [s0 + 5, 2.4],
    [s0 + 5, 2.0],
    [s1 - 6, 2.35],
    [s1 - 6, 2.8],
    [s1, 2.8],
  ], { owner, shapeOnly: true });
  const legSvg = S(leg.paths, { tone: "mid", inner: Ln(G.arcOf(F, s0 + 2.5, 2.4, P) + G.arcOf(F, s1 - 3, 2.8, P), { tone: "faint" }) });
  const footSvg = S(G.sphereOf(lower, FOOT_BALL, P), { tone: "mid", crease: "none" });
  const topSvg = S(G.sphereOf(upper, TOP_BALL, P), { tone: "mid", crease: "none" });
  const toward = G.dot3(F.a, V) > 0; // the leg comes toward the viewer as it rises
  const svg = toward ? footSvg + legSvg + topSvg : topSvg + legSvg + footSvg;
  put("tripod.leg", G.lerp3(lower, upper, 0.5), svg, [A.ball(lower, FOOT_BALL, { owner }), leg.shape, A.ball(upper, TOP_BALL, { owner })]);
});

{
  const ticks = k.radialTicks(0, 0, CAST.r - 0.5, 72, 6, CAST.z + CAST.h, [1.2, 2.6], P);
  post("tripod.casting", 0, 0, CAST.r, CAST.z, CAST.h, {
    tone: "mid",
    steps: 72,
    bevel: 0.5,
    inner: Ln(k.sideArc(0, 0, CAST.r, CAST.z + 2, P, 48), { tone: "faint" }),
    extra: Ln(k.ring(0, 0, CAST.r - 0.5, CAST.z + CAST.h, P, 96), { tone: "faint" }) + Ln(ticks.minor, { tone: "lo" }) + Ln(ticks.major, { tone: "mid" }),
  });
}

// ---------------------------------------------------------------------------------------------
// 3. Pan-tilt head (tone mid)

post("head.pan", 0, 0, PAN.r, PAN.z, PAN.h, {
  tone: "mid",
  steps: 56,
  bevel: 0.4,
  inner: Ln(k.sideArc(0, 0, PAN.r, PAN.z + 2.2, P, 40), { tone: "faint" }),
  extra: Ln(k.knurl(0, 0, PAN.r, PAN.z + 2.2, PAN.z + PAN.h, 56, P, 0.5), { tone: "faint" }),
});
// pan index pin pointing at the scale
post("head.index", (PAN.r + 0.8) * Math.cos(45 * DEG), (PAN.r + 0.8) * Math.sin(45 * DEG), 0.8, PAN.z, 3.4, { tone: "mid", steps: 12 });
// pan lock knob on the near side
{
  const dir = [Math.cos(100 * DEG), Math.sin(100 * DEG), 0];
  const F = G.frameAlong([PAN.r * dir[0], PAN.r * dir[1], PAN.z + 3], dir);
  turned("head.pan-lock-neck", F, [
    [-0.1, 1.3],
    [3.2, 1.3],
  ], { tone: "mid", owner: "head" });
  turned("head.pan-lock", F, [
    [3.2, 2.6],
    [7.4, 2.6],
  ], { tone: "mid", owner: "head", extra: Faded(G.ribsOf(F, 3.2, 7.4, 2.6, 18, P, { fade: FADE_RIBS }), { tone: "lo" }) });
}
box("head.cradle", CRADLE, CRADLE_Z, CRADLE_H, { tone: "mid", bevel: 0.5, owner: "head", inner: Ln(k.sideSeam(CRADLE, CRADLE_Z + 1.6, P, 4), { tone: "faint" }) });
{
  const F = alongY([0, DRUM.y0, DRUM.z]);
  const len = DRUM.y1 - DRUM.y0;
  turned("head.drum", F, [
    [0, DRUM.r],
    [len, DRUM.r],
  ], { tone: "mid", owner: "head", inner: Ln(G.arcOf(F, 3, DRUM.r, P) + G.arcOf(F, len - 3, DRUM.r, P), { tone: "faint" }) });
  turned("head.tilt-collar", F, [
    [len, 4],
    [len + 2, 4],
  ], { tone: "mid", owner: "head" });
  turned("head.tilt-knob", F, [
    [len + 2, 3.4],
    [len + 6.5, 3.4],
  ], {
    tone: "mid",
    owner: "head",
    extra: Faded(G.ribsOf(F, len + 2, len + 6.5, 3.4, 22, P, { fade: FADE_RIBS }), { tone: "lo" }) + Ln(G.circleOf(F, len + 6.5, 1.8, P), { tone: "faint" }) + Dots([at(G.pointOf(F, len + 6.5, 0, 0))], { size: 0.5 }),
  });
}
box("head.deck", DECK, DECK_Z, DECK_H, { tone: "mid", bevel: 0.6, owner: "head", inner: Ln(k.sideSeam(DECK, DECK_Z + 1.4, P, 4), { tone: "faint" }) });
{
  // Pan handle: socket on the deck's back face, a rod, a rubber grip and an end cap.
  const d = G.unit3([-1, 0.3, -0.42]);
  const F = G.frameAlong([DECK.x, 12, DECK_Z + 2], d);
  const rings = [46, 49, 52, 55].map((s) => G.arcOf(F, s, 2.5, P)).join("");
  turned("head.pan-handle", F, [
    [0, 2.4],
    [4, 2.4],
    [4, 1.6],
    [42, 1.6],
    [42, 2.5],
    [58, 2.5],
    [58, 2.1],
    [60, 2.1],
  ], { tone: "mid", owner: "head", inner: Ln(rings, { tone: "faint" }) });
}

// ---------------------------------------------------------------------------------------------
// 4. Camera body (the subject, tone hi)

const BAND = k.insetPlan(BODY, -0.8);
const LID = k.insetPlan(BODY, -0.6);
box("camera.band", BAND, BODY_Z, BAND_H, { tone: "hi", steps: 6, bevel: 0.6, owner: "camera" });
{
  // Door on the near side (front half), name plate behind it, and the side seams.
  const door = faceRect(onSide(SIDE), DOOR.x0, DOOR.x1, DOOR.z0, DOOR.z1, 2.6);
  const doorInner = faceRect(onSide(SIDE), DOOR.x0 + 1.4, DOOR.x1 - 1.4, DOOR.z0 + 1.4, DOOR.z1 - 1.4, 1.6);
  const frontPanel = faceRect(onFront(FRONT), -21, 21, BODY_Z + 9.5, BODY_TOP - 4.5, 3);
  const seams = k.sideSeam(BODY, BODY_TOP - 4, P, 6);
  box("camera.body", BODY, BODY_Z + BAND_H, BODY_TOP - BODY_Z - BAND_H, {
    tone: "hi",
    steps: 6,
    bevel: 0,
    owner: "camera",
    inner: Ln(seams, { tone: "faint" }),
    extra: Ln(door, { tone: "lo" }) + Ln(doorInner, { tone: "faint" }) + Ln(frontPanel, { tone: "faint" }),
  });
}
box("camera.lid", LID, BODY_TOP, LID_H, {
  tone: "hi",
  steps: 6,
  bevel: 0.8,
  owner: "camera",
  extra: (() => {
    const screws = k.corners(LID, 4.4);
    return Ln(screws.map(([x, y]) => k.ring(x, y, 1.5, LID_TOP, P, 14)).join(""), { tone: "lo" }) + Dots(screws.map(([x, y]) => at([x, y, LID_TOP])), { size: 0.45 });
  })(),
});

// door hinges and latch
for (const [z0, z1] of [
  [DOOR.z0 + 3, DOOR.z0 + 10],
  [DOOR.z1 - 10, DOOR.z1 - 3],
])
  post("camera.hinge", 39.6, SIDE + 1.3, 1.3, z0, z1 - z0, { tone: "hi", steps: 16, owner: "camera" });
{
  const F = alongY([DOOR.x0 + 4.6, SIDE, (DOOR.z0 + DOOR.z1) / 2]);
  turned("camera.latch", F, [
    [0, 2.4],
    [1.2, 2.4],
    [1.2, 1.6],
    [3, 1.6],
  ], { tone: "hi", owner: "camera", extra: Ln(pathOf([at(G.pointOf(F, 3, 1.5, 0)), at(G.pointOf(F, 3, 1.5, Math.PI))]), { tone: "lo" }) });
}
// footage counter on the door
{
  const F = alongY([18, SIDE, (DOOR.z0 + DOOR.z1) / 2]);
  const face = 1.6;
  const minor = [];
  const major = [];
  for (let index = 0; index < 40; index++) {
    const t = (index / 40) * TAU;
    const big = index % 5 === 0;
    (big ? major : minor).push(pathOf([at(G.pointOf(F, face, 6.4, t)), at(G.pointOf(F, face, big ? 4.6 : 5.4, t))]));
  }
  const needle = pathOf([at(G.pointOf(F, face + 0.1, 1.6, 200 * DEG)), at(G.pointOf(F, face + 0.1, 5.6, 20 * DEG))]);
  turned("camera.counter", F, [
    [0, 8],
    [face, 8],
  ], {
    tone: "hi",
    owner: "camera",
    extra:
      Ln(G.circleOf(F, face, 6.4, P), { tone: "lo" }) +
      Ln(minor.join(""), { tone: "lo" }) +
      Ln(major.join(""), { tone: "mid" }) +
      Ln(G.circleOf(F, face, 7.3, P), { tone: "faint" }) +
      Ln(needle, { tone: "hi", free: "end" }) +
      Dots([at(G.pointOf(F, face + 0.1, 0, 0))], { size: 0.8, tone: "hi" }),
  });
}
// name plate
{
  const plan = { x: -42, y: SIDE, w: 26, d: 0.8, r: 0.3 };
  const z0 = BODY_Z + BAND_H + 1.6;
  const z1 = z0 + 8;
  const y = SIDE + 0.8;
  const rule = (x0, x1, z) => pathOf([at([x0, y, z]), at([x1, y, z])]);
  box("camera.nameplate", plan, z0, z1 - z0, {
    tone: "hi",
    steps: 2,
    bevel: 0,
    owner: "camera",
    extra:
      Ln(faceRect(onSide(y), plan.x + 1.2, plan.x + plan.w - 1.2, z0 + 1.2, z1 - 1.2, 0.8), { tone: "faint" }) +
      Ln(rule(plan.x + 5, plan.x + 21, z0 + 5.7) + rule(plan.x + 5, plan.x + 15, z0 + 4) + rule(plan.x + 5, plan.x + 18, z0 + 2.3), { tone: "lo", free: true }) +
      Dots([at([plan.x + 2.4, y, (z0 + z1) / 2]), at([plan.x + plan.w - 2.4, y, (z0 + z1) / 2])], { size: 0.45 }),
  });
}
// crank: boss, shaft, arm and wooden handle
{
  const F = alongY(CRANK_AT);
  turned("camera.crank-boss", F, [
    [0, 6.5],
    [2.6, 6.5],
    [2.6, 5],
    [3.4, 5],
  ], { tone: "hi", owner: "crank", extra: Dots(G.dotsOf(F, 3.4, 3.9, 6, P, { all: true, phase: 0.3 }), { size: 0.4 }) });
  turned("camera.crank-shaft", F, [
    [3.4, 2.2],
    [6, 2.2],
  ], { tone: "hi", owner: "crank" });
  const phi = Math.atan2(G.dot3(CRANK_DIR, F.v), G.dot3(CRANK_DIR, F.u));
  const arm = G.stadium(3.4, 2.3, CRANK_ARM).map(([u, v]) => [u * Math.cos(phi) - v * Math.sin(phi), u * Math.sin(phi) + v * Math.cos(phi)]);
  const armPaths = G.prismOf(F, arm, 6, 8.4, P);
  const end = G.add3(CRANK_AT, G.mul3(CRANK_DIR, CRANK_ARM));
  put("camera.crank-arm", G.pointOf(F, 7.2, 0, 0), S(armPaths, { tone: "hi" }) + Dots([at(G.pointOf(F, 8.4, 0, 0))], { size: 0.6, tone: "hi" }), [A.prism(F, arm, 6, 8.4, { owner: "crank" })]);
  const FH = alongY(end);
  turned("camera.crank-handle", FH, [
    [8.4, 1.3],
    [10, 1.3],
    [10, 2.4],
    [18.6, 2.4],
    [18.6, 1.9],
    [20, 1.9],
  ], { tone: "hi", owner: "crank", inner: Ln(G.arcOf(FH, 12, 2.4, P) + G.arcOf(FH, 17, 2.4, P), { tone: "faint" }) });
}
// side viewfinder: a long box with an objective at the front and an eyecup at the back
{
  const z0 = FINDER_Z[0];
  const z1 = FINDER_Z[1];
  const face = FINDER.y + FINDER.d;
  box("camera.finder", FINDER, z0, z1 - z0, {
    tone: "hi",
    steps: 3,
    bevel: 0.5,
    owner: "camera",
    extra:
      Ln(faceRect(onSide(face), FINDER.x + 3, FINDER.x + FINDER.w - 3, z0 + 2, z1 - 2, 1.2), { tone: "faint" }) +
      Dots([at([FINDER.x + 6, face, (z0 + z1) / 2]), at([FINDER.x + FINDER.w - 6, face, (z0 + z1) / 2])], { size: 0.45 }),
  });
  const mid = [FINDER.y + FINDER.d / 2, (z0 + z1) / 2];
  const FO = alongX([FINDER.x + FINDER.w, mid[0], mid[1]]);
  turned("camera.finder-objective", FO, [
    [0, 3.4],
    [2.4, 3.4],
  ], { tone: "hi", owner: "camera", extra: Ln(G.circleOf(FO, 2.4, 2.3, P), { tone: "lo" }) });
  const FE = alongNegX([FINDER.x, mid[0], mid[1]]);
  turned("camera.finder-eyecup", FE, [
    [0, 2.8],
    [2.6, 2.8],
    [2.6, 3.2],
    [7, 4.3],
  ], { tone: "hi", owner: "camera" });
  post("camera.finder-knob", FINDER.x + 14, mid[0], 2.2, z1, 2.6, { tone: "hi", steps: 20, owner: "camera", extra: Ln(k.knurl(FINDER.x + 14, mid[0], 2.2, z1, z1 + 2.6, 16, P, 0.4), { tone: "lo" }) });
}
// spirit level on the lid
{
  const plan = { x: 31, y: 16.5, w: 12, d: 5.4, r: 2.2 };
  const vial = k.insetPlan(plan, 1.3);
  box("camera.level", plan, LID_TOP, 2, {
    tone: "hi",
    steps: 6,
    bevel: 0,
    owner: "camera",
    extra: Ln(k.planOutline(vial, LID_TOP + 2, P, 6), { tone: "lo" }) + Ln(k.ring(plan.x + plan.w / 2 + 0.6, plan.y + plan.d / 2, 1.1, LID_TOP + 2, P, 16), { tone: "mid" }),
  });
}

// ---------------------------------------------------------------------------------------------
// 5. Lens turret: a three-lens plate, the long taking lens (focus and aperture rings, a flared hood
//    and the front glass, the one lit accent) and two short lenses.

{
  const F = alongX(TURRET.o);
  const bolts = [90 + 60, 90 - 60, 270].map((t) => at(G.pointOf(F, TURRET.t, TURRET.r - 2.4, (t + 0) * DEG)));
  turned("lens.turret", F, [
    [0, TURRET.r],
    [TURRET.t, TURRET.r],
  ], { tone: "hi", owner: "lens", extra: Dots(bolts, { size: 0.5 }) + Ln(G.circleOf(F, TURRET.t, TURRET.r - 1.2, P), { tone: "faint" }) });
  turned("lens.turret-hub", F, [
    [TURRET.t, 3.6],
    [TURRET.t + 2.4, 3.6],
  ], { tone: "hi", owner: "lens", extra: Faded(G.ribsOf(F, TURRET.t, TURRET.t + 2.4, 3.6, 20, P, { fade: FADE_RIBS }), { tone: "lo" }) + Dots([at(G.pointOf(F, TURRET.t + 2.4, 0, 0))], { size: 0.5 }) });
}
for (const o of SMALL_LENSES) {
  const F = alongX(o);
  turned("lens.small", F, [
    [0, 4.6],
    [2, 4.6],
    [2, 3.7],
    [6.5, 3.7],
    [6.5, 4.3],
    [9, 4.3],
  ], {
    tone: "hi",
    owner: "lens",
    inner: Ln(G.arcOf(F, 4.2, 3.7, P), { tone: "faint" }),
    extra: Ln(G.circleOf(F, 9, 3.4, P), { tone: "lo" }) + `<path class="iso-shade" data-shade="0" d="${G.circleOf(F, 9, 2.6, P)}"/>` + Ln(G.circleOf(F, 9, 2.6, P), { tone: "mid" }),
  });
}
{
  const F = alongX(LENS_AT);
  const HOOD = [28, 36];
  const hoodR = [7.6, 10.4];
  const profile = [
    [0, 9.6],
    [2.6, 9.6],
    [2.6, 7.6],
    [9, 7.6],
    [9, 8.9],
    [17, 8.9],
    [17, 7.9],
    [20, 7.9],
    [20, 8.4],
    [24, 8.4],
    [24, 7.6],
    [HOOD[0], hoodR[0]],
    [HOOD[1], hoodR[1]],
  ];
  // focus ring knurl, a focus scale rooted on the ring's back edge, and aperture marks
  const knurlRibs = G.ribsOf(F, 9, 17, 8.9, 64, P, { fade: FADE_RIBS, seams: true }).map((rib) => (rib.alpha === 1 ? rib : rib));
  const scale = G.ribsOf(F, 6.6, 9, 7.6, 36, P, { fade: [0.35, 0.75], phase: 0.08 });
  const aperture = G.ribsOf(F, 20, 22.2, 8.4, 24, P, { fade: [0.35, 0.75] });
  const lip = 9.7;
  const voidD = G.circleOf(F, HOOD[1], lip, P);
  const glass = G.disc(30.4, 31, 6.8, F, P);
  const glassId = "mc-lens-void";
  SVG_DEFS.push(`<clipPath id="${glassId}"><path d="${voidD}"/></clipPath>`);
  const inside =
    `<path class="iso-shade" data-shade="0" d="${voidD}"/>` +
    `<g clip-path="url(#${glassId})">` +
    Ln(G.circleOf(F, 33.2, 8.6, P), { tone: "faint" }) +
    S(glass, { tone: "hi", lit: true }) +
    Ln(G.circleOf(F, 31, 4.6, P), { tone: "faint" }) +
    Ln(pathOf(Array.from({ length: 13 }, (_, index) => at(G.pointOf(F, 31, 5.4, (120 + index * 6) * DEG)))), { tone: "lit", free: true }) +
    `</g>` +
    Ln(voidD, { tone: "hi" });
  turned("lens.taking", F, profile, {
    tone: "hi",
    owner: "lens",
    extra: Faded(knurlRibs, { tone: "lo" }) + Faded(scale, { tone: "lo" }) + Faded(aperture, { tone: "mid" }) + inside + Dots(G.dotsOf(F, 2.6, 8.6, 10, P, { fade: [0.04, 0.42] }), { size: 0.4 }),
  });
}

// ---------------------------------------------------------------------------------------------
// 6. Reels: a post and head on the lid, a spindle collar, two flanges with five spoked windows,
//    the film pack between them, a hub and a knurled nut; film strips run down into a light trap.

box("camera.throat", THROAT, LID_TOP, THROAT_TOP - LID_TOP, {
  tone: "hi",
  steps: 3,
  bevel: 0.4,
  owner: "camera",
  extra: FILM_X.map((x) => Ln(k.planOutline({ x: x - 0.9, y: REEL_Y.pack - 0.3, w: 1.8, d: REEL_Y.front - REEL_Y.pack + 0.6, r: 0.6 }, THROAT_TOP, P, 3), { tone: "mid" })).join(""),
});

function windows(rIn, rOut, spoke, count, phase) {
  const list = [];
  for (let index = 0; index < count; index++) {
    const a0 = phase + (index / count) * TAU;
    const a1 = phase + ((index + 1) / count) * TAU;
    const pts = [];
    const steps = 10;
    const o0 = a0 + Math.asin(spoke / 2 / rOut);
    const o1 = a1 - Math.asin(spoke / 2 / rOut);
    const i0 = a0 + Math.asin(spoke / 2 / rIn);
    const i1 = a1 - Math.asin(spoke / 2 / rIn);
    for (let j = 0; j <= steps; j++) {
      const t = o0 + ((o1 - o0) * j) / steps;
      pts.push([rOut * Math.cos(t), rOut * Math.sin(t)]);
    }
    for (let j = 0; j <= 4; j++) {
      const t = i1 + ((i0 - i1) * j) / 4;
      pts.push([rIn * Math.cos(t), rIn * Math.sin(t)]);
    }
    list.push(rounded(pts, 3));
  }
  return list;
}

REEL.x.forEach((cx, index) => {
  const owner = index === 0 ? "reel.feed" : "reel.take";
  const pack = REEL.packs[index];
  // mount: a foot on the lid, a post and a head block that carries the spindle
  box(`${owner}.foot`, { x: cx - 5, y: -4, w: 10, d: 8, r: 2 }, LID_TOP, 3, { tone: "hi", steps: 4, bevel: 0.4, owner, extra: Dots([at([cx - 3, 2.4, LID_TOP + 3]), at([cx + 3, 2.4, LID_TOP + 3])], { size: 0.4 }) });
  post(`${owner}.post`, cx, 0, 2.2, LID_TOP + 3, REEL.z - 7 - LID_TOP - 3, { tone: "hi", steps: 20, owner });
  box(`${owner}.head`, { x: cx - 3.6, y: -3, w: 7.2, d: 6, r: 1.2 }, REEL.z - 7, 14, { tone: "hi", steps: 3, bevel: 0.4, owner });
  const F = alongY([cx, 0, REEL.z]);
  disc(`${owner}.collar`, F, REEL_Y.collar, REEL_Y.back, 2.8, { tone: "hi", owner });
  disc(`${owner}.back`, F, REEL_Y.back, REEL_Y.pack, REEL.r, { tone: "hi", owner });
  disc(`${owner}.pack`, F, REEL_Y.pack, REEL_Y.front, pack, { tone: "hi", owner, crease: "lo" });
  // front flange with five windows. Through each window: the back flange's inner face, the film
  // pack's side (wound turns as faint rings), and the window's own wall.
  const wins = windows(8.6, REEL.r - 4, 4.4, 5, (index ? 18 : -8) * DEG);
  const face = REEL_Y.face;
  const toScreen = (s) => (list) => pathOf(list.map(([u, v]) => at(G.pointOf(F, s, Math.hypot(u, v), Math.atan2(v, u)))), true);
  const front = wins.map(toScreen(face)).join("");
  const wall = wins.map(toScreen(REEL_Y.front)).join("");
  const clip = `mc-reel-${index}`;
  SVG_DEFS.push(`<clipPath id="${clip}"><path d="${front}"/></clipPath>`);
  const turns = [];
  for (let r = pack - 2.2; r > 8; r -= 2.6) turns.push(G.circleOf(F, REEL_Y.front, r, P));
  const seen =
    `<g clip-path="url(#${clip})">` +
    `<path class="iso-shade" data-shade="2" d="${front}"/>` +
    `<path class="iso-shade" data-shade="0" d="${G.circleOf(F, REEL_Y.front, pack, P)}"/>` +
    Ln(turns.join(""), { tone: "faint" }) +
    Ln(G.circleOf(F, REEL_Y.front, pack, P), { tone: "lo" }) +
    Ln(wall, { tone: "lo" }) +
    `</g>` +
    Ln(front, { tone: "hi" });
  const rivets = Array.from({ length: 5 }, (_, j) => (index ? 18 : -8) * DEG + (j / 5) * TAU).map((t) => at(G.pointOf(F, face, REEL.r - 2, t)));
  disc(`${owner}.front`, F, REEL_Y.front, face, REEL.r, {
    tone: "hi",
    owner,
    extra: seen + Ln(G.circleOf(F, face, REEL.r - 2, P), { tone: "faint" }) + Dots(rivets, { size: 0.45 }),
  });
  disc(`${owner}.hub`, F, face, REEL_Y.hub, 5.6, { tone: "hi", owner, extra: Dots(G.dotsOf(F, REEL_Y.hub, 4.3, 3, P, { all: true, phase: 0.5 }), { size: 0.4 }) });
  disc(`${owner}.nut`, F, REEL_Y.hub, REEL_Y.nut, 3.2, {
    tone: "hi",
    owner,
    extra: Faded(G.ribsOf(F, REEL_Y.hub, REEL_Y.nut, 3.2, 18, P, { fade: FADE_RIBS }), { tone: "lo" }) + Dots([at(G.pointOf(F, REEL_Y.nut, 0, 0))], { size: 0.55, tone: "hi" }),
  });

  // film strip: tangent off the pack's inner side, straight down into its slot in the light trap
  const C = [cx, REEL.z];
  const T = [FILM_X[index], THROAT_TOP];
  const d = Math.hypot(T[0] - C[0], T[1] - C[1]);
  const base = Math.atan2(T[1] - C[1], T[0] - C[0]);
  const alpha = Math.acos(pack / d);
  const tangent = index === 0 ? base - alpha + TAU : base + alpha; // the inner side of each reel
  const Q = [C[0] + pack * Math.cos(tangent), C[1] + pack * Math.sin(tangent)];
  const y0 = REEL_Y.pack + 0.2;
  const y1 = REEL_Y.front - 0.2;
  const quad = [at([Q[0], y0, Q[1]]), at([Q[0], y1, Q[1]]), at([T[0], y1, T[1]]), at([T[0], y0, T[1]])];
  const dir = [T[0] - Q[0], T[1] - Q[1]];
  const len = Math.hypot(...dir);
  const along = (s, y) => at([Q[0] + (dir[0] * s) / len, y, Q[1] + (dir[1] * s) / len]);
  const holes = [];
  for (let s = 1.6; s < len - 0.8; s += 2.2) holes.push(along(s, y0 + 0.9), along(s, y1 - 0.9));
  const frames = [];
  for (let s = 4; s < len - 1; s += 6.4) frames.push(pathOf([along(s, y0 + 1.8), along(s, y1 - 1.8)]));
  const normal = [dir[1] / len, 0, -dir[0] / len];
  const mid = [(Q[0] + T[0]) / 2, (y0 + y1) / 2, (Q[1] + T[1]) / 2];
  put(
    `${owner}.film`,
    mid,
    `<g class="iso-solid"><path class="iso-fill" d="${pathOf(quad, true)}"/><path class="iso-shade" data-shade="0" d="${pathOf(quad, true)}"/>` +
      Ln(pathOf([along(0, y0 + 1.8), along(len, y0 + 1.8)]) + pathOf([along(0, y1 - 1.8), along(len, y1 - 1.8)]), { tone: "faint" }) +
      Ln(frames.join(""), { tone: "faint" }) +
      `<path class="iso-line iso-edge" data-tone="hi" d="${pathOf(quad, true)}"/></g>` +
      Dots(holes, { size: 0.32, tone: "lo" }),
    [A.orientedBox(mid, [[dir[0] / len, 0, dir[1] / len], [0, 1, 0], normal], [len / 2, (y1 - y0) / 2, 0.15], { owner })],
  );
});

// ---------------------------------------------------------------------------------------------
// Settle the painter's order from the recorded shapes, then write the SVG.

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);
A.auditOrExit(R, P);

const body = [`<defs>${SVG_DEFS.join("")}</defs>`, halo, ...R.items.map((item) => item.svg), ...AFTER];
const svg = k.figureSvg({
  width: W,
  height: H,
  label: "A vintage hand-cranked movie camera with two film reels on top, a long lens and a side crank, on a small tripod and a round plinth.",
  body,
  standalone: "light",
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
writeFileSync(
  PREVIEW,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Movie camera</title>` +
    `<style>*{box-sizing:border-box}html,body{margin:0;background:#fbfbfa}.frame{width:min(960px,100% - 32px);margin:40px auto}.frame svg{display:block;width:100%;height:auto}</style></head>` +
    `<body><div class="frame">${svg}</div></body></html>`,
);
console.log(`wrote ${OUT} (${(svg.length / 1024).toFixed(1)} KB, ${R.items.length} items, ${R.solids.length} solids)`);

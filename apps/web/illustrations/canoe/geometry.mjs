// World layout for the canoe diorama. World units: x, y on the floor, z up (about 1 px).
// The river and the canoe run along E_A, the diagonal of the square base that reads as
// screen-horizontal at azimuth 45, so the canoe is seen broadside. E_C points at the viewer.
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";

export const WIDTH = 480;
export const HEIGHT = 360;

export const E_A = [Math.SQRT1_2, -Math.SQRT1_2, 0];
export const E_C = [Math.SQRT1_2, Math.SQRT1_2, 0];
export const UP = [0, 0, 1];
export const local = (a, c, z) => [a * E_A[0] + c * E_C[0], a * E_A[1] + c * E_C[1], z];
export const toLocal = ([x, y]) => [x * E_A[0] + y * E_A[1], x * E_C[0] + y * E_C[1]];

// Base: a wooden plinth on four feet, a ground layer whose top is the water, banks in contour layers.
export const PLINTH = { x: -104, y: -104, w: 208, d: 208, r: 6 };
export const PLINTH_Z = -15;
export const PLINTH_H = 8;
export const FOOT_H = 5;
export const GROUND = k.insetPlan(PLINTH, 4);
export const GROUND_Z = PLINTH_Z + PLINTH_H;
export const WATER = 0;

// Canoe hull (canoe-local a along, c across, z up). A 16 ft cedar-strip canoe at ~1.28 in per unit.
export const HALF = 74;
export const B0 = 14.4;
export const KEEL = WATER - 3.4;
export const DEPTH = 10.6;
export const SHEER = 6.4;
export const STEM_FROM = 0.74;
export const C0 = 3; // the canoe sits a little toward the near bank

const tOf = (u) => u * 2 - 1;
export const beamAt = (t) => B0 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.3)), 0.8);
export const gunwaleAt = (t) => KEEL + DEPTH + SHEER * Math.pow(Math.abs(t), 3);
const TOP_END = gunwaleAt(1);
export const keelAt = (t) => {
  const at = Math.abs(t);
  let z = KEEL + 0.9 * t * t;
  if (at > STEM_FROM) {
    const u = Math.min(1, (at - STEM_FROM) / (1 - STEM_FROM));
    z += (TOP_END - KEEL - 0.9) * (1 - Math.sqrt(1 - u * u));
  }
  return Math.min(z, gunwaleAt(t));
};
const EXP = 2 / 2.5;
const sgn = (v) => (v < 0 ? -1 : 1);
// u in [0, 1] stern to bow, w in [0, 1] far gunwale to near gunwale.
export function hullPoint(u, w) {
  const t = tOf(u);
  const phi = (w * 2 - 1) * (Math.PI / 2);
  const s = sgn(Math.sin(phi)) * Math.pow(Math.abs(Math.sin(phi)), EXP);
  const c = Math.pow(Math.abs(Math.cos(phi)), EXP);
  const g = gunwaleAt(t);
  const d = g - keelAt(t);
  return local(t * HALF, C0 + beamAt(t) * s, g - d * c);
}
export function hullOutward(u, w) {
  const t = tOf(u);
  const g = gunwaleAt(t);
  const d = g - keelAt(t);
  const p = hullPoint(u, w);
  const axis = local(t * HALF, C0, g - d * 0.55);
  const out = G.sub3(p, axis);
  if (G.len3(out) < 1e-3) return G.unit3([...G.mul3(E_C, w - 0.5), -0.3]);
  return G.unit3(out);
}
export const gunwalePoint = (u, side, inset = 0, lift = 0) => {
  const t = tOf(u);
  return local(t * HALF, C0 + side * Math.max(0, beamAt(t) - inset), gunwaleAt(t) + lift);
};
export const aOf = (u) => tOf(u) * HALF;
export const uOf = (a) => (a / HALF + 1) / 2;

// The three paddlers and the furniture, along the canoe.
export const BOW_SEAT = 47;
export const STERN_SEAT = -54;
export const MID_SEAT = -3;
export const THWARTS = [22, -29];

export const P = k.fitProjection(
  [
    ...k.boxCorners(PLINTH, PLINTH_Z - FOOT_H, 0),
    local(0, C0, 36),
    local(-60, C0, 36),
    local(60, C0, 36),
  ],
  WIDTH,
  HEIGHT,
  { pad: 24, azimuth: 45 },
);
export const at = (point) => k.iso(point, P);
export const V = G.viewOf(P);
export const KS = G.scaleOf(P);

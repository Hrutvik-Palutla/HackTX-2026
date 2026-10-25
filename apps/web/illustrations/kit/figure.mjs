// Turned-wood figurines for the dioramas: a lathe torso, a ball head, tube limbs and ball hands.
// figure(...) returns parts [{ name, at, svg, shapes }] so a scene can depth-sort them with its other items.
import * as k from "./iso-kit.mjs";
import * as G from "./lathe.mjs";
import * as A from "./audit.mjs";
import { tubePieces, tubeSvg } from "./tube.mjs";

const UPV = [0, 0, 1];
const flat = (d) => G.unit3([d[0], d[1], 0]);

/** Elbow/knee for a two-segment limb from a to b, bending toward `bend`. */
export function joint(a, b, length, bend) {
  const d = G.sub3(b, a);
  const span = G.len3(d);
  const mid = G.lerp3(a, b, 0.5);
  if (span >= length * 2) return mid;
  const axis = G.unit3(d);
  const off = G.unit3(G.sub3(bend, G.mul3(axis, G.dot3(bend, axis))));
  return G.add3(mid, G.mul3(off, Math.sqrt(length * length - (span / 2) ** 2)));
}

/**
 * hip: world point at the seat. facing: horizontal direction the chest faces. u: size (1 ≈ cm).
 * hands: [left, right] world targets. lean: forward tilt (radians, negative leans back).
 * legs: "seated" | "standing" | "none". hair: "bun" | "none".
 */
export function figure(P, { id, hip, facing, u = 1, hands, lean = 0.08, legs = "seated", feet = null, floor = null, hair = "none", tone = "hi" }) {
  const f = flat(facing);
  const side = G.unit3(G.cross3(UPV, f)); // figure's left
  const spine = G.unit3(G.add3(G.mul3(f, Math.sin(lean)), G.mul3(UPV, Math.cos(lean))));
  const F = G.frameAlong(hip, spine);
  const torso = [[0, 0], [0, 13 * u], [9 * u, 12.5 * u, 1], [30 * u, 15.5 * u, 1], [42 * u, 14.5 * u, 1], [48 * u, 9 * u, 1], [50 * u, 4.6 * u], [54 * u, 4.2 * u], [54 * u, 0]];
  const along = (s) => G.add3(hip, G.mul3(spine, s * u));
  const headAt = G.add3(along(54 + 10), G.mul3(f, 1.5 * u));
  const HEAD = 10.5 * u;
  const shoulder = (sgn) => G.add3(along(43), G.mul3(side, sgn * 14 * u));
  const parts = [];
  const put = (name, at, svg, shapes) => parts.push({ name: `${id}.${name}`, at, svg, shapes });
  const limb = (name, points, r) => {
    tubePieces(points, r, P, { maxLength: 18 }).forEach((piece, index) => put(`${name}:${index}`, piece.mid, tubeSvg(piece, { tone }), [A.tube(piece.points, piece.radii)]));
  };
  const ball = (name, at, r, t = tone) => put(name, at, k.solidSvg(G.sphereOf(at, r, P), { tone: t, crease: "none" }), [A.ball(at, r)]);

  if (legs !== "none") {
    for (const sgn of [1, -1]) {
      const h = G.add3(hip, G.mul3(side, sgn * 7 * u));
      if (legs === "seated") {
        const knee = G.add3(G.add3(h, G.mul3(f, 38 * u)), [0, 0, 2 * u]);
        const foot = floor === null ? G.add3(knee, [0, 0, -40 * u]) : [knee[0] + f[0] * 5 * u, knee[1] + f[1] * 5 * u, floor];
        limb(`leg${sgn}`, [h, knee, foot], 6.2 * u);
      } else {
        const foot = G.add3(h, [0, 0, -hip[2] + (feet ?? 0)]);
        limb(`leg${sgn}`, [h, G.lerp3(h, foot, 0.5), foot], 6.4 * u);
      }
    }
  }
  put("torso", along(26), k.solidSvg(G.solidOf(torso, F, P), { tone, crease: "none" }), [A.solid(F, torso)]);
  ball("head", headAt, HEAD);
  if (hair === "bun") ball("bun", G.add3(headAt, G.add3(G.mul3(f, -8 * u), [0, 0, 6 * u])), 4.6 * u, "mid");
  hands.forEach((hand, index) => {
    const sgn = index === 0 ? 1 : -1;
    const s = shoulder(sgn);
    const elbow = joint(s, hand, 26 * u, G.add3(G.mul3(side, sgn * 0.5), [0, 0, -1]));
    limb(`arm${sgn}`, [s, elbow, hand], 3.8 * u);
    ball(`hand${sgn}`, hand, 4.2 * u);
  });
  return parts;
}

/** Screen-space speech bubble with three typing dots, pinned above a world point. */
export function bubbleSvg(P, at, { w = 30, h = 16, dx = 10, dy = -26 } = {}) {
  const [x, y] = k.iso(at, P);
  const bx = x + dx;
  const by = y + dy;
  const r = h / 2;
  const d = `M${bx + r},${by} H${bx + w - r} A${r},${r} 0 0 1 ${bx + w - r},${by + h} H${bx + 9} L${bx + 2},${by + h + 6} L${bx + 5},${by + h - 1} A${r},${r} 0 0 1 ${bx + r},${by}Z`;
  const dots = [0, 1, 2].map((i) => `<circle class="sq-typing" style="animation-delay:${i * 0.18}s" cx="${(bx + w / 2 + (i - 1) * 6.5).toFixed(2)}" cy="${(by + r).toFixed(2)}" r="1.9"/>`).join("");
  return `<g class="sq-bubble"><path d="${d}" fill="var(--anatomy-paper,#fbfbfa)" stroke="var(--anatomy-strong,#17171a)" stroke-width="0.8"/>${dots}</g>`;
}

export const MOTION_CSS = `<style>
.sq-typing{fill:#a3834f;animation:sq-typing 1.4s ease-in-out infinite}
@keyframes sq-typing{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-1.5px)}}
.sq-ripple{transform-box:fill-box;transform-origin:center;animation:sq-ripple 3.2s ease-out infinite}
@keyframes sq-ripple{0%{opacity:.9;transform:scale(.55)}100%{opacity:0;transform:scale(1.35)}}
.sq-note{animation:sq-note 4.8s ease-in-out infinite;opacity:0}
@keyframes sq-note{0%{opacity:0;transform:translate(0,4px)}20%{opacity:.9}100%{opacity:0;transform:translate(10px,-26px)}}
.sq-spin>g{opacity:0;animation:sq-step .9s step-end infinite}
@keyframes sq-step{0%{opacity:1}16.667%{opacity:0}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.sq-typing,.sq-ripple,.sq-note,.sq-spin>g{animation:none}.sq-note{opacity:.8}.sq-spin>g:first-child{opacity:1}}
</style>`;

/** Six rotation frames shown one at a time (a turning part drawn honestly at each angle). frame(i) returns svg. */
export function spinFrames(frame, count = 6, seconds = 0.9) {
  return `<g class="sq-spin">${Array.from({ length: count }, (_, i) => `<g style="animation-delay:${(-(count - i) * seconds / count).toFixed(3)}s">${frame(i)}</g>`).join("")}</g>`;
}

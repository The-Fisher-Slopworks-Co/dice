// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { Vector3 } from "three";
import { blankUv, uvOf, type Atlas } from "./atlas.ts";
import { planeBasis } from "./hull.ts";
import type { DieSpec } from "./shapes.ts";

export interface DieMeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
}

/**
 * Turns the sharp polyhedron into a die with rounded edges. Every face shrinks
 * inward by the bevel width; the strips between neighbouring faces and the
 * small caps over each corner fill the gaps. The strips borrow the normals of
 * the faces they join, so lighting rolls smoothly over the edge the way it
 * does on a tumbled resin die.
 */
export function buildDieMesh(spec: DieSpec, atlas: Atlas): DieMeshData {
  const { hull, bevel } = spec;
  const out: DieMeshData = { positions: [], normals: [], uvs: [] };
  const blank = blankUv(atlas);

  const normalAt = (f: number, p: Vector3): Vector3 => {
    // Only the coin is smooth, and its rim curves around the y axis.
    if (spec.smooth.has(f)) return new Vector3(p.x, 0, p.z).normalize();
    return hull.faces[f]!.normal;
  };

  // inset[f][k]: corner k of face f after moving its edges in by `bevel`.
  const inset = hull.faces.map((face) => {
    const pts = face.verts.map((i) => hull.points[i]!);
    const { e1, e2 } = planeBasis(face.normal);
    const flat = pts.map((p) => {
      const d = p.clone().sub(face.center);
      return [d.dot(e1), d.dot(e2)] as const;
    });
    const n = flat.length;
    const inward = flat.map((a, k) => {
      const b = flat[(k + 1) % n]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len] as const;
    });
    return flat.map((p, k) => {
      const n1 = inward[(k + n - 1) % n]!;
      const n2 = inward[k]!;
      const s = bevel / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      const x = p[0] + (n1[0] + n2[0]) * s;
      const y = p[1] + (n1[1] + n2[1]) * s;
      return face.center.clone().addScaledVector(e1, x).addScaledVector(e2, y);
    });
  });

  const push = (p: Vector3, n: Vector3, uv: readonly [number, number]) => {
    out.positions.push(p.x, p.y, p.z);
    out.normals.push(n.x, n.y, n.z);
    out.uvs.push(uv[0], uv[1]);
  };
  // Emits a triangle, flipping it if needed so it faces `outward`.
  const tri = (
    a: [Vector3, Vector3],
    b: [Vector3, Vector3],
    c: [Vector3, Vector3],
    outward: Vector3,
    uvs?: [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ],
  ) => {
    const cross = b[0].clone().sub(a[0]).cross(c[0].clone().sub(a[0]));
    const [u0, u1, u2] = uvs ?? [blank, blank, blank];
    if (cross.dot(outward) >= 0) {
      push(a[0], a[1], u0);
      push(b[0], b[1], u1);
      push(c[0], c[1], u2);
    } else {
      push(a[0], a[1], u0);
      push(c[0], c[1], u2);
      push(b[0], b[1], u1);
    }
  };

  // 1. The faces themselves, carrying the numbers.
  hull.faces.forEach((face, f) => {
    const cell = atlas.cells.get(f);
    const pts = inset[f]!;
    const uv = (p: Vector3) => (cell ? uvOf(atlas, cell, p) : blank);
    for (let k = 1; k < pts.length - 1; k++) {
      const a = pts[0]!;
      const b = pts[k]!;
      const c = pts[k + 1]!;
      tri(
        [a, normalAt(f, a)],
        [b, normalAt(f, b)],
        [c, normalAt(f, c)],
        face.normal,
        [uv(a), uv(b), uv(c)],
      );
    }
  });

  // 2. A strip along every edge, between the two shrunken faces.
  const edges = new Map<string, { f: number; a: number; b: number }>();
  hull.faces.forEach((face, f) => {
    const n = face.verts.length;
    for (let k = 0; k < n; k++) {
      const va = face.verts[k]!;
      const vb = face.verts[(k + 1) % n]!;
      const other = edges.get(`${vb}-${va}`);
      if (!other) {
        edges.set(`${va}-${vb}`, { f, a: k, b: (k + 1) % n });
        continue;
      }
      const pa = inset[f]![k]!;
      const pb = inset[f]![(k + 1) % n]!;
      const qa = inset[other.f]![other.b]!;
      const qb = inset[other.f]![other.a]!;
      const outward = face.normal.clone().add(hull.faces[other.f]!.normal);
      const A: [Vector3, Vector3] = [pa, normalAt(f, pa)];
      const B: [Vector3, Vector3] = [pb, normalAt(f, pb)];
      const C: [Vector3, Vector3] = [qb, normalAt(other.f, qb)];
      const D: [Vector3, Vector3] = [qa, normalAt(other.f, qa)];
      tri(A, B, C, outward);
      tri(A, C, D, outward);
    }
  });

  // 3. A cap over every corner, fanned around its centre.
  hull.points.forEach((point, id) => {
    const around: { p: Vector3; n: Vector3 }[] = [];
    hull.faces.forEach((face, f) => {
      const k = face.verts.indexOf(id);
      if (k >= 0)
        around.push({ p: inset[f]![k]!, n: normalAt(f, inset[f]![k]!) });
    });
    const axis = around.reduce((s, c) => s.add(c.n), new Vector3()).normalize();
    const mid = around.reduce((s, c) => s.add(c.p), new Vector3());
    mid.divideScalar(around.length);
    const { e1, e2 } = planeBasis(axis);
    const angle = (p: Vector3) => {
      const d = p.clone().sub(point);
      return Math.atan2(d.dot(e2), d.dot(e1));
    };
    around.sort((a, b) => angle(a.p) - angle(b.p));
    if (around.length === 3) {
      const [a, b, c] = around as [
        (typeof around)[0],
        (typeof around)[0],
        (typeof around)[0],
      ];
      tri([a.p, a.n], [b.p, b.n], [c.p, c.n], axis);
      return;
    }
    for (let k = 0; k < around.length; k++) {
      const a = around[k]!;
      const b = around[(k + 1) % around.length]!;
      tri([mid, axis], [a.p, a.n], [b.p, b.n], axis);
    }
  });

  return out;
}

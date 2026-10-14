// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { Vector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";

export interface Face {
  /** Indices into `Hull.points`, counter-clockwise seen from outside. */
  verts: number[];
  normal: Vector3;
  center: Vector3;
}

export interface Hull {
  points: Vector3[];
  faces: Face[];
}

const PLANE_EPS = 1e-5;

/**
 * Convex hull of a point cloud with coplanar triangles merged back into
 * polygons, so a cube has six square faces rather than twelve triangles. Both
 * the number layout and cannon's ConvexPolyhedron want real faces.
 */
export function convexHull(input: readonly Vector3[]): Hull {
  const unique = dedupe(input);
  const quick = new ConvexHull().setFromPoints(unique);

  const groups: { normal: Vector3; constant: number; ids: Set<number> }[] = [];
  const indexOf = new Map<Vector3, number>(unique.map((p, i) => [p, i]));

  for (const face of quick.faces) {
    const ids: number[] = [];
    let edge = face.edge;
    do {
      const id = indexOf.get(edge.head().point);
      if (id === undefined) throw new Error("hull vertex outside input");
      ids.push(id);
      edge = edge.next;
    } while (edge !== face.edge);

    const group = groups.find(
      (g) =>
        g.normal.dot(face.normal) > 1 - PLANE_EPS &&
        Math.abs(g.constant - face.constant) < PLANE_EPS * 10,
    );
    if (group) for (const id of ids) group.ids.add(id);
    else
      groups.push({
        normal: face.normal.clone(),
        constant: face.constant,
        ids: new Set(ids),
      });
  }

  // Re-index so the hull only carries the points it actually uses.
  const used = [...new Set(groups.flatMap((g) => [...g.ids]))].sort(
    (a, b) => a - b,
  );
  const remap = new Map(used.map((old, i) => [old, i]));
  const points = used.map((i) => unique[i]!.clone());

  const faces = groups.map((g) => {
    const ids = [...g.ids].map((i) => remap.get(i)!);
    const center = new Vector3();
    for (const i of ids) center.add(points[i]!);
    center.divideScalar(ids.length);
    const { e1, e2 } = planeBasis(g.normal);
    const angle = (i: number) => {
      const d = points[i]!.clone().sub(center);
      return Math.atan2(d.dot(e2), d.dot(e1));
    };
    ids.sort((a, b) => angle(a) - angle(b));
    return { verts: ids, normal: g.normal.clone().normalize(), center };
  });

  return { points, faces };
}

/**
 * An orthonormal in-plane basis where `e2 = normal × e1`, so increasing angle
 * runs counter-clockwise when looking at the plane from the normal's side.
 */
export function planeBasis(
  normal: Vector3,
  hint?: Vector3,
): { e1: Vector3; e2: Vector3 } {
  const e1 = (hint ?? anyPerpendicular(normal)).clone();
  e1.addScaledVector(normal, -e1.dot(normal)).normalize();
  const e2 = new Vector3().crossVectors(normal, e1).normalize();
  return { e1, e2 };
}

function anyPerpendicular(n: Vector3): Vector3 {
  const axis =
    Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return axis.cross(n);
}

function dedupe(points: readonly Vector3[]): Vector3[] {
  const seen = new Map<string, Vector3>();
  for (const p of points) {
    const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
    if (!seen.has(key)) seen.set(key, p.clone());
  }
  return [...seen.values()];
}

/** Distance from the face center to its nearest edge. */
export function inradius(hull: Hull, face: Face): number {
  let best = Infinity;
  const n = face.verts.length;
  for (let i = 0; i < n; i++) {
    const a = hull.points[face.verts[i]!]!;
    const b = hull.points[face.verts[(i + 1) % n]!]!;
    const ab = b.clone().sub(a);
    const t = face.center.clone().sub(a).dot(ab) / ab.lengthSq();
    const closest = a.clone().addScaledVector(ab, t);
    best = Math.min(best, closest.distanceTo(face.center));
  }
  return best;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { Vector3 } from "three";
import { convexHull, inradius, type Hull } from "./hull.ts";

/**
 * Every die on offer: the even counts, which all have a shape whose faces are
 * alike, plus a d1 for fun. Odd counts have no such shape.
 */
export const SIDES: readonly number[] = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

/** A direction in the die's own frame and the value it shows when it is up. */
interface Reading {
  dir: Vector3;
  value: number;
}

/** A number printed flat on a face. */
export interface Label {
  face: number;
  at: Vector3;
  /** Unit vector in the face plane pointing to the top of the glyphs. */
  up: Vector3;
  /** Cap height in world units. */
  size: number;
  text: string;
  /** Marks 6 and 9 apart on dice where both exist. */
  underline: boolean;
}

/**
 * How a value is read off the die once it stops: the face pointing up
 * (cube, d20 …) or the vertex pointing up (d4). A d1 reads 1 whatever.
 */
type ReadBy = "face" | "vertex" | "any";

export interface DieSpec {
  sides: number;
  shape: "poly" | "sphere";
  readBy: ReadBy;
  hull: Hull;
  labels: Label[];
  readings: Reading[];
  /** Faces shaded as one curved surface (a coin's rim). */
  smooth: ReadonlySet<number>;
  /** Width of the rounded edge, world units. */
  bevel: number;
  /** Bounding-sphere radius. */
  radius: number;
  /**
   * Points whose convex hull is the collision shape. Sharp-edged on purpose:
   * the drawn bevel is flat, and a die could rest on a flat bevel where a
   * real, rounded edge would tip it over. Faces lie in the same planes as
   * the drawn ones, so a die at rest sits exactly on the felt either way.
   */
  collision: Vector3[];
  /**
   * How far below the shape's centre the weight sits. Only the d1 has any:
   * it is a weighted ball, a roly-poly that always rights itself 1 up.
   */
  ballast: number;
  /**
   * Principal moments of inertia per unit mass about the centre of mass,
   * y up. Left out, the physics takes the die for a box filling its bounds,
   * which is close for a solid but far off for a ball with a slug inside.
   */
  inertia?: Vector3;
}

const UP = new Vector3(0, 1, 0);
const PHI = (1 + Math.sqrt(5)) / 2;

export function isValidSides(n: number): boolean {
  return SIDES.includes(n);
}

export function dieSpec(sides: number): DieSpec {
  if (!isValidSides(sides)) throw new RangeError(`no d${sides}`);
  switch (sides) {
    case 1:
      return sphere();
    case 2:
      return coin();
    case 4:
      return tetrahedron();
    case 6:
      return faceDie(6, cubePoints(), 1.2);
    case 8:
      return faceDie(8, octahedronPoints(), 1.3);
    case 12:
      return faceDie(12, dodecahedronPoints(), 1.25);
    case 20:
      return faceDie(20, icosahedronPoints(), 1.3);
    default:
      return faceDie(sides, trapezohedronPoints(sides / 2), 1.25);
  }
}

// ------------------------------------------------------------------ shapes

function cubePoints(): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(v(x, y, z));
  return out;
}

function octahedronPoints(): Vector3[] {
  return [
    v(1, 0, 0),
    v(-1, 0, 0),
    v(0, 1, 0),
    v(0, -1, 0),
    v(0, 0, 1),
    v(0, 0, -1),
  ];
}

function dodecahedronPoints(): Vector3[] {
  const out = cubePoints();
  const a = 1 / PHI;
  for (const s of [-1, 1])
    for (const t of [-1, 1])
      out.push(
        v(0, s * a, t * PHI),
        v(s * a, t * PHI, 0),
        v(s * PHI, 0, t * a),
      );
  return out;
}

function icosahedronPoints(): Vector3[] {
  const out: Vector3[] = [];
  for (const s of [-1, 1])
    for (const t of [-1, 1])
      out.push(v(0, s, t * PHI), v(s, t * PHI, 0), v(s * PHI, 0, t));
  return out;
}

/**
 * The d10 family: two apexes and a zig-zag ring of 2n vertices, giving 2n kite
 * faces. The apex height is the one that keeps each kite planar.
 */
function trapezohedronPoints(n: number): Vector3[] {
  const a = Math.PI / n;
  const c = 0.9 * ((1 - Math.cos(a)) / (1 + Math.cos(a)));
  const h = (c * (1 + Math.cos(a))) / (1 - Math.cos(a));
  const out = [v(0, h, 0), v(0, -h, 0)];
  for (let k = 0; k < n; k++) {
    out.push(v(Math.cos(2 * k * a), c, Math.sin(2 * k * a)));
    out.push(v(Math.cos((2 * k + 1) * a), -c, Math.sin((2 * k + 1) * a)));
  }
  return out;
}

/**
 * The d1 is cast resin with its bottom cap filled with tungsten-loaded
 * resin, the way a roly-poly carries its weight in a heavy base rather than
 * at a single point. Cap height is a fraction of the ball's diameter;
 * densities are g/cm³.
 */
const RESIN = 1.2;
const BASE = 11;
const BASE_HEIGHT = 0.3;

function sphere(): DieSpec {
  const radius = 0.85;
  // Sum the ball up cell by cell, on a unit sphere: its mass, how low that
  // mass sits, and how it resists turning about its centre of mass.
  const n = 48;
  let mass = 0;
  let moment = 0;
  let axial = 0;
  let across = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const [x, y, z] = [i, j, k].map((c) => ((c + 0.5) / n) * 2 - 1) as [
          number,
          number,
          number,
        ];
        if (x * x + y * y + z * z > 1) continue;
        const m = y < BASE_HEIGHT * 2 - 1 ? BASE : RESIN;
        mass += m;
        moment += m * y;
        axial += m * (x * x + z * z);
        across += m * (y * y + z * z);
      }
    }
  }
  const low = -moment / mass;
  // Parallel axis: from the ball's centre to the lower centre of mass.
  across -= mass * low * low;
  const scale = radius ** 2 / mass;
  return {
    sides: 1,
    shape: "sphere",
    readBy: "any",
    hull: { points: [], faces: [] },
    labels: [],
    readings: [{ dir: UP.clone(), value: 1 }],
    smooth: new Set(),
    bevel: 0,
    radius,
    collision: [],
    ballast: radius * low,
    inertia: v(across * scale, axial * scale, across * scale),
  };
}

/** d2: a thick coin, heads 1 and tails 2. */
function coin(): DieSpec {
  const segments = 40;
  const r = 1.15;
  const half = 0.13;
  const points: Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    points.push(v(r * Math.cos(t), half, r * Math.sin(t)));
    points.push(v(r * Math.cos(t), -half, r * Math.sin(t)));
  }
  const hull = convexHull(points);
  const labels: Label[] = [];
  const smooth = new Set<number>();
  hull.faces.forEach((face, i) => {
    if (Math.abs(face.normal.y) < 0.5) {
      smooth.add(i);
      return;
    }
    const heads = face.normal.y > 0;
    labels.push({
      face: i,
      at: face.center.clone(),
      up: v(0, 0, heads ? -1 : 1),
      size: r * 0.85,
      text: heads ? "1" : "2",
      underline: false,
    });
  });
  return {
    sides: 2,
    shape: "poly",
    readBy: "face",
    hull,
    labels,
    readings: [
      { dir: v(0, 1, 0), value: 1 },
      { dir: v(0, -1, 0), value: 2 },
    ],
    smooth,
    bevel: 0.06,
    radius: r,
    collision: coinRim(r, half),
    ballast: 0,
  };
}

/**
 * A coin's rim bulges like a barrel, so it cannot stand on edge the way a
 * flat-rimmed cylinder in a physics engine happily does.
 */
function coinRim(r: number, half: number): Vector3[] {
  const rings: [number, number][] = [
    [half, r - 0.06],
    [half * 0.55, r - 0.012],
    [0, r],
    [-half * 0.55, r - 0.012],
    [-half, r - 0.06],
  ];
  const out: Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    for (const [y, ring] of rings)
      out.push(v(ring * Math.cos(t), y, ring * Math.sin(t)));
  }
  return out;
}

/** d4: read by the vertex on top, so each face carries three numbers. */
function tetrahedron(): DieSpec {
  const hull = convexHull(
    scaleTo([v(1, 1, 1), v(1, -1, -1), v(-1, 1, -1), v(-1, -1, 1)], 1.5),
  );
  const labels: Label[] = [];
  hull.faces.forEach((face, f) => {
    const size = inradius(hull, face) * 0.62;
    for (const id of face.verts) {
      const toVertex = hull.points[id]!.clone().sub(face.center);
      labels.push({
        face: f,
        at: face.center.clone().addScaledVector(toVertex, 0.52),
        up: toVertex.normalize(),
        size,
        text: String(id + 1),
        underline: false,
      });
    }
  });
  return finish(4, "vertex", hull, labels, {
    readings: hull.points.map((p, i) => ({
      dir: p.clone().normalize(),
      value: i + 1,
    })),
  });
}

/** A die read by the face pointing up, opposite faces adding up to n + 1. */
function faceDie(sides: number, raw: Vector3[], radius: number): DieSpec {
  const hull = convexHull(scaleTo(raw, radius));
  if (hull.faces.length !== sides)
    throw new Error(`d${sides} hull has ${hull.faces.length} faces`);
  const values = pairOpposites(hull, sides);
  const labels = hull.faces.map((face, f): Label => {
    const value = values[f]!;
    const text = String(value);
    const r = inradius(hull, face);
    return {
      face: f,
      at: labelAnchor(hull, f),
      up: faceUp(hull, f),
      size: r * (text.length > 1 ? 0.78 : 0.95),
      text,
      underline: sides >= 9 && (value === 6 || value === 9),
    };
  });
  return finish(sides, "face", hull, labels, {
    readings: hull.faces.map((face, f) => ({
      dir: face.normal.clone(),
      value: values[f]!,
    })),
  });
}

// ------------------------------------------------------------------ helpers

function finish(
  sides: number,
  readBy: ReadBy,
  hull: Hull,
  labels: Label[],
  extra: { readings: Reading[] },
): DieSpec {
  const minIn = Math.min(...hull.faces.map((f) => inradius(hull, f)));
  return {
    sides,
    shape: "poly",
    readBy,
    hull,
    labels,
    readings: extra.readings,
    smooth: new Set(),
    bevel: Math.min(0.085, minIn * 0.42),
    radius: Math.max(...hull.points.map((p) => p.length())),
    collision: hull.points,
    ballast: 0,
  };
}

function scaleTo(points: Vector3[], radius: number): Vector3[] {
  const max = Math.max(...points.map((p) => p.length()));
  return points.map((p) => p.clone().multiplyScalar(radius / max));
}

/**
 * Pairs each face with the one facing most nearly away from it, the way real
 * dice put 1 opposite n, 2 opposite n − 1 and so on.
 */
function pairOpposites(hull: Hull, sides: number): number[] {
  const values: number[] = Array.from({ length: hull.faces.length }, () => 0);
  let next = 1;
  for (let i = 0; i < hull.faces.length; i++) {
    if (values[i]) continue;
    let best = -1;
    let bestDot = Infinity;
    for (let j = 0; j < hull.faces.length; j++) {
      if (j === i || values[j]) continue;
      const d = hull.faces[i]!.normal.dot(hull.faces[j]!.normal);
      if (d < bestDot) [best, bestDot] = [j, d];
    }
    values[i] = next;
    if (best >= 0) values[best] = sides + 1 - next;
    next++;
  }
  return values;
}

/** A kite's number sits a little toward its wide end, where there is room. */
function labelAnchor(hull: Hull, f: number): Vector3 {
  const face = hull.faces[f]!;
  const far = farthestVertex(hull, f);
  if (!far.isKite) return face.center.clone();
  const toApex = hull.points[far.id]!.clone().sub(face.center);
  return face.center.clone().addScaledVector(toApex, -0.08);
}

/**
 * Glyphs point at the apex of a kite (d10 style), at a corner of a triangle
 * or pentagon, and at an edge of a square.
 */
function faceUp(hull: Hull, f: number): Vector3 {
  const face = hull.faces[f]!;
  const far = farthestVertex(hull, f);
  const n = face.verts.length;
  let target: Vector3;
  if (far.isKite) target = hull.points[far.id]!;
  else if (n === 3 || n === 5) target = hull.points[face.verts[0]!]!;
  else
    target = hull.points[face.verts[0]!]!.clone()
      .add(hull.points[face.verts[1]!]!)
      .multiplyScalar(0.5);
  const up = target.clone().sub(face.center);
  return up.addScaledVector(face.normal, -up.dot(face.normal)).normalize();
}

function farthestVertex(
  hull: Hull,
  f: number,
): { id: number; isKite: boolean } {
  const face = hull.faces[f]!;
  const dist = face.verts.map((id) => hull.points[id]!.distanceTo(face.center));
  const max = Math.max(...dist);
  return {
    id: face.verts[dist.indexOf(max)]!,
    isKite: face.verts.length === 4 && max > Math.min(...dist) * 1.2,
  };
}

function v(x: number, y: number, z: number): Vector3 {
  return new Vector3(x, y, z);
}

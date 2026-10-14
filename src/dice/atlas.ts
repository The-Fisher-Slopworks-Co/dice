// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { Vector3 } from "three";
import { planeBasis } from "./hull.ts";
import type { DieSpec } from "./shapes.ts";

const ATLAS_WIDTH = 2048;
const PAD = 8;
/** Rows above this hold no face; the rounded edges sample a texel here. */
const BLANK_ROWS = 16;

/** Where one face's plane lands on the texture. */
export interface Cell {
  e1: Vector3;
  e2: Vector3;
  origin: Vector3;
  /** Texel of `origin`. */
  px: number;
  py: number;
}

export interface Atlas {
  width: number;
  height: number;
  texelsPerUnit: number;
  cells: Map<number, Cell>;
}

/**
 * Packs every labelled face into one texture at a single texel density, so
 * the numbers come out the same weight on every face. Faces are laid out in
 * their own plane, aligned to their longest edge so long dice pack tightly.
 */
export function layoutAtlas(spec: DieSpec): Atlas {
  const faces = [...new Set(spec.labels.map((l) => l.face))];
  const boxes = faces.map((f) => {
    const face = spec.hull.faces[f]!;
    const pts = face.verts.map((i) => spec.hull.points[i]!);
    const { e1, e2 } = planeBasis(face.normal, longestEdge(pts));
    const xs = pts.map((p) => p.clone().sub(face.center).dot(e1));
    const ys = pts.map((p) => p.clone().sub(face.center).dot(e2));
    return {
      f,
      e1,
      e2,
      origin: face.center,
      minX: Math.min(...xs),
      maxY: Math.max(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  });

  const area = boxes.reduce((sum, b) => sum + b.w * b.h, 0);
  const texelsPerUnit = Math.min(
    360,
    Math.floor(Math.sqrt((0.5 * ATLAS_WIDTH * ATLAS_WIDTH) / area)),
  );

  const cells = new Map<number, Cell>();
  let x = PAD;
  let y = BLANK_ROWS;
  let row = 0;
  const order = [...boxes].sort((a, b) => b.h - a.h);
  for (const b of order) {
    const w = Math.ceil(b.w * texelsPerUnit) + PAD;
    const h = Math.ceil(b.h * texelsPerUnit) + PAD;
    if (x + w > ATLAS_WIDTH) {
      x = PAD;
      y += row;
      row = 0;
    }
    cells.set(b.f, {
      e1: b.e1,
      e2: b.e2,
      origin: b.origin,
      px: x - b.minX * texelsPerUnit,
      py: y + b.maxY * texelsPerUnit,
    });
    x += w;
    row = Math.max(row, h);
  }

  return {
    width: ATLAS_WIDTH,
    height: Math.ceil((y + row + PAD) / 4) * 4,
    texelsPerUnit,
    cells,
  };
}

export function texelOf(
  atlas: Atlas,
  cell: Cell,
  p: Vector3,
): [number, number] {
  const d = p.clone().sub(cell.origin);
  return [
    cell.px + d.dot(cell.e1) * atlas.texelsPerUnit,
    cell.py - d.dot(cell.e2) * atlas.texelsPerUnit,
  ];
}

export function uvOf(atlas: Atlas, cell: Cell, p: Vector3): [number, number] {
  const [x, y] = texelOf(atlas, cell, p);
  return [x / atlas.width, 1 - y / atlas.height];
}

/** A texel no face covers: plain die colour for the rounded edges. */
export function blankUv(atlas: Atlas): [number, number] {
  return [4 / atlas.width, 1 - 4 / atlas.height];
}

function longestEdge(pts: Vector3[]): Vector3 {
  let best = new Vector3(1, 0, 0);
  let len = -1;
  pts.forEach((a, i) => {
    const e = pts[(i + 1) % pts.length]!.clone().sub(a);
    if (e.length() > len) [best, len] = [e, e.length()];
  });
  return best;
}

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  SphereGeometry,
} from "three";
import { layoutAtlas, texelOf, type Atlas } from "./atlas.ts";
import { buildDieMesh } from "./mesh.ts";
import type { DieSpec, Label } from "./shapes.ts";

const BODY = "#efe8d8";
const INK = "#0b1f2e";
const FONT = `"Archivo", system-ui, sans-serif`;
/** Archivo's cap height as a share of its em. */
const CAP = 0.7;

export function buildDieModel(spec: DieSpec, maxAnisotropy = 8): Mesh {
  if (spec.shape === "sphere") return sphereModel(spec, maxAnisotropy);
  const atlas = layoutAtlas(spec);
  const data = buildDieMesh(spec, atlas);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute("normal", new Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(data.uvs, 2));
  const { color, bump } = paintAtlas(spec, atlas);
  const mesh = new Mesh(geometry, resinMaterial(color, bump, maxAnisotropy));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function resinMaterial(
  color: HTMLCanvasElement,
  bump: HTMLCanvasElement,
  anisotropy: number,
): MeshPhysicalMaterial {
  const map = new CanvasTexture(color);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = anisotropy;
  const bumpMap = new CanvasTexture(bump);
  bumpMap.anisotropy = anisotropy;
  return new MeshPhysicalMaterial({
    map,
    bumpMap,
    // Numbers are engraved, not printed: the bump sinks them into the face.
    bumpScale: 1.6,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    sheen: 0.25,
    sheenColor: 0xffffff,
  });
}

/**
 * Two canvases with one layout: the colour map (ink in the engravings) and
 * the bump map (white face, black where the engraving cuts in).
 */
function paintAtlas(
  spec: DieSpec,
  atlas: Atlas,
): { color: HTMLCanvasElement; bump: HTMLCanvasElement } {
  const color = canvas(atlas.width, atlas.height);
  const bump = canvas(atlas.width, atlas.height);
  const c = color.getContext("2d")!;
  const b = bump.getContext("2d")!;
  c.fillStyle = BODY;
  c.fillRect(0, 0, atlas.width, atlas.height);
  b.fillStyle = "#fff";
  b.fillRect(0, 0, atlas.width, atlas.height);
  c.fillStyle = INK;
  b.fillStyle = "#000";
  b.filter = "blur(1.5px)";
  for (const label of spec.labels) {
    const cell = atlas.cells.get(label.face);
    if (!cell) continue;
    const at = texelOf(atlas, cell, label.at);
    const tip = texelOf(atlas, cell, label.at.clone().add(label.up));
    // Glyph "up" on the canvas is the face's `up` pushed through the cell.
    const ux = tip[0] - at[0];
    const uy = tip[1] - at[1];
    const len = Math.hypot(ux, uy);
    const px = label.size * atlas.texelsPerUnit;
    for (const ctx of [c, b]) drawLabel(ctx, label, at, ux / len, uy / len, px);
  }
  return { color, bump };
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: Label,
  at: [number, number],
  ux: number,
  uy: number,
  capPx: number,
): void {
  ctx.save();
  // Columns: glyph right (= up turned clockwise on screen), glyph down.
  ctx.setTransform(-uy, ux, -ux, -uy, at[0], at[1]);
  ctx.font = `700 ${capPx / CAP}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label.text, 0, capPx / 2);
  if (label.underline) {
    const w = ctx.measureText(label.text).width;
    ctx.fillRect(-w * 0.4, capPx * 0.68, w * 0.8, capPx * 0.12);
  }
  ctx.restore();
}

function sphereModel(spec: DieSpec, anisotropy: number): Mesh {
  // Equirectangular: the middle of the canvas maps to +z on the ball.
  const w = 1024;
  const h = 512;
  const color = canvas(w, h);
  const bump = canvas(w, h);
  const c = color.getContext("2d")!;
  const b = bump.getContext("2d")!;
  c.fillStyle = BODY;
  c.fillRect(0, 0, w, h);
  b.fillStyle = "#fff";
  b.fillRect(0, 0, w, h);
  c.fillStyle = INK;
  b.fillStyle = "#000";
  b.filter = "blur(1.5px)";
  const label: Label = {
    face: 0,
    at: spec.readings[0]!.dir,
    up: spec.readings[0]!.dir,
    size: 0,
    text: "1",
    underline: false,
  };
  for (const ctx of [c, b])
    drawLabel(ctx, label, [w * 0.75, h / 2], 0, -1, 110);
  const geometry = new SphereGeometry(spec.radius, 96, 64);
  // The "1" is painted on the -z side; turn it to the top, the light side,
  // and lift the ball over its low centre of mass like the physics body.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, spec.ballast, 0);
  const mesh = new Mesh(geometry, resinMaterial(color, bump, anisotropy));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  return el;
}

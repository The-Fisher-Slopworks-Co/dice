// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

// Every die on one page, turning slowly: a place to judge the shapes, the
// bevel and the numbers without rolling each one in turn.

import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildDieModel } from "../dice/render.ts";
import { SIDES, dieSpec } from "../dice/shapes.ts";

// `?d=19` shows one die filling the window, for a close look.
const only = Number(new URLSearchParams(location.search).get("d")) || 0;
const shown = only ? [only] : SIDES;
const COLS = only ? 1 : 5;
const ROWS = Math.ceil(shown.length / COLS);

await Promise.race([
  document.fonts.load(`700 100px "Archivo"`),
  new Promise((r) => setTimeout(r, 2000)),
]);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.setScissorTest(true);
document.body.append(renderer.domElement);

const environment = new PMREMGenerator(renderer).fromScene(
  new RoomEnvironment(),
  0.04,
).texture;

const grid = document.querySelector("#grid")!;
const cells = shown.map((sides) => {
  const scene = new Scene();
  scene.background = new Color("#0c2a2e");
  scene.environment = environment;
  scene.environmentIntensity = 0.5;
  const key = new DirectionalLight(0xfff4e6, 2.4);
  key.position.set(-3, 6, 4);
  scene.add(key, new HemisphereLight(0xdfefff, 0x0c2a2e, 0.6));
  const mesh = buildDieModel(dieSpec(sides));
  mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
  scene.add(mesh);
  const label = document.createElement("span");
  label.textContent = `d${sides}`;
  grid.append(label);
  if (only) grid.setAttribute("style", "grid-template-columns: 1fr");
  return { scene, mesh };
});

const camera = new PerspectiveCamera(30, 1, 0.1, 50);
camera.position.set(0, 2.2, 6.4);
camera.lookAt(0, 0, 0);

renderer.setAnimationLoop((ms) => {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  const cw = w / COLS;
  const ch = h / ROWS;
  camera.aspect = cw / ch;
  camera.updateProjectionMatrix();
  cells.forEach(({ scene, mesh }, i) => {
    mesh.rotation.y = ms / 2600 + i;
    mesh.rotation.x = Math.sin(ms / 3100 + i) * 0.9;
    const x = (i % COLS) * cw;
    const y = h - (Math.floor(i / COLS) + 1) * ch;
    renderer.setViewport(x, y, cw, ch);
    renderer.setScissor(x, y, cw, ch);
    renderer.render(scene, camera);
  });
});

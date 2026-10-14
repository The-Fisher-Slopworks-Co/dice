// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  RepeatWrapping,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Quaternion,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { Bounds } from "./physics.ts";

const FELT = "#103a3b";
/** Shortest side of the visible table, world units: about four dice across. */
const SHORT_SIDE = 9.5;
/** Camera lean from straight down: enough to see the dice as solids. */
const TILT = (16 * Math.PI) / 180;
const FOV = 32;

export class Stage {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private die: Mesh | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    this.renderer = renderer;

    const scene = this.scene;
    scene.background = new Color(FELT).multiplyScalar(0.35);
    scene.environment = new PMREMGenerator(renderer).fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    scene.environmentIntensity = 0.32;

    // One warm lamp over the table, soft at the rim of its pool of light:
    // the falloff is the vignette, and the shadow grounds the die.
    const key = new SpotLight(0xfff1dc, 2.6, 0, 0.62, 0.85, 0);
    key.position.set(-4, 22, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 6;
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 40;
    scene.add(key, key.target);
    scene.add(new HemisphereLight(0xdfeeff, 0x0a2224, 0.55));

    const floor = new Mesh(new PlaneGeometry(200, 200), feltMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  /** Fits the camera to the window; returns the table area it now shows. */
  resize(width: number, height: number): Bounds {
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const camera = this.camera;
    camera.aspect = aspect;
    const visibleHeight = aspect < 1 ? SHORT_SIDE / aspect : SHORT_SIDE;
    const distance =
      visibleHeight / 2 / Math.tan(((FOV / 2) * Math.PI) / 180) + 1;
    camera.position.set(
      0,
      distance * Math.cos(TILT),
      distance * Math.sin(TILT),
    );
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => this.onTable(x!, y!, 0));
    // The view is a trapezoid on the felt; the walls are the largest
    // rectangle inside it, pulled in a little so dice never touch the frame.
    const halfX = Math.min(...corners.map((c) => Math.abs(c.x))) - 0.2;
    const minZ = Math.max(corners[2]!.z, corners[3]!.z) + 0.6;
    const maxZ = Math.min(corners[0]!.z, corners[1]!.z) - 0.2;
    return { minX: -halfX, maxX: halfX, minZ, maxZ };
  }

  setDie(mesh: Mesh): void {
    if (this.die) {
      this.scene.remove(this.die);
      this.die.geometry.dispose();
      const material = this.die.material as MeshStandardMaterial;
      material.map?.dispose();
      material.bumpMap?.dispose();
      material.dispose();
    }
    this.die = mesh;
    this.scene.add(mesh);
  }

  syncDie(x: number, y: number, z: number, rotation: Quaternion): void {
    if (!this.die) return;
    this.die.position.set(x, y, z);
    this.die.quaternion.copy(rotation);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a point on screen (CSS pixels) meets the plane at `height`. */
  pointerOnTable(clientX: number, clientY: number, height: number): Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return this.onTable(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      height,
    );
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  private onTable(ndcX: number, ndcY: number, height: number): Vector3 {
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const hit = new Vector3();
    ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -height), hit);
    return hit;
  }
}

/**
 * Billiard-cloth felt: fine random fibre speckle on a dark green, repeated
 * across the table. The same noise drives a faint bump so the light catches
 * the nap.
 */
function feltMaterial(): MeshStandardMaterial {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 200 + Math.random() * 55;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "#000";
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = Math.random() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6);
    ctx.stroke();
  }
  const map = new CanvasTexture(canvas);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.repeat.set(60, 60);
  map.colorSpace = SRGBColorSpace;
  const bump = map.clone();
  bump.colorSpace = "";
  return new MeshStandardMaterial({
    color: FELT,
    map,
    bumpMap: bump,
    bumpScale: 0.6,
    roughness: 0.96,
    metalness: 0,
  });
}

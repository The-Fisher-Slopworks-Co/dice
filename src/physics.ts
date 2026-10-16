// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import {
  Body,
  ContactMaterial,
  ConvexPolyhedron,
  Material,
  Plane,
  Quaternion,
  Sphere,
  Vec3,
  World,
} from "cannon-es";
import type { Vector3 } from "three";
import { convexHull } from "./dice/hull.ts";
import type { DieSpec } from "./dice/shapes.ts";

/**
 * World units are about a centimetre and a half. Real gravity at that scale
 * reads as a toy in slow motion on screen, so this is tuned by eye instead:
 * fast enough to feel heavy, slow enough to follow the tumble.
 */
const GRAVITY = 42;
const STEP = 1 / 180;
const CEILING = 9;
const TUMBLE_DAMPING = 0.4;
const TWIRL_DAMPING = 0.05;
/** How fast felt slows a rolling die, and a rolling ball, per second. */
const ROLLING_DRAG = 3;
const BALL_DRAG = 4;
/**
 * Felt gives under a ball and holds it back by a fixed amount, however slow
 * it rolls, so a roly-poly stops rocking instead of fading out for seconds.
 * Radians per second, per second.
 */
const ROLLING_RESISTANCE = 1.5;
/**
 * A hand spins a ball far less than a die: it leaves the fingers rolling,
 * and its weight swings round the centre of mass, so a die's spin turns it
 * into a wild wobble.
 */
const BALL_SPIN = 0.3;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type Surface = "felt" | "rim";

export interface Impact {
  surface: Surface;
  /** Change in speed at the contact, world units per second. */
  strength: number;
}

const felt = new Material("felt");
const rim = new Material("rim");
const resin = new Material("resin");
/** The weighted d1: the rim lets it slide so it never props itself upright. */
const ball = new Material("ball");

export class Table {
  readonly world = new World({ gravity: new Vec3(0, -GRAVITY, 0) });
  private readonly walls: Body[] = [];
  private die: Body | null = null;
  private dieRadius = 1;
  private ballast = 0;
  private damping = TUMBLE_DAMPING;
  private held: Vec3 | null = null;
  private stillFor = 0;
  /** Nudges since the last throw: each one knocks a little harder. */
  private nudges = 0;
  /** Pose the die held when it last moved, to measure stillness against. */
  private readonly restPosition = new Vec3();
  private readonly restRotation = new Quaternion();
  private sinceRoll = 0;
  private accumulator = 0;
  private bounds: Bounds = { minX: -4, maxX: 4, minZ: -6, maxZ: 6 };

  constructor() {
    this.world.allowSleep = false;
    this.world.addContactMaterial(
      new ContactMaterial(resin, felt, { friction: 0.5, restitution: 0.32 }),
    );
    this.world.addContactMaterial(
      new ContactMaterial(resin, rim, { friction: 0.02, restitution: 0.55 }),
    );
    this.world.addContactMaterial(
      new ContactMaterial(ball, felt, { friction: 0.32, restitution: 0.32 }),
    );
    this.world.addContactMaterial(
      new ContactMaterial(ball, rim, { friction: 0, restitution: 0.55 }),
    );
    const floor = new Body({ mass: 0, material: felt, shape: new Plane() });
    floor.quaternion.setFromAxisAngle(new Vec3(1, 0, 0), -Math.PI / 2);
    this.world.addBody(floor);
    for (let i = 0; i < 5; i++) {
      const wall = new Body({ mass: 0, material: rim, shape: new Plane() });
      this.walls.push(wall);
      this.world.addBody(wall);
    }
    this.placeWalls();
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
    this.placeWalls();
    const die = this.die;
    if (!die) return;
    const r = this.dieRadius;
    die.position.x = clamp(die.position.x, bounds.minX + r, bounds.maxX - r);
    die.position.z = clamp(die.position.z, bounds.minZ + r, bounds.maxZ - r);
  }

  /**
   * Replaces the die, tossing the new one onto the middle of the table with
   * a throw's spin, so it lands on a face of its own: its first roll.
   */
  setDie(spec: DieSpec): void {
    if (this.die) this.world.removeBody(this.die);
    this.damping = spec.shape === "sphere" ? 0.8 : TUMBLE_DAMPING;
    const die = new Body({
      mass: 1,
      material: spec.ballast ? ball : resin,
      // A ball has no corners to stop it, so the felt has to drag it to rest.
      linearDamping: spec.shape === "sphere" ? 0.4 : 0.08,
      angularDamping: this.damping,
    });
    // The body's origin is its centre of mass, so ballast lifts the shape
    // above it: the weight rides low and pulls the light side up.
    die.addShape(
      spec.shape === "sphere"
        ? new Sphere(spec.radius)
        : polyhedron(spec.collision),
      new Vec3(0, spec.ballast, 0),
    );
    if (spec.inertia) {
      const { x, y, z } = spec.inertia;
      die.inertia.set(x, y, z).scale(die.mass, die.inertia);
      die.invInertia.set(
        1 / die.inertia.x,
        1 / die.inertia.y,
        1 / die.inertia.z,
      );
      die.updateInertiaWorld(true);
    }
    die.position.set(
      (this.bounds.minX + this.bounds.maxX) / 2,
      4,
      (this.bounds.minZ + this.bounds.maxZ) / 2,
    );
    die.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, 0);
    this.world.addBody(die);
    this.die = die;
    this.dieRadius = spec.radius;
    this.ballast = spec.ballast;
    this.spin(rand(22, 34) * this.handSpin);
    this.wake();
  }

  /** Scoops the die off the felt and flings it, the way a hand would. */
  roll(): void {
    const die = this.die;
    if (!die) return;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const toCenter = new Vec3(
      (minX + maxX) / 2 - die.position.x,
      0,
      (minZ + maxZ) / 2 - die.position.z,
    );
    const heading =
      Math.atan2(toCenter.z, toCenter.x) + rand(-0.9, 0.9) * Math.PI * 0.5;
    // A ball rolls a long way on its own, so it gets a gentler toss.
    const gentle = this.ballast ? 0.5 : 1;
    const speed = gentle * (rand(6, 11) + Math.min(toCenter.length(), 5));
    die.position.y = Math.max(die.position.y, this.dieRadius + 0.3);
    die.velocity.set(
      Math.cos(heading) * speed,
      rand(9, 13),
      Math.sin(heading) * speed,
    );
    this.spin(rand(22, 34) * this.handSpin);
    this.wake();
  }

  /**
   * Stands the die on edge and twirls it like a top: the coin flick. It
   * spins down, wobbles round on its rim and falls flat.
   */
  twirl(): void {
    const die = this.die;
    if (!die) return;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const r = this.dieRadius + 0.4;
    die.position.set(
      clamp(die.position.x, minX + r, maxX - r),
      this.dieRadius + 0.05,
      clamp(die.position.z, minZ + r, maxZ - r),
    );
    // The coin's axis is its own y; lay it level, leaning a hair to one side.
    const stand = new Quaternion().setFromAxisAngle(
      new Vec3(1, 0, 0),
      Math.PI / 2 + rand(-0.04, 0.04),
    );
    const heading = new Quaternion().setFromAxisAngle(
      new Vec3(0, 1, 0),
      rand(0, Math.PI * 2),
    );
    die.quaternion.copy(heading.mult(stand));
    die.velocity.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
    die.angularVelocity.set(
      0,
      rand(26, 36) * (Math.random() < 0.5 ? -1 : 1),
      0,
    );
    this.wake();
    // Air barely slows a spinning coin; the tumble damping would stop it in
    // a second. The next throw of any kind (`wake`) puts it back.
    die.angularDamping = TWIRL_DAMPING;
  }

  /** Lets go of the die with the hand's own velocity. */
  throwWith(velocity: Vec3): void {
    const die = this.die;
    if (!die) return;
    this.held = null;
    const speed = velocity.length();
    const cap = 34;
    if (speed > cap) velocity.scale(cap / speed, velocity);
    die.velocity.set(
      velocity.x,
      Math.max(velocity.y, 2) + speed * 0.12,
      velocity.z,
    );
    this.spin((10 + Math.min(speed, cap) * 0.8) * this.handSpin);
    this.wake();
  }

  /** Holds the die under a finger, at `target`, or lets go with `null`. */
  hold(target: Vec3 | null): void {
    this.held = target;
    if (target) this.wake();
  }

  /** A shove from shaking the phone, in world units per second. */
  shove(impulse: Vec3): void {
    const die = this.die;
    if (!die || this.held) return;
    die.velocity.vadd(impulse, die.velocity);
    const kick = impulse.length();
    if (kick > 1.5) this.spin(Math.min(kick * 1.6, 26), true);
    this.wake();
  }

  /**
   * Knocks a die that came to rest leaning on something off its perch,
   * toward the middle: whatever it leans on is usually the rim.
   */
  nudge(): void {
    const die = this.die;
    if (!die) return;
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const away = new Vec3(
      (minX + maxX) / 2 - die.position.x,
      0,
      (minZ + maxZ) / 2 - die.position.z,
    );
    away.normalize();
    // A coin propped on the rim can fall straight back against it; knocking
    // harder each time stops that from going on and on.
    const k = 1 + 0.7 * this.nudges++;
    const push = rand(1.5, 2.5) * k;
    die.velocity.set(
      away.x * push,
      rand(3, 4.5) * Math.min(k, 2),
      away.z * push,
    );
    this.stillFor = 0;
    if (!this.ballast) {
      this.spin(rand(5, 8) * k);
      return;
    }
    // A weighted ball stuck on the rim leans with its weight toward it, and
    // the felt holds it there. Set down near the rim it rolls straight back,
    // so it is knocked well clear: rolling back it rights itself first.
    die.velocity.set(away.x * 8, 6, away.z * 8);
    die.angularVelocity.set(0, 0, 0);
  }

  get isHeld(): boolean {
    return this.held !== null;
  }

  get dieBody(): Body | null {
    return this.die;
  }

  /** True once the die has lain still long enough to read. */
  get settled(): boolean {
    return this.die !== null && !this.held && this.stillFor > 0.3;
  }

  /** Seconds since the die was last thrown, shoved or picked up. */
  get airtime(): number {
    return this.sinceRoll;
  }

  advance(dt: number): Impact[] {
    const die = this.die;
    const impacts: Impact[] = [];
    if (!die) return impacts;
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    const before = new Vec3();
    const spinBefore = new Vec3();
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      if (this.held) this.followHand(die, this.held);
      before.copy(die.velocity);
      spinBefore.copy(die.angularVelocity);
      this.world.step(STEP);
      this.feltDrag(die);
      if (!this.held) this.detectImpact(die, before, spinBefore, impacts);
      this.trackStillness(die);
    }
    return impacts;
  }

  private followHand(die: Body, target: Vec3): void {
    const pull = target.vsub(die.position).scale(14);
    const len = pull.length();
    if (len > 40) pull.scale(40 / len, pull);
    die.velocity.copy(pull);
    die.velocity.y += GRAVITY * STEP;
    die.angularVelocity.scale(0.995, die.angularVelocity);
  }

  /**
   * Gravity aside, a free die's velocity only jumps when it hits something,
   * so the jump is the impact. Which way it jumped tells felt from rim.
   */
  private detectImpact(
    die: Body,
    before: Vec3,
    spinBefore: Vec3,
    impacts: Impact[],
  ): void {
    const dv = die.velocity.vsub(before);
    dv.y += GRAVITY * STEP;
    const spin = die.angularVelocity.vsub(spinBefore).length() * this.dieRadius;
    const strength = dv.length() + spin * 0.35;
    if (strength < 0.9) return;
    const horizontal = Math.hypot(dv.x, dv.z);
    impacts.push({
      surface: horizontal > Math.abs(dv.y) * 1.2 ? "rim" : "felt",
      strength,
    });
  }

  /**
   * Felt drags on whatever rolls across it, which a rigid contact alone does
   * not capture: without this a rounded die keeps tipping over edges at a
   * crawl. A ball touches at a single point and gets more, including on its
   * spin in place.
   */
  private feltDrag(die: Body): void {
    if (die.position.y > this.dieRadius * 1.05) return;
    const drag = 1 - (this.ballast ? BALL_DRAG : ROLLING_DRAG) * STEP;
    die.angularVelocity.x *= drag;
    die.angularVelocity.z *= drag;
    if (!this.ballast) return;
    die.angularVelocity.y *= 1 - 4 * STEP;
    const turning = die.angularVelocity.length();
    if (turning === 0) return;
    const left = Math.max(0, turning - ROLLING_RESISTANCE * STEP);
    die.angularVelocity.scale(left / turning, die.angularVelocity);
  }

  /**
   * Still means the die has not moved for a while, measured by where it is
   * rather than by its velocity: a resting die's contact solver buzzes its
   * velocity up and down by a few hundredths without it going anywhere.
   */
  private trackStillness(die: Body): void {
    this.sinceRoll += STEP;
    const moved = die.position.distanceTo(this.restPosition);
    const a = die.quaternion;
    const b = this.restRotation;
    const turned = 1 - Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
    if (moved > 0.004 || turned > 2e-6) {
      this.restPosition.copy(die.position);
      this.restRotation.copy(die.quaternion);
      this.stillFor = 0;
    } else this.stillFor += STEP;
    // A die can rock on a rounded edge for a long while. Past this point
    // the table calls it, and a cocked result gets a nudge from outside.
    if (this.sinceRoll > 9 && !this.held)
      this.stillFor = Math.max(this.stillFor, 0.31);
  }

  /** How much of a die's spin a throw gives this one. */
  private get handSpin(): number {
    return this.ballast ? BALL_SPIN : 1;
  }

  private spin(rate: number, keep = false): void {
    const die = this.die;
    if (!die) return;
    const axis = new Vec3(rand(-1, 1), rand(-1, 1), rand(-1, 1));
    axis.normalize();
    const add = axis.scale(rate);
    if (keep) die.angularVelocity.vadd(add.scale(0.4), die.angularVelocity);
    else die.angularVelocity.copy(add);
  }

  private wake(): void {
    if (this.die) this.die.angularDamping = this.damping;
    this.stillFor = 0;
    this.sinceRoll = 0;
    this.nudges = 0;
  }

  private placeWalls(): void {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const place = (i: number, normal: Vec3, at: Vec3) => {
      const wall = this.walls[i]!;
      wall.position.copy(at);
      wall.quaternion.copy(
        new Quaternion().setFromVectors(new Vec3(0, 0, 1), normal),
      );
    };
    place(0, new Vec3(1, 0, 0), new Vec3(minX, 0, 0));
    place(1, new Vec3(-1, 0, 0), new Vec3(maxX, 0, 0));
    place(2, new Vec3(0, 0, 1), new Vec3(0, 0, minZ));
    place(3, new Vec3(0, 0, -1), new Vec3(0, 0, maxZ));
    place(4, new Vec3(0, -1, 0), new Vec3(0, CEILING, 0));
  }
}

function polyhedron(points: Vector3[]): ConvexPolyhedron {
  const hull = convexHull(points);
  return new ConvexPolyhedron({
    vertices: hull.points.map((p) => new Vec3(p.x, p.y, p.z)),
    faces: hull.faces.map((f) => f.verts),
  });
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

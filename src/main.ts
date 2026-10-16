// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { Vec3 } from "cannon-es";
import { Quaternion, type Vector3 } from "three";
import { COCKED_BELOW, readOutcome } from "./dice/read.ts";
import { buildDieModel } from "./dice/render.ts";
import { SIDES, dieSpec, isValidSides, type DieSpec } from "./dice/shapes.ts";
import { Haptics } from "./feedback/haptics.ts";
import { Sound } from "./feedback/sound.ts";
import { ShakeDetector, toScreen } from "./input/shake.ts";
import { Table } from "./physics.ts";
import { Stage } from "./stage.ts";

/** Hits at or above this many world units per second feel like a slam. */
const SLAM = 16;
/** Height the die is carried at under a finger. */
const CARRY = 2.6;
/** Shake: real m/s² to world units, and how hard the die is thrown about. */
const SHAKE_GAIN = 6.5;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("table");
const valueEl = $<HTMLOutputElement>("value");
const captionEl = $("caption");
const historyEl = $("history");
const hintEl = $("hint");
const picker = $("picker");
const soundButton = $<HTMLButtonElement>("sound");
const hapticsButton = $<HTMLButtonElement>("haptics");
const shakeButton = $<HTMLButtonElement>("shake");
const twirlButton = $<HTMLButtonElement>("twirl");

// Numbers are painted into the die texture once, so the face font has to be
// there first. Offline, or on a slow link, the system font stands in.
await Promise.race([
  document.fonts.load(`700 100px "Archivo"`),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]);

const stage = new Stage(canvas);
const table = new Table();
const haptics = new Haptics();
const sound = new Sound();
const shake = new ShakeDetector();

/**
 * "rolling": thrown, or a new die tossed onto the table; the result shows
 * when it stops. "resting": shown.
 */
let phase: "rolling" | "resting" = "rolling";
let spec: DieSpec = dieSpec(20);
let rolls: number[] = [];
const rotation = new Quaternion();
/** What the hint says about the dice in general, and about the coin. */
let rollHint = "Tap to roll · drag to throw";
const BUMP_HINT = "Press the felt to raise a bump";
/** Shown until the first bump: the coin's hint is not hidden by a roll. */
let bumped = false;

// ---------------------------------------------------------------- settings

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`dice.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`dice.${key}`, value);
    } catch {
      // Private mode or blocked storage: settings just don't persist.
    }
  },
};

function initialSides(): number {
  const fromHash = Number(location.hash.replace(/^#d/, ""));
  if (isValidSides(fromHash)) return fromHash;
  const saved = Number(store.get("sides"));
  return isValidSides(saved) ? saved : 20;
}

function bindToggle(
  button: HTMLButtonElement,
  key: string,
  apply: (on: boolean) => void,
): void {
  const on = store.get(key) !== "off";
  button.ariaPressed = String(on);
  apply(on);
  button.addEventListener("click", () => {
    const next = button.ariaPressed !== "true";
    button.ariaPressed = String(next);
    store.set(key, next ? "on" : "off");
    apply(next);
    if (next) haptics.impact(1);
  });
}

bindToggle(soundButton, "sound", (on) => (sound.enabled = on));
if (haptics.supported) {
  hapticsButton.hidden = false;
  bindToggle(hapticsButton, "haptics", (on) => (haptics.enabled = on));
}

// ---------------------------------------------------------------- dice

for (const sides of SIDES) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.role = "radio";
  chip.textContent = `d${sides}`;
  chip.dataset.sides = String(sides);
  chip.addEventListener("click", () => {
    sound.unlock();
    choose(sides);
  });
  picker.append(chip);
}

function choose(sides: number): void {
  spec = dieSpec(sides);
  const mesh = buildDieModel(spec, stage.maxAnisotropy);
  stage.setDie(mesh);
  table.setDie(spec);
  phase = "rolling";
  rolls = [];
  renderHistory();
  valueEl.textContent = "";
  valueEl.dataset.state = "rolling";
  captionEl.textContent = `d${sides}`;
  twirlButton.hidden = sides !== 2;
  if (sides === 2 && !bumped) {
    hintEl.textContent = BUMP_HINT;
    hintEl.hidden = false;
  } else if (hintEl.textContent === BUMP_HINT) {
    hintEl.textContent = rollHint;
    hintEl.hidden = true;
  }
  store.set("sides", String(sides));
  history.replaceState(null, "", `#d${sides}`);
  for (const chip of picker.children as HTMLCollectionOf<HTMLElement>) {
    const on = chip.dataset.sides === String(sides);
    chip.ariaChecked = String(on);
    if (on) chip.scrollIntoView({ inline: "center", block: "nearest" });
  }
}

function roll(): void {
  sound.unlock();
  table.roll();
  startRolling();
}

// The coin flick: stood on edge and spun like a top until it falls.
twirlButton.addEventListener("click", () => {
  sound.unlock();
  haptics.impact(0.6);
  table.twirl();
  startRolling();
});

function startRolling(): void {
  phase = "rolling";
  valueEl.dataset.state = "rolling";
  if (hintEl.textContent !== BUMP_HINT) hintEl.hidden = true;
}

function land(value: number): void {
  phase = "resting";
  valueEl.textContent = String(value);
  // Restart the landing animation even when the number repeats.
  valueEl.dataset.state = "idle";
  void valueEl.offsetWidth;
  valueEl.dataset.state = "shown";
  rolls = [value, ...rolls].slice(0, 8);
  renderHistory();
  haptics.settle();
}

function renderHistory(): void {
  historyEl.replaceChildren(
    ...rolls.slice(1).map((v, i) => {
      const li = document.createElement("li");
      li.textContent = String(v);
      li.style.setProperty("--i", String(i));
      return li;
    }),
  );
}

// ---------------------------------------------------------------- pointer

/**
 * A tap rolls. A drag picks the die up: it flies to the finger and follows
 * it, and letting go throws it with the finger's own speed. With the coin
 * out, pressing the felt anywhere but on the coin raises a bump there
 * instead, which follows the finger and sinks when it lets go.
 */
let press: {
  id: number;
  x: number;
  y: number;
  t: number;
  bump: boolean;
} | null = null;
const trail: { p: Vector3; t: number }[] = [];

canvas.addEventListener("pointerdown", (e) => {
  if (press) return;
  sound.unlock();
  canvas.setPointerCapture(e.pointerId);
  const bump = spec.sides === 2 && !onDie(e.clientX, e.clientY);
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, bump };
  if (!bump) return;
  pressFelt(e.clientX, e.clientY);
  haptics.impact(0.3);
  if (!bumped) {
    bumped = true;
    hintEl.hidden = true;
    hintEl.textContent = rollHint;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!press || e.pointerId !== press.id) return;
  if (press.bump) {
    pressFelt(e.clientX, e.clientY);
    return;
  }
  const target = stage.pointerOnTable(e.clientX, e.clientY, CARRY);
  if (!table.isHeld) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
    haptics.impact(0.5);
    startRolling();
  }
  table.hold(new Vec3(target.x, target.y, target.z));
  trail.push({ p: target, t: e.timeStamp });
  while (trail.length > 2 && e.timeStamp - trail[0]!.t > 90) trail.shift();
});

function onDie(clientX: number, clientY: number): boolean {
  const body = table.dieBody;
  if (!body) return false;
  const p = stage.pointerOnTable(clientX, clientY, body.position.y);
  const reach = spec.radius * 1.3;
  return Math.hypot(p.x - body.position.x, p.z - body.position.z) < reach;
}

function pressFelt(clientX: number, clientY: number): void {
  const p = stage.pointerOnTable(clientX, clientY, 0);
  table.press(new Vec3(p.x, 0, p.z));
}

function release(e: PointerEvent): void {
  if (!press || e.pointerId !== press.id) return;
  const { bump } = press;
  press = null;
  if (bump) {
    table.press(null);
    return;
  }
  if (!table.isHeld) {
    roll();
    return;
  }
  const first = trail[0];
  const last = trail.at(-1);
  const velocity = new Vec3();
  if (first && last && last.t > first.t) {
    const dt = (last.t - first.t) / 1000;
    velocity.set((last.p.x - first.p.x) / dt, 0, (last.p.z - first.p.z) / dt);
  }
  trail.length = 0;
  table.throwWith(velocity);
}

canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

window.addEventListener("keydown", (e) => {
  if (e.repeat || e.target instanceof HTMLButtonElement) return;
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    roll();
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    const i = SIDES.indexOf(spec.sides) + (e.key === "ArrowLeft" ? -1 : 1);
    const next = SIDES[Math.max(0, Math.min(SIDES.length - 1, i))]!;
    if (next !== spec.sides) choose(next);
  }
});

// ---------------------------------------------------------------- shake

type MotionPermission = { requestPermission?: () => Promise<string> };

function setupShake(): void {
  const coarse = matchMedia("(pointer: coarse)").matches;
  if (!("DeviceMotionEvent" in window) || !coarse) return;
  const needsPermission =
    typeof (DeviceMotionEvent as MotionPermission).requestPermission ===
    "function";
  let listening = false;
  const listen = () => {
    if (listening) return;
    listening = true;
    window.addEventListener("devicemotion", onMotion);
  };
  const enable = (on: boolean) => {
    shakeButton.ariaPressed = String(on);
    store.set("shake", on ? "on" : "off");
    rollHint = on
      ? "Tap to roll · drag to throw · shake"
      : "Tap to roll · drag to throw";
    if (hintEl.textContent !== BUMP_HINT) hintEl.textContent = rollHint;
    if (on) listen();
  };
  shakeButton.hidden = false;
  // iOS asks once and only from a tap, so it starts off there until the user
  // turns it on. Elsewhere it is simply on.
  enable(!needsPermission && store.get("shake") !== "off");
  shakeButton.addEventListener("click", async () => {
    const next = shakeButton.ariaPressed !== "true";
    if (next && needsPermission) {
      const answer = await (DeviceMotionEvent as MotionPermission)
        .requestPermission!().catch(() => "denied");
      if (answer !== "granted") return;
    }
    enable(next);
  });
}

let lastMotion = 0;

function onMotion(e: DeviceMotionEvent): void {
  if (shakeButton.ariaPressed !== "true") return;
  const a = e.acceleration;
  if (!a || a.x === null || a.y === null || a.z === null) return;
  const angle = screen.orientation?.angle ?? 0;
  const m = toScreen({ x: a.x, y: a.y, z: a.z }, angle);
  const dt = lastMotion ? Math.min((e.timeStamp - lastMotion) / 1000, 0.05) : 0;
  lastMotion = e.timeStamp;
  for (const event of shake.push(m, e.timeStamp)) {
    if (event.kind === "start") {
      sound.unlock();
      startRolling();
    }
    if (event.kind !== "jolt" || !dt) continue;
    // The die is left behind as the phone moves: it is shoved the other way.
    // Screen up is the far side of the table; out of the screen is up.
    const k = SHAKE_GAIN * dt;
    const s = event.motion;
    table.shove(new Vec3(-s.x * k, Math.max(0, -s.z) * k, s.y * k));
  }
}

setupShake();

// ---------------------------------------------------------------- loop

function fit(): void {
  table.setBounds(stage.resize(innerWidth, innerHeight));
}
window.addEventListener("resize", fit);
fit();
choose(initialSides());

let before = performance.now();
stage.renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - before) / 1000, 0.05);
  before = now;
  for (const hit of table.advance(dt)) {
    const strength = Math.min(1, hit.strength / SLAM);
    haptics.impact(strength);
    sound.impact(hit.surface, strength, spec.radius);
  }
  const body = table.dieBody;
  if (!body) return;
  const q = body.quaternion;
  rotation.set(q.x, q.y, q.z, q.w);
  stage.syncDie(body.position.x, body.position.y, body.position.z, rotation);
  const hump = table.bumpCenter;
  stage.syncBump(hump.x, hump.y, hump.z);
  // A bump that lifts the coin off its rest rolls it again.
  if (phase === "resting" && press?.bump && !table.settled) startRolling();
  if (phase !== "resting" && table.settled) {
    const outcome = readOutcome(spec, rotation);
    if (outcome.flatness < COCKED_BELOW) table.nudge();
    else land(outcome.value);
  }
  stage.render();
});

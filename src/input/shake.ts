// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

/** Device acceleration without gravity, m/s², in screen axes (y up). */
export interface Motion {
  x: number;
  y: number;
  z: number;
}

/** Above this the hand is shaking the phone, not just holding it. */
const START = 11;
/** And once below this for `QUIET_MS`, the shaking is over. */
const STOP = 4;
const QUIET_MS = 260;

export type ShakeEvent =
  { kind: "start" } | { kind: "jolt"; motion: Motion } | { kind: "stop" };

/**
 * Turns a stream of motion samples into "shaking started", the jolts while it
 * lasts, and "shaking stopped". Hysteresis keeps a hand that pauses for a
 * moment mid-shake from ending it.
 */
export class ShakeDetector {
  private shaking = false;
  private quietSince = 0;

  push(m: Motion, now: number): ShakeEvent[] {
    const force = Math.hypot(m.x, m.y, m.z);
    const out: ShakeEvent[] = [];
    if (!this.shaking) {
      if (force < START) return out;
      this.shaking = true;
      this.quietSince = 0;
      out.push({ kind: "start" });
    }
    if (force >= STOP) {
      this.quietSince = 0;
      out.push({ kind: "jolt", motion: m });
    } else if (!this.quietSince) {
      this.quietSince = now;
    } else if (now - this.quietSince > QUIET_MS) {
      this.shaking = false;
      out.push({ kind: "stop" });
    }
    return out;
  }
}

/**
 * Device axes rotate with the screen; the table does not. Turns a sample in
 * device axes into one in the axes of the screen as it is currently held.
 */
export function toScreen(m: Motion, angle: number): Motion {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return { x: m.y, y: -m.x, z: m.z };
    case 180:
      return { x: -m.x, y: -m.y, z: m.z };
    case 270:
      return { x: -m.y, y: m.x, z: m.z };
    default:
      return m;
  }
}

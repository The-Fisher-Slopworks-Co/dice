// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { describe, expect, test } from "bun:test";
import { ShakeDetector, toScreen } from "./shake.ts";

const kinds = (d: ShakeDetector, x: number, t: number) =>
  d.push({ x, y: 0, z: 0 }, t).map((e) => e.kind);

describe("ShakeDetector", () => {
  test("ignores a phone that is only being held", () => {
    const d = new ShakeDetector();
    for (let t = 0; t < 1000; t += 16) expect(kinds(d, 3, t)).toEqual([]);
  });

  test("starts on a hard jolt and stops after a quiet spell", () => {
    const d = new ShakeDetector();
    expect(kinds(d, 15, 0)).toEqual(["start", "jolt"]);
    expect(kinds(d, 6, 16)).toEqual(["jolt"]);
    expect(kinds(d, 1, 32)).toEqual([]);
    expect(kinds(d, 1, 200)).toEqual([]);
    expect(kinds(d, 1, 400)).toEqual(["stop"]);
    expect(kinds(d, 1, 420)).toEqual([]);
  });

  test("a short pause does not end the shake", () => {
    const d = new ShakeDetector();
    kinds(d, 15, 0);
    kinds(d, 1, 16);
    expect(kinds(d, 9, 150)).toEqual(["jolt"]);
    expect(kinds(d, 1, 300)).toEqual([]);
  });
});

describe("toScreen", () => {
  test("follows the screen through each rotation", () => {
    const m = { x: 1, y: 2, z: 3 };
    expect(toScreen(m, 0)).toEqual(m);
    expect(toScreen(m, 90)).toEqual({ x: 2, y: -1, z: 3 });
    expect(toScreen(m, 180)).toEqual({ x: -1, y: -2, z: 3 });
    expect(toScreen(m, -90)).toEqual({ x: -2, y: 1, z: 3 });
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import { describe, expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import { layoutAtlas } from "./atlas.ts";
import { convexHull } from "./hull.ts";
import { buildDieMesh } from "./mesh.ts";
import { readOutcome } from "./read.ts";
import { SIDES, dieSpec, isValidSides } from "./shapes.ts";

const ALL = [...SIDES];
const UP = new Vector3(0, 1, 0);

describe("dieSpec", () => {
  test("rejects what is not on offer", () => {
    for (const n of [0, 3, 5, 7, 19, 21, 2.5, -4]) {
      expect(isValidSides(n)).toBe(false);
      expect(() => dieSpec(n)).toThrow(RangeError);
    }
  });

  test.each(ALL)("d%i can show every value exactly once", (n) => {
    const values = dieSpec(n).readings.map((r) => r.value);
    expect(values.sort((a, b) => a - b)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
  });

  test.each(ALL.filter((n) => n > 1))(
    "d%i rests with each value squarely on top",
    (n) => {
      const spec = dieSpec(n);
      for (const r of spec.readings) {
        const q = new Quaternion().setFromUnitVectors(
          r.dir.clone().normalize(),
          UP,
        );
        expect(readOutcome(spec, q)).toEqual({
          value: r.value,
          flatness: expect.closeTo(1, 6),
        });
      }
    },
  );

  test.each([6, 8, 12, 20])("d%i puts n + 1 on opposite faces", (n) => {
    const { readings } = dieSpec(n);
    for (const r of readings) {
      const opposite = readings.find((o) => o.dir.dot(r.dir) < -0.999);
      expect(opposite && opposite.value + r.value).toBe(n + 1);
    }
  });

  test.each(ALL.filter((n) => n > 1))("d%i labels every value", (n) => {
    const spec = dieSpec(n);
    const texts = new Set(spec.labels.map((l) => l.text));
    for (const r of spec.readings) expect(texts).toContain(String(r.value));
    for (const l of spec.labels) {
      expect(l.size).toBeGreaterThan(0.08);
      expect(Math.abs(l.up.dot(spec.hull.faces[l.face]!.normal))).toBeLessThan(
        1e-6,
      );
    }
  });
});

describe("buildDieMesh", () => {
  test.each(ALL.filter((n) => n > 1))("d%i is closed and faces out", (n) => {
    const spec = dieSpec(n);
    const mesh = buildDieMesh(spec, layoutAtlas(spec));
    const p = mesh.positions;
    expect(p.length % 9).toBe(0);
    for (let i = 0; i < p.length; i += 9) {
      const a = new Vector3(p[i], p[i + 1], p[i + 2]);
      const b = new Vector3(p[i + 3], p[i + 4], p[i + 5]);
      const c = new Vector3(p[i + 6], p[i + 7], p[i + 8]);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const centroid = a.add(b).add(c).divideScalar(3);
      if (normal.length() > 1e-9)
        expect(normal.dot(centroid)).toBeGreaterThan(0);
    }
    for (const uv of mesh.uvs) expect(uv).toBeWithin(0, 1.0000001);
  });

  test.each(ALL.filter((n) => n > 1))(
    "d%i bevel stays inside the collision solid",
    (n) => {
      const spec = dieSpec(n);
      const solid = convexHull(spec.collision);
      // The coin's rim is drawn flat but collides as a slight barrel.
      const slack = n === 2 ? 0.02 : 1e-6;
      const p = buildDieMesh(spec, layoutAtlas(spec)).positions;
      for (let i = 0; i < p.length; i += 3) {
        const at = new Vector3(p[i], p[i + 1], p[i + 2]);
        for (const face of solid.faces)
          expect(at.clone().sub(face.center).dot(face.normal)).toBeLessThan(
            slack,
          );
      }
    },
  );
});

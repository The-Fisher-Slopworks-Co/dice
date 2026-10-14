// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

// Rolls every die many times on a headless table and reports how long each
// takes to come to rest and how often it has to be knocked off a perch. Run
// it before and after touching a physics constant:
//
//   bun run simulate          # 60 rolls of each die
//   bun run simulate 200 6,20 # 200 rolls of the d6 and the d20

import { Quaternion } from "three";
import { COCKED_BELOW, readOutcome } from "../src/dice/read.ts";
import { SIDES, dieSpec } from "../src/dice/shapes.ts";
import { Table } from "../src/physics.ts";

const rolls = Number(process.argv[2] ?? 60);
const dice = process.argv[3]?.split(",").map(Number) ?? SIDES;
const FRAME = 1 / 60;
const GIVE_UP = 30;

for (const sides of dice) {
  const spec = dieSpec(sides);
  const table = new Table();
  table.setBounds({ minX: -4.5, maxX: 4.5, minZ: -7, maxZ: 7 });
  table.setDie(spec);
  const rotation = new Quaternion();
  const times: number[] = [];
  const seen = new Set<number>();
  let nudges = 0;
  for (let i = 0; i < rolls; i++) {
    table.roll();
    let t = 0;
    while (t < GIVE_UP) {
      table.advance(FRAME);
      t += FRAME;
      if (!table.settled) continue;
      const q = table.dieBody!.quaternion;
      const outcome = readOutcome(spec, rotation.set(q.x, q.y, q.z, q.w));
      if (outcome.flatness >= COCKED_BELOW) {
        seen.add(outcome.value);
        break;
      }
      table.nudge();
      nudges++;
    }
    times.push(t);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.floor(q * (rolls - 1))]!.toFixed(2);
  console.log(
    `d${sides}`.padEnd(4),
    `rest median ${at(0.5)}s p90 ${at(0.9)}s max ${at(1)}s`,
    `· nudges ${nudges} · faces seen ${seen.size}/${sides}`,
  );
}

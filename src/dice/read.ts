// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import type { Quaternion } from "three";
import type { DieSpec } from "./shapes.ts";

export interface Outcome {
  value: number;
  /** How squarely the winning reading points up: 1 is flat on the table. */
  flatness: number;
}

/**
 * Below this a die is leaning on something (cocked) rather than resting on a
 * face. It is still about 18 degrees off vertical; every die here lands much
 * closer than that when it lies flat.
 */
export const COCKED_BELOW = 0.95;

export function readOutcome(spec: DieSpec, rotation: Quaternion): Outcome {
  let value = 0;
  let flatness = -Infinity;
  for (const r of spec.readings) {
    const y = r.dir.clone().applyQuaternion(rotation).y;
    if (y > flatness) [value, flatness] = [r.value, y];
  }
  return { value, flatness };
}

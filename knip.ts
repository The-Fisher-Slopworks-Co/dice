// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    // Both pages reach their scripts through a `<script src>` in HTML, a hop
    // knip does not follow, so the scripts are named directly.
    "src/main.ts",
    "src/gallery/gallery.ts",
    // Co-located tests are roots of their own: an export that only a test
    // reaches is still reached.
    "src/**/*.test.ts",
  ],
  project: ["src/**/*.ts", "scripts/**/*.ts"],
  // `uv` is a machine prerequisite (README → Develop), not an npm package.
  ignoreBinaries: ["uvx"],
};

export default config;

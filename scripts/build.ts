// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

// Production build: bundles the page into dist/ and copies public/ (the Pages
// custom domain and crawler files) next to it. The gallery is a dev tool and
// stays out.

import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["src/index.html"],
  outdir: "dist",
  minify: true,
  sourcemap: "linked",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await cp("public", "dist", { recursive: true });
for (const out of result.outputs)
  console.log(`${out.path.replace(process.cwd() + "/", "")}  ${out.size} B`);

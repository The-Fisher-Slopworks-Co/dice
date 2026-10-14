## Project

A die on a felt table, served at [dice.slopworks.org](https://dice.slopworks.org)
by GitHub Pages. Static page, TypeScript + Bun, three.js for rendering and
cannon-es for rigid-body physics. The goal is a throw that looks, sounds and
feels real, not a better random number: `Math.random()` only seeds the toss,
the physics decides the face. See `README.md` for what it is; this file covers
how to work on it.

### Commands

```bash
bun run dev        # http://localhost:3000 — the table at /, every die at /gallery
bun run check      # typecheck + lint + format + knip + reuse + tests — before every commit
bun run build      # dist/: what Pages serves (src/index.html bundled + public/)
bun run simulate   # roll every die headless; rest times and nudges (args: rolls, dice)
bun run typecheck  # bunx tsc --noEmit
bun run lint       # oxlint (config: .oxlintrc.json)
bun run format     # prettier --write over src/ and scripts/ (config: .prettierrc.json)
bun run knip       # unused files/exports/deps (config: knip.ts)
bun run reuse      # reuse lint via uvx — SPDX headers; needs uv on the machine
bun run test       # unit tests = `bun test src`; one file: `bun test src/dice/shapes.test.ts`
```

`/gallery?d=12` shows one die close up. Haptics and shake need a phone: open
the dev server from one on the same network, over HTTPS for shake on iOS.

`bun install` installs a lefthook pre-commit hook that runs the same gate
(`lefthook.yml`). `LEFTHOOK=0 git commit` skips it for one commit.

### Layout (`src/`)

- `main.ts` — composition root and UI: picker, toggles, result, pointer and
  shake input, the frame loop that steps physics and feeds impacts to sound
  and haptics. `index.html`, `style.css` and `favicon.svg` are the page.
- `dice/` — the dice, pure geometry, no DOM except `render.ts`:
  `shapes.ts` (which dice exist, their solids, numbers and how a result is
  read), `hull.ts` (convex hull with merged faces), `mesh.ts` (rounded
  edges), `atlas.ts` (where each face lands on the texture), `read.ts` (the
  value showing on top), `render.ts` (paints the numbers, builds the three.js
  mesh).
- `physics.ts` — the table: cannon-es world, felt and rim, throw, carry,
  shake shoves, impact and rest detection.
- `stage.ts` — three.js scene: lamp, felt, camera, and the table bounds that
  fit the window.
- `feedback/` — `haptics.ts` (vibrate on Android, the switch-input tick on
  iOS) and `sound.ts` (synthesised impacts).
- `input/` — `shake.ts`, device motion to shake events.
- `gallery/` — dev page with every die on one screen; not deployed.

### Conventions

- **SPDX header on every new file** that can hold a comment — `bun run reuse`
  fails without one. `REUSE.toml` covers only JSON, `bun.lock`, Markdown and
  `public/CNAME`.
- **Only d1 and even dice.** Every even count has a solid whose faces are
  alike (platonic or trapezohedron); odd ones do not and were dropped. The d1
  is a weighted ball that always rights itself 1 up.
- **Tune physics by simulation.** `bun run simulate` rolls every die on a
  headless `Table` and reports rest times and nudges. Run it before and after
  changing a constant; dice should rest in about 2–3 s with few nudges.
- **Tests:** `bun test`, co-located as `*.test.ts`.

### Definition of done

- **Everything in the repo is written in English** — code, comments, docs, commit messages, issues and PRs (title and body), whatever language the task was discussed in. The only exception is localization: translations into other languages.
- **Never commit to main.** Every task starts on a fresh branch off `origin/main`, named `<type>/<short-task>` — `fix/`, `feat/`, `refactor/`, `chore/`.
- **One task = one branch = one PR.** Past ~300 changed lines, split it into several PRs. `size:XL` or `size:XXL` means split the PR, not "explain why it is large".
- **PR title is the squash commit subject:** conventional commit with a scope, enforced by `.github/workflows/pr-title.yml`.
  - Type: `feat` `fix` `refactor` `chore` `docs` `test` `ci` `perf` `revert`.
  - Scope (required): a top-level `src/` module — `dice` `feedback` `gallery` `input` `physics` `stage` `ui` (the page: `main.ts`, `index.html`, `style.css`) — or `deps` `github` `release`. A new module means adding it to the `scopes:` list in that workflow.
  - Subject: lowercase start, imperative, no trailing period.
  - The body describes this PR alone, following the PR template.
- **No AI attribution.** No `Assisted-by:` / `Co-Authored-By: <LLM>` trailers and no "Generated with …" lines. The PR body becomes the squash commit body, so the PR title workflow fails a PR that carries one.
- **Before opening:** `bun run check` green, then open the PR and report its URL.
- **Never merge locally.** Merging happens on GitHub, squash only.

# dice

Roll a die on a felt table: [dice.slopworks.org](https://dice.slopworks.org).

d1, d2, d4, d6, d8, d10, d12, d14, d16, d18 and d20, each a rounded resin
solid with engraved numbers. Tap to roll, or pick the die up and throw it.
Every throw is a rigid-body simulation, so the die tumbles, bounces off the
rim and settles the way a real one does, and every hit clicks and buzzes in
your hand where the browser allows it: vibration on Android, the system
haptic tick on iOS 18 and later. On a phone, shake it to rattle the die like
in a cup.

The d1 is a weighted ball. It always comes up 1.

## Develop

Needs [Bun](https://bun.sh), and [uv](https://docs.astral.sh/uv/) for
`bun run check`.

```bash
bun install
bun run dev     # the table at http://localhost:3000, every die at /gallery
bun run check   # the full gate CI runs
```

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).

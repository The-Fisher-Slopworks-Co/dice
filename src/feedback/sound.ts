// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

import type { Surface } from "../physics.ts";

/**
 * Impact sounds synthesised on the fly: a burst of noise shaped by a filter
 * and a fast decay. Felt swallows the highs and gives a dull thud; the
 * wooden rim gives a short, bright clack with a hint of pitch. Every hit is
 * detuned a little so a tumble never sounds like a loop.
 */
export class Sound {
  enabled = true;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private last = 0;

  /** Browsers only start audio from a user gesture; call it from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    const length = Math.floor(ctx.sampleRate * 0.25);
    const noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.noise = noise;
  }

  /** `strength` from 0 to 1; `size` is the die's radius in world units. */
  impact(surface: Surface, strength: number, size: number): void {
    const { ctx, noise } = this;
    if (!this.enabled || !ctx || !noise || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - this.last < 0.018) return;
    this.last = now;

    const jitter = 0.88 + Math.random() * 0.24;
    // Bigger dice ring lower.
    const pitch = jitter * (1.25 / Math.max(size, 0.6));
    const volume = Math.min(1, strength) ** 1.3;
    const felt = surface === "felt";

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = pitch;
    const filter = ctx.createBiquadFilter();
    filter.type = felt ? "lowpass" : "bandpass";
    filter.frequency.value = (felt ? 900 : 2600) * pitch;
    filter.Q.value = felt ? 0.7 : 1.6;
    const gain = ctx.createGain();
    const peak = volume * (felt ? 0.55 : 0.4);
    const decay = felt ? 0.07 : 0.045;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + decay + 0.02);

    if (!felt) {
      // The resin itself rings for a moment when it hits something hard.
      const tone = ctx.createOscillator();
      tone.frequency.value = 1800 * pitch;
      const ring = ctx.createGain();
      ring.gain.setValueAtTime(volume * 0.08, now);
      ring.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      tone.connect(ring).connect(ctx.destination);
      tone.start(now);
      tone.stop(now + 0.04);
    }
  }
}

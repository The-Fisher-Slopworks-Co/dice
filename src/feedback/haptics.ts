// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 The Fisher Slopworks Co

/**
 * Taps the user's hand when the die hits something.
 *
 * Android browsers have `navigator.vibrate`, which takes a duration, so a hard
 * hit buzzes longer than a graze. iOS Safari has no vibration API at all; the
 * only haptic a page can trigger there is the tick iOS 18 plays when a
 * `<input type="checkbox" switch>` is toggled, so this toggles a hidden one.
 * That tick has one strength, so iOS only gets the harder hits.
 */
export class Haptics {
  readonly supported: boolean;
  enabled = true;
  private readonly ios: boolean;
  private readonly toggle: HTMLLabelElement | null = null;
  private last = 0;

  constructor() {
    this.ios =
      /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const vibrates = typeof navigator.vibrate === "function";
    this.supported = vibrates || this.ios;
    if (this.ios && !vibrates) this.toggle = switchToggle();
  }

  /** One impact, `strength` from 0 (graze) to 1 (slam). */
  impact(strength: number): void {
    if (!this.enabled || !this.supported) return;
    const now = performance.now();
    if (this.toggle) {
      if (strength < 0.25 || now - this.last < 70) return;
      this.last = now;
      this.toggle.click();
      return;
    }
    if (now - this.last < 30) return;
    this.last = now;
    navigator.vibrate(Math.round(6 + strength * 22));
  }

  /** The die has come to rest. */
  settle(): void {
    if (!this.enabled || !this.supported) return;
    if (this.toggle) {
      this.toggle.click();
      setTimeout(() => this.toggle?.click(), 110);
    } else navigator.vibrate([12, 60, 18]);
  }
}

function switchToggle(): HTMLLabelElement {
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.cssText =
    "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.append(input);
  document.body.append(label);
  return label;
}

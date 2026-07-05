/**
 * One Euro Filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * An adaptive low-pass filter whose cutoff frequency rises with signal
 * speed: strong smoothing at rest (kills jitter), minimal smoothing during
 * fast moves (no perceptible lag). Exactly the trade-off a hand-tracked
 * cursor needs, and the reason it's the first stage of the pipeline.
 *
 * Tunables (exposed as dev sliders — feel-tuning is empirical):
 *  - minCutoff: cutoff at zero speed. Lower = smoother/steadier at rest.
 *  - beta:      speed coefficient. Higher = snappier during fast moves.
 *  - derivCutoff: cutoff for the internal speed estimate; rarely touched.
 */

class LowPass {
  private initialized = false;
  private stored = 0;

  filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.stored = value;
      return value;
    }
    this.stored = alpha * value + (1 - alpha) * this.stored;
    return this.stored;
  }

  last(): number {
    return this.stored;
  }

  reset(): void {
    this.initialized = false;
  }
}

function alphaFor(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastTimeMs: number | null = null;

  constructor(
    public minCutoff: number,
    public beta: number,
    public derivCutoff: number,
  ) {}

  filter(value: number, timestampMs: number): number {
    if (this.lastTimeMs === null) {
      this.lastTimeMs = timestampMs;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }

    const dtSec = Math.max((timestampMs - this.lastTimeMs) / 1000, 1e-4);
    this.lastTimeMs = timestampMs;

    // Estimate (and smooth) the signal's speed.
    const rawDeriv = (value - this.x.last()) / dtSec;
    const smoothDeriv = this.dx.filter(rawDeriv, alphaFor(this.derivCutoff, dtSec));

    // Speed-dependent cutoff: the heart of the filter.
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothDeriv);
    return this.x.filter(value, alphaFor(cutoff, dtSec));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastTimeMs = null;
  }
}

/** Convenience pair for filtering 2D points with shared parameters. */
export class OneEuroFilter2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff: number, beta: number, derivCutoff: number) {
    this.fx = new OneEuroFilter(minCutoff, beta, derivCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, derivCutoff);
  }

  /** Update parameters live (the tuning panel edits settings every frame). */
  setParams(minCutoff: number, beta: number, derivCutoff: number): void {
    this.fx.minCutoff = this.fy.minCutoff = minCutoff;
    this.fx.beta = this.fy.beta = beta;
    this.fx.derivCutoff = this.fy.derivCutoff = derivCutoff;
  }

  filter(x: number, y: number, timestampMs: number): { x: number; y: number } {
    return {
      x: this.fx.filter(x, timestampMs),
      y: this.fy.filter(y, timestampMs),
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}

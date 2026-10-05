import { describe, expect, it } from "vitest";
import { cleanRR, dfaAlpha1 } from "../dfa-alpha1.js";

// Deterministic PRNG + Box-Muller so the test is reproducible
function gaussian(seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}

describe("dfaAlpha1", () => {
  it("is ~0.5 for uncorrelated (white noise) RR series", () => {
    const g = gaussian(42);
    const rr = Array.from({ length: 2000 }, () => 700 + 20 * g());
    const a = dfaAlpha1(rr)!;
    expect(a).toBeGreaterThan(0.4);
    expect(a).toBeLessThan(0.62);
  });

  it("is ~1.5 for a random walk (Brownian) RR series", () => {
    const g = gaussian(7);
    let v = 700;
    const rr = Array.from({ length: 2000 }, () => (v += g()));
    const a = dfaAlpha1(rr)!;
    expect(a).toBeGreaterThan(1.3);
    expect(a).toBeLessThan(1.7);
  });

  it("returns null for too-short series", () => {
    expect(dfaAlpha1([700, 710, 705])).toBeNull();
  });
});

describe("cleanRR", () => {
  it("drops impossible and >20% outlier beats", () => {
    const beats = [700, 705, 710, 702, 1400, 708, 100, 706].map((rr, t) => ({ t, rr }));
    const { clean, artifacts } = cleanRR(beats);
    expect(artifacts).toBe(2);
    expect(clean.map((b) => b.rr)).not.toContain(1400);
    expect(clean.map((b) => b.rr)).not.toContain(100);
  });
});

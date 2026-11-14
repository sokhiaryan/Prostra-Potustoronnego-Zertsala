import { describe, expect, it } from 'vitest';
import {
  ZERO_EXP,
  decimalDigits,
  fxFromDecimal,
  fxFromNumber,
  fxToDecimal,
  fxToFloatExp,
  fxToNumber,
  ldexp,
  pow2,
} from '../src/math/bigfixed';
import {
  ESCAPE_RADIUS,
  computeReference,
  iterateDeep,
  iteratePlain,
  smoothCount,
} from '../src/math/mandel';

/** Ground truth: iterate one point directly in fixed point, with no perturbation at all. */
function direct(cre: bigint, cim: bigint, bits: number, maxIter: number): number {
  const B = BigInt(bits);
  let x = 0n;
  let y = 0n;
  for (let k = 0; k < maxIter; k++) {
    const nx = ((x * x - y * y) >> B) + cre;
    y = ((x * y) >> (B - 1n)) + cim;
    x = nx;
    const fr = fxToNumber(x, bits);
    const fi = fxToNumber(y, bits);
    const mag = fr * fr + fi * fi;
    if (mag > ESCAPE_RADIUS * ESCAPE_RADIUS) return smoothCount(k + 1, mag);
  }
  return -1;
}

/** Deterministic pseudo-random numbers in [-1, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/** Nucleus of the period-3 minibrot on the real axis, by Newton's method on (c^2 + c)^2 + c. */
function period3Nucleus(bits: number): bigint {
  const B = BigInt(bits);
  const one = 1n << B;
  let c = fxFromDecimal('-1.7548776662466927', bits);
  for (let i = 0; i < 40; i++) {
    const q = ((c * c) >> B) + c;
    const f = ((q * q) >> B) + c;
    const df = ((2n * q * (2n * c + one)) >> B) + one;
    c -= (f << B) / df;
  }
  return c;
}

describe('fixed point', () => {
  it('round-trips doubles and tiny values', () => {
    const out = new Float64Array(2);
    for (const x of [1, -1, 0.1, -3.75, 1e-30, 123456.789, -2e-12]) {
      expect(fxToNumber(fxFromNumber(x, 400), 400)).toBe(x);
    }
    const tiny = fxFromNumber(0.75, 2000, -1500); // 0.75 * 2^-1500, far below the double range
    fxToFloatExp(tiny, 2000, out);
    expect(out[0] * pow2(0)).toBeCloseTo(0.75, 12);
    expect(out[1]).toBe(-1500);
    expect(fxToNumber(tiny, 2000)).toBe(0);
    fxToFloatExp(0n, 2000, out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(ZERO_EXP);
  });

  it('keeps 53 bits for values just below the fast path', () => {
    const out = new Float64Array(2);
    const x = 1.2345678901234567 * 2 ** -60;
    fxToFloatExp(fxFromNumber(x, 300), 300, out);
    expect(ldexp(out[0], out[1])).toBe(x);
    fxToFloatExp(fxFromNumber(-x, 300), 300, out);
    expect(ldexp(out[0], out[1])).toBe(-x);
  });

  it('parses and prints decimals exactly', () => {
    expect(fxToDecimal(fxFromDecimal('-0.75', 64), 64)).toBe('-0.75');
    expect(fxToDecimal(fxFromDecimal('2', 64), 64)).toBe('2.0');
    expect(fxToDecimal(fxFromDecimal('.5', 64), 64)).toBe('0.5');
    expect(() => fxFromDecimal('1e5', 64)).toThrow();
    expect(() => fxFromDecimal('', 64)).toThrow();
    const r = rng(7);
    for (const bits of [64, 200, 1300]) {
      for (let i = 0; i < 20; i++) {
        const v = fxFromNumber(r() * 2, bits) + BigInt(Math.floor((r() + 1) * 1e9));
        const text = fxToDecimal(v, bits);
        expect(text.length).toBeLessThanOrEqual(decimalDigits(bits) + 4);
        expect(fxFromDecimal(text, bits)).toBe(v);
      }
    }
  });

  it('ldexp and pow2 cover the whole double range and beyond', () => {
    expect(pow2(10)).toBe(1024);
    expect(pow2(-1074)).toBe(5e-324);
    expect(pow2(-5000)).toBe(0);
    expect(ldexp(0.5, 3)).toBe(4);
    expect(ldexp(1, -1074)).toBe(5e-324);
    expect(ldexp(2 ** 600, -1300) * 2 ** 700).toBe(1);
    expect(ldexp(1, -9000)).toBe(0);
  });
});

interface Case {
  name: string;
  re: string;
  im: string;
  /** log2 of the offset scale around the reference point. */
  exp: number;
  maxIter: number;
  /** Allowed error of the smooth count (default 1e-6). */
  tol?: number;
}

// Offsets of the order 2^exp around points on or near the boundary of the set.
// Seahorse valley is chaotic: orbits there amplify rounding by many orders of magnitude,
// so its tolerance is looser (still far below one colour step).
const CASES: Case[] = [
  { name: 'overview', re: '-0.6', im: '0.2', exp: -1, maxIter: 400 },
  { name: 'seahorse valley 1e-10', re: '-0.743643887037151', im: '0.131825904205330', exp: -33, maxIter: 3000, tol: 1e-3 },
  { name: 'dendrite at i, 1e-30', re: '0', im: '1', exp: -100, maxIter: 600 },
  { name: 'dendrite at i, 1e-100', re: '0', im: '1', exp: -332, maxIter: 1200 },
  { name: 'antenna tip at -2, 1e-150', re: '-2', im: '0', exp: -500, maxIter: 1200 },
];

describe('perturbation in plain doubles', () => {
  for (const c of CASES) {
    it(`matches direct iteration: ${c.name}`, () => {
      const bits = -c.exp + 120;
      const re = fxFromDecimal(c.re, bits);
      const im = fxFromDecimal(c.im, bits);
      const ref = computeReference(re, im, bits, c.maxIter, false);
      const r = rng(11);
      let escaped = 0;
      let worst = 0;
      for (let i = 0; i < 60; i++) {
        const ox = r();
        const oy = r();
        const want = direct(re + fxFromNumber(ox, bits, c.exp), im + fxFromNumber(oy, bits, c.exp), bits, c.maxIter);
        const got = iteratePlain(ref, ldexp(ox, c.exp), ldexp(oy, c.exp), c.maxIter);
        if (want < 0) {
          expect(got).toBe(-1);
        } else {
          escaped++;
          worst = Math.max(worst, Math.abs(got - want));
        }
      }
      expect(escaped).toBeGreaterThan(10);
      expect(worst).toBeLessThan(c.tol ?? 1e-6);
    });
  }

  it('one reference serves pixels thousands of view widths away', () => {
    const bits = 220;
    const re = fxFromDecimal('-0.743643887037151', bits);
    const im = fxFromDecimal('0.131825904205330', bits);
    const ref = computeReference(re, im, bits, 2000, false);
    const r = rng(3);
    for (let i = 0; i < 40; i++) {
      // A 2^-60 view whose centre is 2^-48 away from the reference point.
      const ox = 4096 + r();
      const oy = -4096 + r();
      const want = direct(re + fxFromNumber(ox, bits, -60), im + fxFromNumber(oy, bits, -60), bits, 2000);
      const got = iteratePlain(ref, ldexp(ox, -60), ldexp(oy, -60), 2000);
      if (want < 0) expect(got).toBe(-1);
      else expect(Math.abs(got - want)).toBeLessThan(1e-3);
    }
  });

  it('finds interior points without running out the budget', () => {
    const bits = 160;
    const ref = computeReference(fxFromDecimal('-0.1', bits), fxFromDecimal('0.1', bits), bits, 100000, false);
    expect(ref.escaped).toBe(false);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) expect(iteratePlain(ref, 0.01 * Math.cos(i), 0.01 * Math.sin(i), 100000)).toBe(-1);
    // 2e8 iterations would take seconds; cycle detection ends each pixel after a few hundred.
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('perturbation with extended exponents', () => {
  const deep: Case[] = [
    { name: 'dendrite at i, 1e-320', re: '0', im: '1', exp: -1063, maxIter: 2500 },
    { name: 'dendrite at i, 1e-400', re: '0', im: '1', exp: -1330, maxIter: 3000 },
    { name: 'antenna tip at -2, 1e-330', re: '-2', im: '0', exp: -1096, maxIter: 2500 },
  ];
  for (const c of deep) {
    it(`matches direct iteration: ${c.name}`, () => {
      const bits = -c.exp + 120;
      const re = fxFromDecimal(c.re, bits);
      const im = fxFromDecimal(c.im, bits);
      const ref = computeReference(re, im, bits, c.maxIter, true);
      const r = rng(5);
      let escaped = 0;
      let worst = 0;
      for (let i = 0; i < 40; i++) {
        const ox = r();
        const oy = r();
        const want = direct(re + fxFromNumber(ox, bits, c.exp), im + fxFromNumber(oy, bits, c.exp), bits, c.maxIter);
        const got = iterateDeep(ref, ox, oy, c.exp, c.maxIter);
        if (want < 0) {
          expect(got).toBe(-1);
        } else {
          escaped++;
          worst = Math.max(worst, Math.abs(got - want));
        }
      }
      expect(escaped).toBeGreaterThan(10);
      expect(worst).toBeLessThan(1e-6);
    });
  }

  it('agrees with the plain path where both are valid', () => {
    for (const c of CASES) {
      const bits = -c.exp + 120;
      const re = fxFromDecimal(c.re, bits);
      const im = fxFromDecimal(c.im, bits);
      const ref = computeReference(re, im, bits, c.maxIter, true);
      const r = rng(23);
      for (let i = 0; i < 40; i++) {
        const ox = r();
        const oy = r();
        const plain = iteratePlain(ref, ldexp(ox, c.exp), ldexp(oy, c.exp), c.maxIter);
        const ext = iterateDeep(ref, ox, oy, c.exp, c.maxIter);
        if (plain < 0) expect(ext).toBe(-1);
        else expect(Math.abs(ext - plain)).toBeLessThan(c.tol ?? 1e-6);
      }
    }
  });

  it('handles a reference that returns to zero (minibrot nucleus), across its boundary', () => {
    // The orbit of a period-3 nucleus hits values around 2^-bits every third step, which
    // only the mantissa/exponent form of the reference can hold.
    const bits = 1400;
    const c0 = period3Nucleus(bits);
    const ref = computeReference(c0, 0n, bits, 1500, true);
    expect(ref.escaped).toBe(false);
    const xe = ref.xe as Float64Array;
    expect(Math.min(xe[3], xe[6], xe[9])).toBeLessThan(-1000);
    const r = rng(9);
    let inside = 0;
    let outside = 0;
    let worst = 0;
    for (let i = 0; i < 80; i++) {
      // Offsets up to 0.03: the minibrot is about 0.02 across, so both fates occur.
      const ox = r() * 0.03;
      const oy = r() * 0.03;
      const want = direct(c0 + fxFromNumber(ox, bits), fxFromNumber(oy, bits), bits, 1500);
      const got = iterateDeep(ref, ox, oy, 0, 1500);
      const plain = iteratePlain(ref, ox, oy, 1500);
      if (want < 0) {
        inside++;
        expect(got).toBe(-1);
        expect(plain).toBe(-1);
      } else {
        outside++;
        worst = Math.max(worst, Math.abs(got - want), Math.abs(plain - want));
      }
    }
    expect(inside).toBeGreaterThan(5);
    expect(outside).toBeGreaterThan(5);
    expect(worst).toBeLessThan(1e-5);
  });

  it('stays inside a minibrot at 1e-320, far below the double range', () => {
    const bits = 1300;
    const c0 = period3Nucleus(bits);
    const ref = computeReference(c0, 0n, bits, 400, true);
    const r = rng(2);
    for (let i = 0; i < 20; i++) expect(iterateDeep(ref, r(), r(), -1063, 400)).toBe(-1);
  });
});

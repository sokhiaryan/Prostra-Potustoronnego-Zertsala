// Arbitrary-precision fixed point on BigInt: a value x is stored as round(x * 2^bits).
// Used for the 2D view centre and the perturbation reference orbit, the only two places
// where float64 is not enough. Plus "floatexp" helpers: a double mantissa with a separate
// integer exponent, for magnitudes far below the smallest double (~1e-308).

/** Exponent used for an exact zero, low enough that it loses every max() and scales to 0. */
export const ZERO_EXP = -(2 ** 40);

const POW2_MIN = -1100;
const POW2_TABLE = new Float64Array(1024 - POW2_MIN);
for (let i = 0; i < POW2_TABLE.length; i++) POW2_TABLE[i] = Math.pow(2, i + POW2_MIN);

/** 2^n for integer n; 0 below the double range and Infinity above it. */
export function pow2(n: number): number {
  if (n < POW2_MIN) return 0;
  if (n > 1023) return Infinity;
  return POW2_TABLE[n - POW2_MIN];
}

/** m * 2^e without intermediate overflow or underflow. */
export function ldexp(m: number, e: number): number {
  if (m === 0 || e < -2300) return 0;
  if (e > 2300) return m > 0 ? Infinity : -Infinity;
  let x = m;
  let k = e;
  while (k > 1000) { x *= 2 ** 1000; k -= 1000; }
  while (k < -1000) { x *= 2 ** -1000; k += 1000; }
  return x * pow2(k);
}

/** Fixed-point value of x * 2^exp2 (x a finite double), rounded toward minus infinity. */
export function fxFromNumber(x: number, bits: number, exp2 = 0): bigint {
  if (x === 0 || !Number.isFinite(x)) return 0n;
  let e = Math.floor(Math.log2(Math.abs(x)));
  let m = x / Math.pow(2, e);
  while (Math.abs(m) >= 2) { m /= 2; e++; }
  while (Math.abs(m) < 1) { m *= 2; e--; }
  const mi = BigInt(Math.round(m * 2 ** 52)); // exact: |m| is in [1, 2)
  const shift = bits + e + exp2 - 52;
  return shift >= 0 ? mi << BigInt(shift) : mi >> BigInt(-shift);
}

function bitLength(a: bigint): number {
  // a > 0. Hex digits give the length to within four bits; the top digit settles it.
  const hex = a.toString(16);
  return (hex.length - 1) * 4 + (32 - Math.clz32(parseInt(hex[0], 16)));
}

/**
 * Split a fixed-point value into mantissa and exponent: value = out[0] * 2^out[1].
 * Values of ordinary size come back as (double, 0); tiny ones as a mantissa in [0.5, 1]
 * with a negative exponent; zero as (0, ZERO_EXP). Always correct to 53 bits.
 */
export function fxToFloatExp(v: bigint, bits: number, out: Float64Array): void {
  if (v === 0n) {
    out[0] = 0;
    out[1] = ZERO_EXP;
    return;
  }
  if (bits <= 100) {
    out[0] = Number(v) / Math.pow(2, bits);
    out[1] = 0;
    return;
  }
  // Fast path: keep 100 fractional bits; if at least 53 significant bits survive, done.
  const hi = Number(v >> BigInt(bits - 100));
  if (hi >= 2 ** 53 || hi <= -(2 ** 53)) {
    out[0] = hi * 2 ** -100;
    out[1] = 0;
    return;
  }
  const neg = v < 0n;
  const a = neg ? -v : v;
  const len = bitLength(a);
  const shift = len > 64 ? len - 64 : 0;
  const top = Number(a >> BigInt(shift)); // < 2^64, rounded to 53 bits
  const m = top / Math.pow(2, len - shift); // in [0.5, 1]
  out[0] = neg ? -m : m;
  out[1] = len - bits;
}

const scratch = new Float64Array(2);

/** Nearest double to a fixed-point value (0 when it underflows). */
export function fxToNumber(v: bigint, bits: number): number {
  fxToFloatExp(v, bits, scratch);
  return ldexp(scratch[0], scratch[1]);
}

/** Change the number of fractional bits. */
export function fxRescale(v: bigint, from: number, to: number): bigint {
  return to >= from ? v << BigInt(to - from) : v >> BigInt(from - to);
}

/** Parse a decimal string such as "-0.7436438870371587" (no exponent) to fixed point, rounded to nearest. */
export function fxFromDecimal(text: string, bits: number): bigint {
  const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/.exec(text);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`not a decimal number: "${text}"`);
  const frac = m[3] ?? '';
  const digits = BigInt((m[2] || '0') + frac);
  const den = 10n ** BigInt(frac.length);
  const scaled = ((digits << BigInt(bits + 1)) / den + 1n) >> 1n;
  return m[1] === '-' ? -scaled : scaled;
}

/** Decimal digits needed so that fxFromDecimal(fxToDecimal(v)) returns v exactly. */
export function decimalDigits(bits: number): number {
  return Math.ceil(bits * 0.30103) + 2;
}

/** Format with `digits` decimals (default: enough to round-trip), rounded to nearest, trailing zeros trimmed. */
export function fxToDecimal(v: bigint, bits: number, digits = decimalDigits(bits)): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const scale = 10n ** BigInt(digits);
  const n = (((a * scale * 2n) >> BigInt(bits)) + 1n) >> 1n;
  const int = n / scale;
  let frac = (n % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  if (frac === '') frac = '0';
  const body = `${int}.${frac}`;
  return neg && n !== 0n ? `-${body}` : body;
}

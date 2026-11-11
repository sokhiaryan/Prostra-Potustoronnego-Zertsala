# The maths behind the picture

Everything on screen comes from one idea: **sphere tracing**. For a ray `p(t) = o + t·d`,
if a function `DE(p)` never exceeds the true distance from `p` to the surface, then the
ball of radius `DE(p)` around `p` is empty, and the ray may safely advance by that amount.
Repeating this converges on the surface without ever stepping through it. The quality of
the image is therefore the quality of `DE`.

The GLSL estimators live in `src/render/shaders/de.glsl`; line-for-line TypeScript mirrors
in `src/math/de.ts` are what the tests exercise and what the camera uses for picking.

## 1. Mandelbulb

Iteration (White–Nylander "triplex" power) with `r = |z|`:

```
z ← rⁿ · (sin nθ cos nφ, sin nθ sin nφ, cos nθ) + c        θ = acos(z_z / r), φ = atan(z_y, z_x)
dr ← n · rⁿ⁻¹ · dr + 1                                      dr₀ = 1
DE = ½ · ln(r) · r / dr          (evaluated once r exceeds the bailout radius 8)
```

**Why it works.** For a polynomial map `f_c(z) = zⁿ + c` in the complex plane, the escape
potential `G(c) = lim n⁻ᵏ ln|z_k|` is harmonic outside the set and vanishes on it. The Koebe
quarter theorem bounds the distance to the set by `G / |∇G|` up to a factor between ¼ and 1
(Douady–Hubbard; see Hart, Sandin & Kauffman 1989 for the ray-tracing use). Substituting
the iterates gives `|z| ln|z| / |z'|`, and the conventional factor ½ sits inside that
bracket. `dr` is the running magnitude of the derivative: the chain rule applied to
`|f'(z)| = n|z|ⁿ⁻¹`.

**Where it is only an estimate.** In three dimensions the triplex power is not conformal,
so `dr` is the derivative of the *radial* growth, not a bound on every direction, and no
theorem guarantees the inequality. The two "twist" parameters add a phase to `θ` and `φ`;
they rotate the image of each iteration, which leaves `dr` unchanged. In practice the
estimate is excellent away from the surface and slightly optimistic inside the thin shell
right next to it, which is why the marcher advances by `0.75 · DE` rather than `DE`.

## 2. Mandelbox

One iteration is a box fold, a sphere fold, then scale-and-translate:

```
z ← clamp(z, −L, L)·2 − z                       box fold (L = fold limit)
k = 1 / clamp(|z|², r_min², 1)                  sphere fold factor
z ← s·k·z + c
dr ← |s|·k·dr + 1
DE = |z| / |dr|
```

**Why it works.** The box fold is a reflection wherever it acts, so it preserves lengths.
The sphere fold is either the identity, a uniform scale by `1/r_min²`, or an inversion in
the unit sphere; an inversion is conformal with local stretch exactly `1/|z|²`. So every
step is locally a similarity with ratio `|s|·k`, and `dr` accumulates that ratio exactly.
An orbit that stays bounded while `dr` grows geometrically drives `|z|/|dr|` to zero on the
set; a first-order Taylor argument turns that into a distance: moving `p` by `δ` moves the
iterate by about `dr·δ`, so the escape radius is about `|z|/dr` away.

**Where it is only an estimate.** The stretch factor is local. The straight path from `p`
to the nearest surface point can cross into a region with a larger factor, so the bound is
first-order, not global. The marcher uses `0.8 · DE`.

## 3. Kaleidoscopic Menger (KIFS)

```
repeat n times:
  z ← |z|                                       mirror into the positive octant
  sort so that z_x ≥ z_y ≥ z_z                  mirror across the diagonals
  z ← R·z                                       fold rotation (two angles)
  z_xy ← s·z_xy − (s − 1)
  z_z  ← ½c − |s·z_z − ½c|,   c = offset·(s − 1)
DE = sdBox(z, 1) / sⁿ
```

With `s = 3`, `R = I` and `offset = 1` this is exactly the Menger sponge on `[-1, 1]³`.

**Why it is rigorous.** Every operation in the loop is 1-Lipschitz (`|·|`, the conditional
swaps and the tent fold are reflections glued continuously; `R` is a rotation) except the
uniform scale by `s`. The whole map `F` therefore satisfies `|F(p) − F(q)| ≤ sⁿ|p − q|`.
The surface is `F⁻¹(box)`, and the box distance is itself 1-Lipschitz and zero on the box,
so for any surface point `q`: `sdBox(F(p)) ≤ |F(p) − F(q)| ≤ sⁿ|p − q|`. Dividing by `sⁿ`
gives `DE(p) ≤ dist(p, surface)` for *every* parameter setting. This estimator is a true
lower bound, not an approximation, and marches at `0.95 · DE`.

## 4. What the tests establish

`tests/de.test.ts` checks conservativeness against membership tests that do not use the DE:

| Fractal | Independent membership test | Result enforced |
|---|---|---|
| Menger | exact, from base-3 digits | the DE's sign matches membership at 20,000 points; a full step `DE` never enters the sponge; `|DE(p) − DE(q)| ≤ |p − q|` for random rotations, scales and offsets |
| Mandelbulb | escape time at the same depth | no step longer than 0.03 ever enters the set; shorter steps do so in under 0.2 % of trials |
| Mandelbox | bounded orbit over 400 iterations | no step longer than 0.003 ever enters the set; shorter steps do so in under 2 % of trials |

The Mandelbulb and Mandelbox rows are stated honestly: those estimators are not strict
bounds, and the tests measure how far they can be trusted. The overshoots that remain are
confined to steps much smaller than the features being resolved, and their effect is that
the hit point lands marginally inside the surface rather than on it. A ray cannot tunnel
through a feature that is wider than its step. Every fractal's bounding sphere is also
checked to contain the set.

## 5. From distance to image

- **Distance-adaptive hit threshold.** A pixel at depth `t` covers a world-space width of
  `2·tan(fov/2)·t / height`. A ray stops when `DE < 0.6 ×` that width, so the surface is
  always resolved to about one pixel regardless of zoom: far geometry is not over-marched
  into aliasing and near geometry is not blurred. The same width is the step for the
  normal's central differences, which band-limits the normal to what the pixel can show.
- **Zoom scaling.** The camera stores position in float64 and moves relative to the
  surface: zoom is an exponential approach to the picked point, fly speed is proportional
  to `DE(camera)`, fog density is proportional to `1 / view distance`, and the iteration
  count grows by one each time the view shrinks by the fractal's scale factor.
- **Precision limit.** The shader evaluates `p = o + t·d` in float32, which has about
  `1.2·10⁻⁷` of absolute resolution near `|p| ≈ 1`. The threshold and the normal step are
  floored a few units above that, and the camera stops approaching at `10⁻³` of the
  fractal's coordinate scale, roughly a 1,400× dive on the Mandelbulb. Past that point the
  image would break up into quantisation noise, so the limit is enforced instead.
- **Soft shadows** march toward the sun and keep the smallest ratio of clearance to
  distance travelled, using the closest-approach refinement between consecutive samples
  (Quilez). **Ambient occlusion** compares the DE at five points along the normal with the
  distance stepped; the sampling radius is proportional to view distance.
- **Shading** is Cook–Torrance (GGX distribution, Smith–Schlick visibility, Schlick Fresnel)
  plus Lambert diffuse for a shadowed key light and an unshadowed rim light, hemispheric
  sky light, a Fresnel-weighted reflection of the procedural sky, and exponential fog.
- **Glow** uses the smallest angular clearance `min(DE / t)` seen along a ray that misses.
- **Anti-aliasing** is temporal supersampling: once the view is still, frames jittered by
  a Halton(2,3) sequence are averaged in a float buffer until the sample cap is reached.
- **Post** runs in linear HDR: a 13-tap downsample / tent upsample bloom chain, exposure,
  the ACES filmic fit by Stephen Hill, a vignette, sRGB encoding and a one-LSB dither.

## References

- J. C. Hart, D. J. Sandin, L. H. Kauffman, *Ray Tracing Deterministic 3-D Fractals*, SIGGRAPH 1989.
- J. C. Hart, *Sphere Tracing: A Geometric Method for the Antialiased Ray Tracing of Implicit Surfaces*, 1996.
- D. White, P. Nylander, the Mandelbulb (2009); T. Lowe, the Mandelbox (2010); Knighty, kaleidoscopic IFS (Fractal Forums, 2010).
- I. Quilez, articles on distance estimation, soft shadows and orbit traps (iquilezles.org).
- J. Jimenez, *Next Generation Post Processing in Call of Duty: Advanced Warfare*, SIGGRAPH 2014.

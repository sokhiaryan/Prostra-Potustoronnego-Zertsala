// Field notes: what each fractal is, a few true facts about it, and for every control
// what it does to the shape and something worth trying. Shown in the panel's Guide tab.
// Indices match FRACTALS and each fractal's parameter list.

export interface ParamNote {
  /** What moving the slider does, in terms of what you see. */
  does: string;
  /** A concrete thing to try. */
  tryThis: string;
}

export interface FractalNotes {
  about: string;
  facts: string[];
  params: ParamNote[];
  /** Note for the Iterations slider (3D fractals only). */
  iterations?: ParamNote;
}

export const NOTES: FractalNotes[] = [
  {
    about:
      'A 3D relative of the Mandelbrot set, found by Daniel White and Paul Nylander in 2009. ' +
      'Each step takes a point in spherical coordinates, multiplies both of its angles by the power, ' +
      'raises its distance from the centre to that power, and adds the starting point back. ' +
      'Points whose orbit never flies away make up the solid.',
    facts: [
      'There is no 3D number system that multiplies the way complex numbers do, so the "power" here is a ' +
        'geometric recipe rather than true algebra. That is why nobody has found a single "correct" 3D Mandelbrot set.',
      'The shape repeats power − 1 times around its axis: seven-fold at the classic power 8.',
      'Power 2, the direct analogue of the flat set, is oddly smooth and stretched ("whipped cream"). ' +
        'The famous detail only appears at higher powers.',
      'Every bud carries smaller buds of the same design. Zooming in adds iterations, and each iteration ' +
        'reveals one more generation.',
    ],
    params: [
      {
        does:
          'How many times the angles are multiplied each step. Low values give a few fat lobes; high values ' +
          'give many thin ones and busier surfaces. Between whole numbers the shape tears along a seam, ' +
          'because angles no longer wrap around evenly.',
        tryThis: 'Sweep slowly from 2 to 9 and watch lobes split off. Then stop at 3.5 and look for the seam.',
      },
      {
        does:
          'Adds a fixed turn toward or away from the poles at every step. The buds shear over and ' +
          'the whole solid opens like a flower or closes like a fist.',
        tryThis: 'With power 5, move this to about 0.45: that is the Lotus preset.',
      },
      {
        does: 'Adds a fixed turn around the axis at every step, so each generation of buds is rotated against the last and arms begin to swirl.',
        tryThis: 'Turn on Breathing and watch the arms wind and unwind.',
      },
    ],
    iterations: {
      does:
        'How many times the recipe is applied. Each extra step carves one finer level of detail and ' +
        'eats away a little more of the solid. The view adds steps by itself as you zoom in.',
      tryThis: 'Drop to 3 to see the smooth "first draft" of the shape, then raise it one step at a time.',
    },
  },
  {
    about:
      'Found by Tom Lowe in 2010. Each step folds space like paper at the walls of a box, turns it ' +
      'inside out through a sphere, scales it up and adds the starting point. Nothing is curved in the ' +
      'recipe except that one sphere, yet the result is full of domes, pillars and lattices.',
    facts: [
      'At scale 2 the whole object fits a cube from −6 to 6, and the same architecture keeps appearing ' +
        'at every size inside it.',
      'Wandering inside, you can find regions that resemble other classic fractals: sponges, gaskets and foams ' +
        'all turn up somewhere in the box.',
      'The distance estimate comes from tracking how much each fold stretches space, so the camera always ' +
        'knows roughly how far the nearest wall is without ever storing a model.',
    ],
    params: [
      {
        does:
          'How much each step enlarges the folded space. Near 2 the structure is open, with halls and ' +
          'lattices; toward 3 it closes into dense carved stone.',
        tryThis: 'Compare Cathedral (2.0) with Reliquary (2.6), then drift between them.',
      },
      {
        does:
          'Size of the inner sphere of the inversion. Small values push points near the centre far ' +
          'outward, blowing bubbles and domes into the walls. At 1 the sphere fold switches off and ' +
          'everything turns boxy.',
        tryThis: 'Slide from 0.5 up to 1 and watch the round forms flatten into pure boxes.',
      },
      {
        does: 'Where the mirror walls of the box fold sit. Moving them changes how the folded copies overlap, and with it the size of the whole object.',
        tryThis: 'Nudge it by a few hundredths while looking down a corridor.',
      },
    ],
    iterations: {
      does: 'Number of fold-and-scale steps. More steps add finer panelling to every surface.',
      tryThis: 'Lower it to 6 to see the coarse skeleton that all the detail is built on.',
    },
  },
  {
    about:
      'The Menger sponge (Karl Menger, 1926): cut a cube into 27 smaller cubes, remove the centre and the ' +
      'middle of each face, and repeat on the 20 that remain. Here it is built by folding space ' +
      'instead of copying cubes, which lets the folds be rotated: a "kaleidoscopic" fractal, an idea ' +
      'introduced by the fractal artist Knighty in 2010.',
    facts: [
      'With scale 3, no rotation and depth offset 1 this is the exact Menger sponge. Its dimension is ' +
        'log 20 / log 3 ≈ 2.727: more than a surface, less than a solid.',
      'Carried on forever, the sponge has zero volume and infinite surface area.',
      'Cut the true sponge through its centre, perpendicular to a long diagonal, and the cross-section ' +
        'is full of six-pointed stars.',
      'Folds and rotations do not stretch space, so the distance estimate here is exact and the renderer ' +
        'can take full-size steps. This is the fastest of the three shapes.',
    ],
    params: [
      {
        does:
          'How much smaller each generation is. At 3 the pieces meet exactly, as in the true sponge. ' +
          'Lower values make them overlap into a chunky solid; higher values pull them apart into dust.',
        tryThis: 'Go from 3 down to 2.5: the holes close up. Then up to 3.4: the sponge comes apart.',
      },
      {
        does: 'Rotates space a little between folds. The square holes skew into shards, thorns and spirals.',
        tryThis: 'A touch is enough: set it to 0.05, then 0.2. Thornfield uses 0.22.',
      },
      {
        does: 'A second rotation, about a different axis. Together with rotation A it covers every tilt.',
        tryThis: 'Give A and B opposite signs for twisted, asymmetric towers.',
      },
      {
        does: 'Shifts the fold along one axis, which stretches or squashes the pattern in that direction only.',
        tryThis: 'Lower it to 0.7 to turn the cubes into slabs.',
      },
    ],
    iterations: {
      does: 'How many times the cube is subdivided. Each step replaces every cube with 20 smaller ones.',
      tryThis: 'Step through 1, 2, 3, 4 to watch the classic construction happen.',
    },
  },
  {
    about:
      'The Mandelbrot set. For every point c of the plane, start at zero and repeat z → z² + c. ' +
      'If z stays bounded forever, c belongs to the set (black). Everywhere else is coloured by how ' +
      'quickly z escapes. That one line of arithmetic produces everything you can find here.',
    facts: [
      'The set is connected: every black island you find is joined to the main body by filaments too thin to see ' +
        '(Douady and Hubbard, 1982).',
      'Small copies of the whole set turn up near every point of its boundary, each one decorated differently ' +
        'by its surroundings.',
      'The boundary is as crinkled as a curve can possibly be: its fractal dimension is 2 (Shishikura, 1998).',
      'π hides in it: approaching the cusp at c = 0.25 from the right by a distance ε, the number of ' +
        'steps a point takes to escape is close to π / √ε.',
      'Along the real axis the bulbs shrink by a factor that tends to 4.669…, the Feigenbaum constant, ' +
        'the same number that governs period doubling in dripping taps and electronic circuits.',
      'At c = i the set looks the same at every magnification (Tan Lei, 1990), each zoom a slightly ' +
        'rotated copy of the last. That is why the Dendrite preset can dive past 10³⁰⁰ and still be quick to draw.',
    ],
    params: [
      {
        does:
          'How long a point is followed before it is declared part of the set. Too low, and fine detail ' +
          'near the boundary melts into black blobs. Higher is more faithful and slower. The budget also ' +
          'grows by itself as you zoom.',
        tryThis: 'If spirals end in blurry black smears, raise this until they sharpen.',
      },
      {
        does: 'How fast the palette cycles as the escape time grows. Low values give broad, calm bands; high values make every filament stand out.',
        tryThis: 'Zoom somewhere busy and move this until the structure reads clearly.',
      },
    ],
  },
];

/** How the renderer keeps going as you zoom; shown under every fractal in the Guide. */
export const DEPTH_NOTES: string[] = [
  'The graphics card draws with 7-digit numbers. About a thousand times into a 3D shape, or a few hundred ' +
    'times into the flat set, neighbouring pixels can no longer be told apart.',
  'From there the picture is computed on every core of your processor with 16-digit numbers, coarse first, ' +
    'then sharper. In 3D that reaches roughly a billion times magnification.',
  'The flat set has no limit at all. One reference orbit is computed with as many digits as the depth ' +
    'needs (hundreds, then thousands), and every pixel only tracks its tiny difference from it. ' +
    'Past 10³⁰⁸ even those differences fall off the end of ordinary numbers and get their own exponent.',
  'Deeper pictures take longer. The pill at the bottom left shows what is being computed.',
];

// Quests: small discoveries to make while exploring. Each one is a pure predicate over a
// snapshot of what the explorer is doing, so the list is easy to test and to extend.
import { BOX, BULB, KIFS, MANDEL } from '../app/fractals';

/** What the quests can see. Built by main.ts a few times per second. */
export interface QuestContext {
  fractal: number;
  params: ArrayLike<number>;
  /** log10 of the current magnification relative to the overview. */
  depth: number;
  /** True while the picture is being computed on the CPU (beyond GPU precision). */
  cpu: boolean;
  /** Centre of the 2D view (only meaningful when fractal is MANDEL). */
  cx: number;
  cy: number;
  breathing: boolean;
  fractalsSeen: number;
  palettesSeen: number;
  paletteCount: number;
  /** One-off actions that have happened: 'png', 'bookmark', 'surprise', 'mutate', 'share', 'boost', 'slide'. */
  events: ReadonlySet<string>;
  /** Motes collected across all worlds. */
  motes: number;
  /** Every mote of at least one world has been collected. */
  worldComplete: boolean;
  /** One of the three deepest motes of any world has been collected. */
  deepMote: boolean;
  worldsOpen: number;
  worldCount: number;
}

export interface Quest {
  id: string;
  title: string;
  /** How to get there. */
  hint: string;
  /** Shown once it is done: what was just seen. */
  reward: string;
  done(c: QuestContext): boolean;
}

const near = (c: QuestContext, re: number, im: number, radius: number): boolean =>
  c.fractal === MANDEL && Math.hypot(c.cx - re, Math.abs(c.cy) - Math.abs(im)) < radius;

export const QUESTS: Quest[] = [
  {
    id: 'closer',
    title: 'A closer look',
    hint: 'Fly up to a surface, or scroll in Study, until the depth reads 5×.',
    reward: 'Flight slows as a surface nears, so there is always time to look.',
    done: (c) => c.depth >= Math.log10(5),
  },
  {
    id: 'firstlight',
    title: 'First light',
    hint: 'Fly into a mote. The ring on screen points to the nearest one.',
    reward: 'Each world hides seven, each deeper in than the last.',
    done: (c) => c.motes >= 1,
  },
  {
    id: 'afterburner',
    title: 'Afterburner',
    hint: 'Hold Shift while flying.',
    reward: 'The scroll wheel changes gear as well, from a crawl to four times the pace.',
    done: (c) => c.events.has('boost'),
  },
  {
    id: 'wallrider',
    title: 'Wall rider',
    hint: 'Fly into a surface at a shallow angle and keep going.',
    reward: 'The camera glances off instead of stopping, so tunnels can be followed by feel.',
    done: (c) => c.events.has('slide'),
  },
  {
    id: 'descent',
    title: 'The descent',
    hint: 'Collect one of the three deepest motes of any world.',
    reward: 'It sat more than ten times deeper in than the first one.',
    done: (c) => c.deepMote,
  },
  {
    id: 'seven',
    title: 'All seven',
    hint: 'Collect every mote in one world.',
    reward: 'One world known from its skin to its smallest crevice.',
    done: (c) => c.worldComplete,
  },
  {
    id: 'cartographer',
    title: 'Cartographer',
    hint: 'Collect enough motes to open every world.',
    reward: 'Six shapes, three rules. The rest is parameters.',
    done: (c) => c.worldsOpen >= c.worldCount,
  },
  {
    id: 'worlds',
    title: 'Four fractals',
    hint: 'Visit all four fractals, including the flat one in Deep Zoom.',
    reward: 'Three solids and one flat set, all from repeating a simple rule.',
    done: (c) => c.fractalsSeen >= 4,
  },
  {
    id: 'chromatic',
    title: 'Chromatic',
    hint: 'Try every palette in the Tuner (key T).',
    reward: 'Colour follows the orbit: where a point wandered, or how fast it escaped.',
    done: (c) => c.palettesSeen >= c.paletteCount,
  },
  {
    id: 'breathe',
    title: 'It is alive',
    hint: 'Turn on Breathing (key B).',
    reward: 'A fractal is a whole family of shapes; breathing walks through its neighbours.',
    done: (c) => c.breathing,
  },
  {
    id: 'cream',
    title: 'Whipped cream',
    hint: 'Mandelbulb: lower Power to 2 in the Tuner.',
    reward: 'The direct 3D analogue of the flat set turns out strangely smooth.',
    done: (c) => c.fractal === BULB && c.params[0] <= 2.05,
  },
  {
    id: 'seam',
    title: 'The seam',
    hint: 'Mandelbulb: set Power between whole numbers, such as 3.5.',
    reward: 'Fractional powers cannot wrap around evenly, so the surface tears.',
    done: (c) => c.fractal === BULB && Math.abs(c.params[0] - Math.round(c.params[0])) > 0.4,
  },
  {
    id: 'boxy',
    title: 'No more spheres',
    hint: 'Mandelbox: raise Inner radius to 1.',
    reward: 'With the sphere fold off, only mirrors remain and every curve disappears.',
    done: (c) => c.fractal === BOX && c.params[1] >= 0.99,
  },
  {
    id: 'sponge',
    title: 'The true sponge',
    hint: 'Kaleido Menger: Scale 3, both rotations 0, Depth offset 1, then zoom in 30×.',
    reward: 'Zero volume, infinite surface, dimension 2.727.',
    done: (c) =>
      c.fractal === KIFS &&
      Math.abs(c.params[0] - 3) < 0.011 &&
      Math.abs(c.params[1]) < 0.005 &&
      Math.abs(c.params[2]) < 0.005 &&
      Math.abs(c.params[3] - 1) < 0.011 &&
      c.depth >= Math.log10(30),
  },
  {
    id: 'kaleido',
    title: 'Kaleidoscope',
    hint: 'Kaleido Menger: turn the fold rotations until A and B add up to 0.3 or more.',
    reward: 'A few degrees between folds turns a sponge into thorns.',
    done: (c) => c.fractal === KIFS && Math.abs(c.params[1]) + Math.abs(c.params[2]) >= 0.3,
  },
  {
    id: 'hundred',
    title: 'Into the surface',
    hint: 'Get within a hundredth of a world\'s size of its surface: depth 100×.',
    reward: 'The view adds iterations as you descend, so there is always new detail.',
    done: (c) => c.fractal !== MANDEL && c.depth >= 2,
  },
  {
    id: 'floatline',
    title: 'Past the float line',
    hint: 'Flight ends near 1,000×. Switch to Study (Tab) and keep scrolling in until the processor takes over.',
    reward: 'The graphics card ran out of digits; your CPU cores are drawing now.',
    done: (c) => c.fractal !== MANDEL && c.cpu,
  },
  {
    id: 'million',
    title: 'One in a million',
    hint: 'In Study (Tab), zoom a 3D fractal to 1,000,000×.',
    reward: 'If what you see now were a metre across, the whole shape would span a thousand kilometres.',
    done: (c) => c.fractal !== MANDEL && c.depth >= 6,
  },
  {
    id: 'seahorse',
    title: 'Seahorse Valley',
    hint: 'Mandelbrot: zoom to 30× into the crease between the big heart and the disc on its left, near −0.75 + 0.1i.',
    reward: 'Spirals shaped like seahorse tails line the whole valley.',
    done: (c) => near(c, -0.745, 0.11, 0.04) && c.depth >= Math.log10(30),
  },
  {
    id: 'elephant',
    title: 'Elephant Valley',
    hint: 'Mandelbrot: zoom to 20× at the dent on the right side of the heart, near 0.28 + 0.01i.',
    reward: 'A parade of trunks, each one a spiral that never quite closes.',
    done: (c) => near(c, 0.28, 0.01, 0.04) && c.depth >= Math.log10(20),
  },
  {
    id: 'mini',
    title: 'A copy of everything',
    hint: 'Mandelbrot: follow the needle to the left and zoom to 30× at −1.7549.',
    reward: 'A complete miniature set. There are infinitely many more.',
    done: (c) => near(c, -1.7549, 0, 0.012) && c.depth >= Math.log10(30),
  },
  {
    id: 'doubles',
    title: 'Beyond sixteen digits',
    hint: 'Mandelbrot: zoom past 10¹⁶×.',
    reward: 'Ordinary computer numbers stop here. Each pixel now follows a high-precision reference orbit.',
    done: (c) => c.fractal === MANDEL && c.depth >= 16,
  },
  {
    id: 'planck',
    title: 'Smaller than physics',
    hint: 'Mandelbrot: zoom past 10³⁵×.',
    reward: 'If the first view were a metre wide, this one would be narrower than the Planck length.',
    done: (c) => c.fractal === MANDEL && c.depth >= 35,
  },
  {
    id: 'googol',
    title: 'Googol',
    hint: 'Mandelbrot: zoom past 10¹⁰⁰×. The Dendrite preset is a fast way down.',
    reward: 'A googol: far more than the number of atoms in the observable universe (about 10⁸⁰).',
    done: (c) => c.fractal === MANDEL && c.depth >= 100,
  },
  {
    id: 'offscale',
    title: 'Off the end of the number line',
    hint: 'Mandelbrot: zoom past 10³⁰⁸×.',
    reward: 'A pixel is now smaller than the smallest number a double can hold. The arithmetic carries its own exponent.',
    done: (c) => c.fractal === MANDEL && c.depth >= 308,
  },
  {
    id: 'dice',
    title: 'Roll the dice',
    hint: 'Press X for a random shape, or a random place in the flat set.',
    reward: 'Most random settings are dull, a few are wonderful. Mutate (key M) searches around the good ones.',
    done: (c) => c.events.has('surprise'),
  },
  {
    id: 'collector',
    title: 'Collector',
    hint: 'Bookmark a place you like (key K).',
    reward: 'Bookmarks keep the exact view, however deep. They wait in the Gallery.',
    done: (c) => c.events.has('bookmark'),
  },
  {
    id: 'postcard',
    title: 'Postcard',
    hint: 'Open Photo mode (key P) and save a PNG.',
    reward: 'The file is the finished image at full quality. Try the aperture for depth of field.',
    done: (c) => c.events.has('png'),
  },
];

/** Ids of quests that are satisfied now and not yet in `done`. */
export function newlyDone(c: QuestContext, done: ReadonlySet<string>): Quest[] {
  return QUESTS.filter((q) => !done.has(q.id) && q.done(c));
}

import { describe, expect, it } from 'vitest';
import { BOX, BULB, KIFS, MANDEL } from '../src/app/fractals';
import { PRESETS } from '../src/app/presets';
import { QUESTS, newlyDone } from '../src/explore/quests';
import type { QuestContext } from '../src/explore/quests';
import { TIER_SCALES } from '../src/game/motes';

/** A player who has just arrived and done nothing. */
function fresh(patch: Partial<QuestContext> = {}): QuestContext {
  return {
    fractal: BULB,
    params: [8, 0, 0, 0],
    depth: 0,
    cpu: false,
    cx: -0.65,
    cy: 0,
    breathing: false,
    fractalsSeen: 1,
    palettesSeen: 1,
    paletteCount: 6,
    events: new Set(),
    motes: 0,
    worldComplete: false,
    deepMote: false,
    worldsOpen: 2,
    worldCount: 6,
    ...patch,
  };
}

const ids = (c: QuestContext): string[] => newlyDone(c, new Set()).map((q) => q.id);

describe('quests', () => {
  it('have unique ids and nothing is done on arrival', () => {
    expect(new Set(QUESTS.map((q) => q.id)).size).toBe(QUESTS.length);
    expect(ids(fresh())).toEqual([]);
    // The worlds open from the start and the Deep Zoom presets, as the player first sees them.
    for (const p of PRESETS.filter((q) => !q.unlockAt)) {
      expect(ids(fresh({ fractal: p.fractal, params: p.params }))).toEqual([]);
    }
    // Later worlds may complete a shape quest just by being entered: Thornfield is a kaleidoscope.
    const thornfield = PRESETS.find((p) => p.id === 'thornfield')!;
    expect(ids(fresh({ fractal: thornfield.fractal, params: thornfield.params }))).toEqual(['kaleido']);
    expect(ids(fresh({ fractal: BOX, params: [2, 0.5, 1, 0] }))).toEqual([]);
  });

  it('no longer ask for the panel to be hidden', () => {
    expect(QUESTS.some((q) => q.id === 'darkroom')).toBe(false);
    expect(QUESTS.some((q) => /panel/i.test(q.hint + q.reward))).toBe(false);
  });

  it('reward the first mote, a deep mote, a finished world and opening every world', () => {
    expect(ids(fresh({ motes: 1 }))).toEqual(['firstlight']);
    expect(ids(fresh({ motes: 3, deepMote: true }))).toEqual(['firstlight', 'descent']);
    expect(ids(fresh({ motes: 7, deepMote: true, worldComplete: true }))).toEqual(['firstlight', 'descent', 'seven']);
    expect(ids(fresh({ worldsOpen: 5 }))).not.toContain('cartographer');
    expect(ids(fresh({ worldsOpen: 6 }))).toContain('cartographer');
  });

  it('the deep-mote reward states a true ratio for every deep tier', () => {
    // "more than ten times deeper in than the first one"
    for (const s of TIER_SCALES.slice(-3)) expect(TIER_SCALES[0] / s).toBeGreaterThan(10);
  });

  it('reward flying fast and glancing off walls', () => {
    expect(ids(fresh({ events: new Set(['boost']) }))).toEqual(['afterburner']);
    expect(ids(fresh({ events: new Set(['slide']) }))).toEqual(['wallrider']);
  });

  it('keep the depth and place quests working', () => {
    expect(ids(fresh({ depth: 0.7 }))).toEqual(['closer']);
    expect(ids(fresh({ depth: 2 }))).toEqual(['closer', 'hundred']);
    expect(ids(fresh({ depth: 3.1, cpu: true }))).toEqual(['closer', 'hundred', 'floatline']);
    expect(ids(fresh({ fractal: MANDEL, depth: 1.5, cx: -0.745, cy: 0.11 }))).toEqual(['closer', 'seahorse']);
    expect(ids(fresh({ fractal: MANDEL, depth: 1.5, cx: -0.745, cy: -0.11 }))).toEqual(['closer', 'seahorse']); // mirror image
    expect(ids(fresh({ fractal: KIFS, params: [3, 0, 0, 1], depth: 1.5 }))).toEqual(['closer', 'sponge']);
  });

  it('are not offered again once done', () => {
    const c = fresh({ motes: 1, depth: 1 });
    expect(newlyDone(c, new Set(['firstlight'])).map((q) => q.id)).toEqual(['closer']);
    expect(newlyDone(c, new Set(['firstlight', 'closer', 'darkroom']))).toEqual([]);
  });
});

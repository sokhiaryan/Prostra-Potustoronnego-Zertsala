import { describe, expect, it } from 'vitest';
import { FRACTALS, KIFS } from '../src/app/fractals';
import { PRESETS } from '../src/app/presets';
import { NOTES } from '../src/explore/notes';
import {
  MOTES_PER_WORLD,
  TIER_SCALES,
  generateMotes,
  hashString,
  moteCollectRadius,
  moteDepth,
  moteGlowRadius,
  mulberry32,
} from '../src/game/motes';
import {
  TOTAL_MOTES,
  WORLDS,
  anyDeepMote,
  anyWorldComplete,
  collectMote,
  factsRevealed,
  hasMote,
  isOpen,
  motesToNextFact,
  totalMotes,
  worldMotes,
  worldOf,
  worldsOpen,
} from '../src/game/progress';
import { kifsRotation } from '../src/math/de';

describe('seeded generator', () => {
  it('is deterministic and uniform enough', () => {
    const a = mulberry32(hashString('zertsalo'));
    const b = mulberry32(hashString('zertsalo'));
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
    expect(hashString('zertsalo')).not.toBe(hashString('lotus'));
  });
});

describe('motes', () => {
  it('there are six worlds with unique ids, two of them open from the start', () => {
    expect(WORLDS.length).toBe(6);
    expect(new Set(WORLDS.map((w) => w.id)).size).toBe(6);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(WORLDS.filter((w) => w.unlockAt === 0).length).toBe(2);
    expect(TOTAL_MOTES).toBe(42);
    expect(TIER_SCALES.length).toBe(MOTES_PER_WORLD);
  });

  for (const world of WORLDS) {
    const preset = PRESETS[world.preset];
    describe(preset.name, () => {
      const motes = generateMotes(preset);
      const def = FRACTALS[preset.fractal];
      const bound = def.bound(preset.params);
      const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      if (preset.fractal === KIFS) kifsRotation(preset.params[1], preset.params[2], rot);

      it('places one mote per tier, the same every time', () => {
        expect(motes.length).toBe(MOTES_PER_WORLD);
        expect(motes.map((m) => m.tier)).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(generateMotes(preset)).toEqual(motes);
      });

      it('each mote hovers in open space just above the surface, inside the world', () => {
        for (const m of motes) {
          expect(m.scale).toBeCloseTo(TIER_SCALES[m.tier] * bound, 12);
          expect(Math.hypot(m.x, m.y, m.z)).toBeLessThan(bound);
          // The surface as drawn when the player is this close (iterations follow zoom).
          const extra = Math.floor(Math.log(Math.max(1, bound / (1.5 * m.scale))) / Math.log(def.detailBase(preset.params)));
          const d = def.dist(preset.params, rot, Math.min(64, preset.iter + extra), m.x, m.y, m.z);
          expect(d).toBeGreaterThanOrEqual(m.scale * 0.12);
          expect(d).toBeLessThanOrEqual(m.scale * 0.6);
          // Reachable: the collection sphere is wider than the closest the camera may be kept from a wall.
          expect(moteCollectRadius(m)).toBeGreaterThan(1e-3 * def.coordScale(preset.params));
          expect(moteGlowRadius(m)).toBeLessThan(moteCollectRadius(m));
        }
      });

      it('motes get deeper, and the deepest stays within reach of free flight', () => {
        const depths = motes.map((m) => moteDepth(m, bound));
        for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1]);
        expect(depths[0]).toBeGreaterThan(0.3);
        expect(depths[depths.length - 1]).toBeLessThan(2.6); // flight ends near 1,000×
      });

      it('no two motes share a spot', () => {
        for (let i = 0; i < motes.length; i++) {
          for (let j = i + 1; j < motes.length; j++) {
            const a = motes[i];
            const b = motes[j];
            expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(moteCollectRadius(b));
          }
        }
      });
    });
  }
});

describe('progress', () => {
  it('collects each mote once and counts them', () => {
    const motes: Record<string, number> = {};
    expect(collectMote(motes, 'zertsalo', 0)).toBe(true);
    expect(collectMote(motes, 'zertsalo', 0)).toBe(false);
    expect(collectMote(motes, 'zertsalo', 6)).toBe(true);
    expect(collectMote(motes, 'zertsalo', 7)).toBe(false);
    expect(collectMote(motes, 'zertsalo', -1)).toBe(false);
    expect(hasMote(motes, 'zertsalo', 6)).toBe(true);
    expect(hasMote(motes, 'zertsalo', 1)).toBe(false);
    expect(worldMotes(motes, 'zertsalo')).toBe(2);
    expect(totalMotes(motes)).toBe(2);
    expect(anyDeepMote(motes)).toBe(true);
    expect(anyDeepMote({ zertsalo: 0b0001111 })).toBe(false);
    expect(anyWorldComplete(motes)).toBe(false);
    expect(anyWorldComplete({ lattice: 0b1111111 })).toBe(true);
  });

  it('ignores ids that are not worlds and bits beyond the last mote', () => {
    expect(totalMotes({ nowhere: 0b111, zertsalo: 0b1 })).toBe(1);
    expect(worldMotes({ zertsalo: 0xffff }, 'zertsalo')).toBe(MOTES_PER_WORLD);
  });

  it('opens worlds as motes are collected, and all of them before the motes run out', () => {
    expect(worldsOpen({})).toBe(2);
    const cathedral = WORLDS.find((w) => w.id === 'cathedral')!;
    expect(isOpen(cathedral, { zertsalo: 0b11 })).toBe(false);
    expect(isOpen(cathedral, { zertsalo: 0b11, lattice: 0b1 })).toBe(true);
    // Every threshold can be met from the worlds that are already open at that point.
    const order = [...WORLDS].sort((a, b) => a.unlockAt - b.unlockAt);
    order.forEach((w, i) => expect(w.unlockAt).toBeLessThanOrEqual(i * MOTES_PER_WORLD));
    const all = Object.fromEntries(WORLDS.map((w) => [w.id, 0b1111111]));
    expect(worldsOpen(all)).toBe(WORLDS.length);
    expect(totalMotes(all)).toBe(TOTAL_MOTES);
  });

  it('recognises a world by its shape', () => {
    WORLDS.forEach((w, i) => {
      const p = PRESETS[w.preset];
      expect(worldOf(p.fractal, p.params)).toBe(i);
    });
    expect(worldOf(0, [8.01, 0, 0, 0])).toBe(-1);
    expect(worldOf(3, [1, 1, 0, 0])).toBe(-1); // the flat set is not a world
  });

  it('reveals codex facts gradually and all of them well before every mote is found', () => {
    for (let f = 0; f < 3; f++) {
      const ids = WORLDS.filter((w) => PRESETS[w.preset].fractal === f).map((w) => w.id);
      expect(ids.length).toBe(2);
      const facts = NOTES[f].facts.length;
      expect(factsRevealed(f, {})).toBe(0);
      expect(motesToNextFact(f, {})).toBeGreaterThan(0);
      let last = 0;
      const motes: Record<string, number> = {};
      for (const id of ids) {
        for (let i = 0; i < MOTES_PER_WORLD; i++) {
          const need = motesToNextFact(f, motes);
          collectMote(motes, id, i);
          const now = factsRevealed(f, motes);
          expect(now).toBeGreaterThanOrEqual(last);
          if (need === 1) expect(now).toBe(last + 1); // the promise made in the codex is kept
          last = now;
        }
      }
      expect(last).toBe(facts);
      expect(motesToNextFact(f, motes)).toBe(0);
      const mostly = { [ids[0]]: 0b1111111, [ids[1]]: 0b0000011 }; // 9 of 14
      expect(factsRevealed(f, mostly)).toBe(facts);
    }
    expect(factsRevealed(3, {})).toBe(NOTES[3].facts.length); // the flat set has no motes: nothing is hidden
  });
});

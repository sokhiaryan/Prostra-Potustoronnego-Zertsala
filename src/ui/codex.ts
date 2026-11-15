// The Codex: discoveries made so far, and what is known about each fractal. Facts about
// a 3D fractal are revealed by collecting motes in its worlds.
import { FRACTALS } from '../app/fractals';
import { DEPTH_NOTES, NOTES } from '../explore/notes';
import { QUESTS } from '../explore/quests';
import type { Saved } from '../explore/store';
import { factsRevealed, motesToNextFact } from '../game/progress';
import { el, facts, section } from './widgets';

/** Build the Codex page. The section of the fractal on screen starts open. */
export function buildCodex(saved: Saved, current: number): HTMLElement {
  const page = el('div', 'codex');

  const done = new Set(saved.quests);
  const n = QUESTS.filter((q) => done.has(q.id)).length;
  const head = el('div', 'quest-head');
  head.append(el('span', 'quest-lead', 'Discoveries'), el('span', 'quest-count', `${n} of ${QUESTS.length}`));
  const bar = el('div', 'bar');
  const fill = el('div', 'bar-fill');
  fill.style.width = `${(100 * n) / QUESTS.length}%`;
  bar.append(fill);
  const list = el('ol', 'quest-list');
  for (const q of QUESTS) {
    const li = el('li', done.has(q.id) ? 'quest done' : 'quest');
    li.append(el('span', 'quest-title', q.title), el('span', 'quest-text', done.has(q.id) ? q.reward : q.hint));
    list.append(li);
  }
  page.append(head, bar, list);

  FRACTALS.forEach((def, i) => {
    const notes = NOTES[i];
    if (!notes) return;
    const s = section(def.name);
    if (i !== current) {
      s.root.classList.add('collapsed');
      s.root.firstElementChild?.setAttribute('aria-expanded', 'false');
    }
    s.body.append(el('p', 'guide-text', notes.about));
    const shown = factsRevealed(i, saved.motes);
    if (shown > 0) s.body.append(facts(notes.facts.slice(0, shown)));
    if (shown < notes.facts.length) {
      const more = motesToNextFact(i, saved.motes);
      const left = notes.facts.length - shown;
      s.body.append(
        el(
          'p',
          'codex-locked',
          `${left} more ${left === 1 ? 'fact' : 'facts'} to find. The next appears after ${more} more ` +
            `${more === 1 ? 'mote' : 'motes'} in this fractal's worlds.`,
        ),
      );
    }
    page.append(s.root);
  });

  const depth = section('How deep can it go?');
  depth.root.classList.add('collapsed');
  depth.root.firstElementChild?.setAttribute('aria-expanded', 'false');
  depth.body.append(facts(DEPTH_NOTES));
  page.append(depth.root);

  const keys = section('Controls');
  keys.root.classList.add('collapsed');
  keys.root.firstElementChild?.setAttribute('aria-expanded', 'false');
  keys.body.append(
    facts([
      'Free Fly: the mouse looks, W A S D move, Space or E rises, Q sinks, Shift boosts, the wheel changes speed.',
      'Study: drag to orbit the point under the cursor, scroll or pinch to zoom toward it, Shift-drag or two fingers to pan.',
      'Deep Zoom: drag to move, scroll or pinch to zoom at the cursor.',
      'Tab switches between flying and Study. T opens the Tuner, P opens Photo mode, Esc pauses.',
      'R returns to the start of the world, B toggles breathing, M mutates the shape, X jumps somewhere new.',
    ]),
  );
  page.append(keys.root);
  return page;
}

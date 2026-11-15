// Small DOM builders shared by the menu, the Tuner, Settings and Photo mode. Plain DOM;
// each control reads and writes through the getters and setters it is given.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(cls: string, text: string, title?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
  /** Shown under the slider: what it does, and something to try. */
  note?: { does: string; tryThis: string };
  /** How to show the value; defaults to as many decimals as the step has. */
  format?(v: number): string;
  get(): number;
  set(v: number): void;
}

function decimals(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(3, s.length - i - 1);
}

/** A labelled range input; returns the row and a function that re-syncs it from the state. */
export function slider(spec: SliderSpec, onChange: () => void): { row: HTMLElement; sync: () => void } {
  const row = el('div', 'row');
  const field = el('label', 'row-field');
  if (spec.hint) field.title = spec.hint;
  const head = el('span', 'row-head');
  const name = el('span', 'row-name', spec.label);
  const value = el('span', 'row-value');
  head.append(name, value);
  const input = el('input');
  input.type = 'range';
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const dp = decimals(spec.step);
  const sync = (): void => {
    const v = spec.get();
    input.value = String(v);
    value.textContent = spec.format ? spec.format(v) : v.toFixed(dp);
    input.style.setProperty('--fill', `${((v - spec.min) / (spec.max - spec.min)) * 100}%`);
  };
  input.addEventListener('input', () => {
    spec.set(Number(input.value));
    sync();
    onChange();
  });
  field.append(head, input);
  row.append(field);
  if (spec.note) {
    const note = el('p', 'row-note', spec.note.does);
    const tryThis = el('p', 'row-note row-try');
    tryThis.append(el('span', 'tag', 'Try'), document.createTextNode(spec.note.tryThis));
    row.append(note, tryThis);
  }
  sync();
  return { row, sync };
}

/** A section whose title collapses and expands its body. */
export function section(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', 'section');
  const head = button('section-title', title);
  head.setAttribute('aria-expanded', 'true');
  const body = el('div', 'section-body');
  head.addEventListener('click', () => {
    const collapsed = root.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
  });
  root.append(head, body);
  return { root, body };
}

/** A row of mutually exclusive buttons; `sync` re-reads which one is current. */
export function choice(
  cls: string,
  labels: string[],
  current: () => number,
  pick: (i: number) => void,
  decorate?: (b: HTMLButtonElement, i: number) => void,
): { root: HTMLElement; sync: () => void } {
  const root = el('div', cls);
  const buttons = labels.map((label, i) => {
    const b = button('chip', label);
    decorate?.(b, i);
    b.addEventListener('click', () => pick(i));
    root.append(b);
    return b;
  });
  const sync = (): void => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === current())));
  sync();
  return { root, sync };
}

/** An on/off button with a label and a short explanation. */
export function toggle(
  label: string,
  hint: string,
  get: () => boolean,
  set: (v: boolean) => void,
  onChange: () => void,
): { row: HTMLElement; sync: () => void } {
  const row = el('div', 'toggle-row');
  const text = el('div', 'toggle-text');
  text.append(el('span', 'row-name', label), el('span', 'row-note', hint));
  const b = button('switch', '');
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', label);
  const sync = (): void => b.setAttribute('aria-checked', String(get()));
  b.addEventListener('click', () => {
    set(!get());
    sync();
    onChange();
  });
  row.append(text, b);
  sync();
  return { row, sync };
}

/** A list of true statements, as bullet points. */
export function facts(items: string[]): HTMLElement {
  const ul = el('ul', 'facts');
  for (const item of items) ul.append(el('li', undefined, item));
  return ul;
}

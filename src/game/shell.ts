// Which screen the game is on and what the player is doing in the world. The shell holds
// no game logic: it records the state, mirrors it onto <body> for the stylesheet, and
// tells listeners when it changes.

/** menu: main menu over the attract view. play: in a world. pause: Esc menu. tuner / photo: side sheets over a live view. */
export type Screen = 'menu' | 'play' | 'pause' | 'tuner' | 'photo';
/** fly: mouse-look flight. study: orbit camera, with the deep renderer. flat: the 2D set. */
export type Activity = 'fly' | 'study' | 'flat';
/** What dragging, scrolling and keys on the canvas control right now. */
export type InputMode = Activity | 'off';

export type ShellListener = (prevScreen: Screen, prevActivity: Activity) => void;

export class Shell {
  screen: Screen = 'menu';
  activity: Activity = 'study';
  private readonly listeners: ShellListener[] = [];

  constructor() {
    this.apply();
  }

  onChange(fn: ShellListener): void {
    this.listeners.push(fn);
  }

  set(screen: Screen, activity: Activity = this.activity): void {
    if (screen === this.screen && activity === this.activity) return;
    const prevScreen = this.screen;
    const prevActivity = this.activity;
    this.screen = screen;
    this.activity = activity;
    this.apply();
    for (const fn of this.listeners) fn(prevScreen, prevActivity);
  }

  /** True while the world is the thing being interacted with (as opposed to a full-screen menu). */
  get inWorld(): boolean {
    return this.screen === 'play' || this.screen === 'tuner' || this.screen === 'photo';
  }

  /** The camera flies only during play; the Tuner and Photo mode leave the view orbitable instead. */
  get flying(): boolean {
    return this.screen === 'play' && this.activity === 'fly';
  }

  inputMode(): InputMode {
    if (this.screen === 'play') return this.activity;
    if (this.screen === 'tuner' || this.screen === 'photo') return this.activity === 'flat' ? 'flat' : 'study';
    return 'off';
  }

  private apply(): void {
    if (typeof document === 'undefined') return;
    document.body.dataset.screen = this.screen;
    document.body.dataset.activity = this.activity;
  }
}

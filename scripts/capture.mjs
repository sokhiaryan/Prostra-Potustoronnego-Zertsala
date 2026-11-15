// Headless verification: start the production preview, render presets in real Chrome,
// save screenshots to docs/screenshots/ and print image statistics so bad renders
// (black, blown out, flat) are caught by numbers as well as by eye.
//
// Usage: npm run build && npm run capture [-- --out <dir>] [--only <name>]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = resolve(root, argOf('--out', 'docs/screenshots'));
const only = argOf('--only', '');
const PORT = 4173;
const URL = `http://localhost:${PORT}/`;

// Each shot is either a preset opened in Study (with an optional wheel zoom), or steps
// to run first. `ui` keeps the interface in the picture; without it only the image is taken.
const pz = (page, fn) => page.evaluate(fn);
const SHOTS = [
  { name: '01-zertsalo-mandelbulb', preset: 0 },
  { name: '02-lotus-mandelbulb', preset: 1 },
  { name: '03-cathedral-mandelbox', preset: 2 },
  { name: '04-reliquary-mandelbox', preset: 3 },
  { name: '05-lattice-kifs', preset: 4 },
  { name: '06-thornfield-kifs', preset: 5 },
  { name: '07-deep-zoom', preset: 0, zoom: 9 },
  { name: '08-precision-limit', preset: 0, zoom: 30 },
  {
    name: '09-main-menu',
    ui: true,
    // The menu's slow orbit never settles; reduce motion so the frame can converge.
    run: (page) =>
      pz(page, () => {
        window.__pz.settings({ reduceMotion: true });
        window.__pz.preset(0);
        window.__pz.menu();
      }),
  },
  { name: '10-world-select', ui: true, run: (page) => page.getByRole('button', { name: /^Free Fly/ }).click() },
  {
    name: '11-free-fly',
    ui: true,
    run: (page) =>
      pz(page, () => {
        window.__pz.play(2);
        window.__pz.fly({ seconds: 2.5 });
      }),
  },
  { name: '12-tuner', ui: true, run: (page) => pz(page, () => window.__pz.tuner()) },
  {
    name: '13-photo-mode',
    ui: true,
    run: (page) =>
      pz(page, () => {
        window.__pz.resume();
        window.__pz.photo();
      }),
  },
];

function stats(file) {
  const png = PNG.sync.read(readFileSync(file));
  const n = png.width * png.height;
  let sum = 0, sum2 = 0, black = 0, clipped = 0;
  for (let i = 0; i < n; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    sum2 += l * l;
    if (l < 3) black++;
    if (r > 252 && g > 252 && b > 252) clipped++;
  }
  const mean = sum / n;
  return {
    size: `${png.width}x${png.height}`,
    meanLuma: +mean.toFixed(1),
    contrast: +Math.sqrt(sum2 / n - mean * mean).toFixed(1),
    blackPct: +((100 * black) / n).toFixed(1),
    clippedPct: +((100 * clipped) / n).toFixed(2),
  };
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(URL);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = spawn(join(root, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  let failed = false;
  let browser;
  try {
    await waitForServer();
    // Real GPU through ANGLE/Metal when available; Chrome falls back to SwiftShader otherwise.
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

    await page.goto(URL);
    await page.waitForFunction(() => '__pz' in window || !document.getElementById('fatal')?.hidden, null, { timeout: 30000 });
    if (await page.evaluate(() => !document.getElementById('fatal')?.hidden)) {
      throw new Error('app showed its fatal overlay: ' + (await page.evaluate(() => document.getElementById('fatal')?.innerText)));
    }
    console.log('gpu:', JSON.stringify(await page.evaluate(() => window.__pz.info())));

    for (const shot of SHOTS) {
      if (only && !shot.name.includes(only)) continue;
      if (shot.run) await shot.run(page);
      else await page.evaluate((preset) => window.__pz.preset(preset), shot.preset);
      await page.evaluate((clean) => window.__pz.clean(clean), !shot.ui);
      if (shot.zoom) {
        // Drive the real input path: wheel over the surface, a little left of centre.
        await page.mouse.move(700, 430);
        for (let i = 0; i < shot.zoom; i++) {
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(260);
        }
      }
      await page.waitForTimeout(400);
      await page.waitForFunction(() => window.__pz.converged(), null, { timeout: 240000, polling: 200 });
      await page.waitForTimeout(350); // let the HUD text catch up
      const file = join(outDir, `${shot.name}.png`);
      await page.screenshot({ path: file });
      const s = stats(file);
      const info = await page.evaluate(() => window.__pz.info());
      console.log(shot.name, JSON.stringify(s), `viewScale=${info.viewScale.toExponential(2)} ${info.screen}/${info.activity}`);
      // The menu dims the picture on purpose, so the brightness floor applies to clean frames only.
      if ((!shot.ui && s.meanLuma < 12) || s.clippedPct > 8 || s.contrast < 8) {
        console.log(`  !! ${shot.name} looks wrong (too dark, clipped or flat)`);
        failed = true;
      }
    }

    // Interactive performance: orbit for two seconds and read the frame statistics.
    if (!only) {
      await page.evaluate(() => {
        window.__pz.preset(0);
        window.__pz.clean(true);
      });
      await page.mouse.move(800, 450);
      await page.mouse.down();
      for (let i = 0; i < 120; i++) {
        await page.mouse.move(800 + i * 2, 450 + Math.sin(i / 10) * 20);
        await page.waitForTimeout(16);
      }
      const perf = await page.evaluate(() => window.__pz.info());
      await page.mouse.up();
      console.log(`perf while orbiting: fps=${perf.fps.toFixed(1)} scale=${perf.scale.toFixed(2)} gpuMs=${perf.gpuMs.toFixed(2)} size=${perf.size}`);

      // Interaction smoke test: breathing animates, PNG export produces a real image, the
      // screens respond to the keyboard, the headlamp lights interiors and a mote can be collected.
      const check = (ok, label) => {
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
        if (!ok) failed = true;
      };
      await page.keyboard.press('KeyB');
      await page.waitForTimeout(1500);
      const breathing = await page.evaluate(() => ({ ...window.__pz.info(), done: window.__pz.converged() }));
      check(!breathing.done && breathing.fps > 20, `breathing keeps animating (${breathing.fps.toFixed(0)} fps)`);
      await page.keyboard.press('KeyB');
      await page.waitForFunction(() => window.__pz.converged(), null, { timeout: 120000, polling: 200 });
      check(true, 'image converges again after breathing stops');

      await page.evaluate(() => window.__pz.photo());
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Save PNG' }).click(),
      ]);
      const exported = join(outDir, '..', 'export-check.png');
      await download.saveAs(exported);
      const es = stats(exported);
      check(es.size === '1600x900' && es.meanLuma > 12, `PNG export (${es.size}, mean luma ${es.meanLuma})`);
      rmSync(exported, { force: true });

      const where = () => page.evaluate(() => `${window.__pz.info().screen}/${window.__pz.info().activity}`);
      await page.keyboard.press('Escape');
      check((await where()) === 'play/study', `Esc closes Photo mode (${await where()})`);
      await page.keyboard.press('Escape');
      check((await where()) === 'pause/study', `Esc pauses (${await where()})`);
      await page.waitForTimeout(350);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      check((await where()) === 'tuner/study', `arrow keys and Enter choose a pause menu item (${await where()})`);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      check((await where()) === 'play/fly', `Tab switches Study to flight (${await where()})`);

      // Headlamp: the same view inside the Mandelbox must be brighter with the lamp on.
      await page.evaluate(() => {
        window.__pz.play(2);
        window.__pz.fly({ seconds: 2.5 });
      });
      const lampFile = join(outDir, '..', 'lamp-check.png');
      const lampLuma = async (mode) => {
        await page.evaluate((m) => window.__pz.settings({ headlamp: m }), mode);
        await page.waitForTimeout(300);
        await page.waitForFunction(() => window.__pz.converged(), null, { timeout: 120000, polling: 200 });
        await page.screenshot({ path: lampFile });
        return stats(lampFile).meanLuma;
      };
      const lampOff = await lampLuma('off');
      const lampOn = await lampLuma('on');
      rmSync(lampFile, { force: true });
      check(lampOn > lampOff, `headlamp brightens the view (mean luma ${lampOff} off, ${lampOn} on)`);

      // Motes: put the camera on the first one and let a moment of flight pass.
      const motes = await page.evaluate(() => {
        const pz = window.__pz;
        pz.play(0);
        pz.fly({ move: [0, 0, 0], seconds: 0.05 });
        const list = pz.motes();
        const m = list.find((x) => !x.found);
        const before = pz.info().motesFound;
        if (m) {
          pz.look(m.x, m.y, m.z, 0, 0, 0);
          pz.fly({ move: [0, 0, 0], seconds: 0.05 });
        }
        return { count: list.length, shown: pz.info().motesShown, before, after: pz.info().motesFound };
      });
      check(motes.count === 7 && motes.after === motes.before + 1, `a mote is collected by flying into it (${JSON.stringify(motes)})`);
    }

    if (problems.length) {
      console.log('console problems:\n' + problems.join('\n'));
      failed = true;
    } else {
      console.log('no console errors or warnings');
    }

    // Graceful failure: with 3D APIs disabled the page must explain itself instead of staying blank.
    if (!only) {
      await browser.close();
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-3d-apis'] });
      const page2 = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page2.goto(URL);
      await page2.waitForSelector('#fatal:not([hidden])', { timeout: 15000 });
      const text = await page2.evaluate(() => document.getElementById('fatal')?.innerText ?? '');
      const ok = /WebGL2/.test(text);
      console.log(`${ok ? 'ok  ' : 'FAIL'} no-GPU fallback message: "${text.split('\n')[0]}"`);
      if (!ok) failed = true;
    }
  } finally {
    await browser?.close();
    server.kill();
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

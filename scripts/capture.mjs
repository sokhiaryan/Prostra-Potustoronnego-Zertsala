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

// name, preset index, optional extra steps run in the page before capture
const SHOTS = [
  { name: '01-zertsalo-mandelbulb', preset: 0 },
  { name: '02-lotus-mandelbulb', preset: 1 },
  { name: '03-cathedral-mandelbox', preset: 2 },
  { name: '04-reliquary-mandelbox', preset: 3 },
  { name: '05-lattice-kifs', preset: 4 },
  { name: '06-thornfield-kifs', preset: 5 },
  { name: '07-deep-zoom', preset: 0, zoom: 9 },
  { name: '08-precision-limit', preset: 0, zoom: 30 },
  { name: '09-interface', preset: 0, ui: true },
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
      await page.evaluate(
        ({ preset, ui }) => {
          window.__pz.preset(preset);
          window.__pz.hideUi(!ui);
        },
        { preset: shot.preset, ui: !!shot.ui },
      );
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
      await page.waitForTimeout(350); // let the panel fade finish
      const file = join(outDir, `${shot.name}.png`);
      await page.screenshot({ path: file });
      const s = stats(file);
      const info = await page.evaluate(() => window.__pz.info());
      console.log(shot.name, JSON.stringify(s), `viewScale=${info.viewScale.toExponential(2)}`);
      if (s.meanLuma < 12 || s.clippedPct > 8 || s.contrast < 8) {
        console.log(`  !! ${shot.name} looks wrong (too dark, clipped or flat)`);
        failed = true;
      }
    }

    // Interactive performance: orbit for two seconds and read the frame statistics.
    if (!only) {
      await page.evaluate(() => {
        window.__pz.preset(0);
        window.__pz.hideUi(true);
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

      // Interaction smoke test: breathing animates, PNG export produces a real image, H hides the UI.
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

      await page.keyboard.press('KeyH');
      check(await page.evaluate(() => !document.body.classList.contains('ui-hidden')), 'H shows the panel');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Save PNG' }).click(),
      ]);
      const exported = join(outDir, '..', 'export-check.png');
      await download.saveAs(exported);
      const es = stats(exported);
      check(es.size === '1600x900' && es.meanLuma > 12, `PNG export (${es.size}, mean luma ${es.meanLuma})`);
      rmSync(exported, { force: true });
      await page.keyboard.press('KeyH');
      check(await page.evaluate(() => document.body.classList.contains('ui-hidden')), 'H hides the panel');
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

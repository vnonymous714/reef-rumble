/* Local harness: render Daily Temple Wheel preview PNG (no browser). */
import { createCanvas, loadImage } from '/tmp/rr-napi/node_modules/@napi-rs/canvas/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = readFileSync(path.join(root, 'daily-wheel-art.js'), 'utf8');
const sandbox = { globalThis: {}, Math, console };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const art = sandbox.ReefDailyWheelArt;
if (!art) throw new Error('ReefDailyWheelArt missing');

const DAILY = [100, 200, 300, 400, 500, 800, 1000, 1500, 2500, 10000];
const fmt = (c) => (Math.floor(c) / 100).toFixed(2);
const bg = await loadImage(path.join(root, 'assets/bg.webp'));
const gems = {};
for (const name of ['gem_r', 'gem_b', 'gem_g', 'gem_p']) {
  gems[name] = await loadImage(path.join(root, `assets/${name}.webp`));
}
const gemDraw = (g, name, x, y, s) => {
  const img = gems[name];
  if (img) g.drawImage(img, x - s / 2, y - s / 2, s, s);
};

const W = 844, H = 390; // landscape phone-ish
const canvas = createCanvas(W, H);
const g = canvas.getContext('2d');
art.paintDailyModalChrome(g, W, H, {
  bgImage: bg,
  prizes: DAILY,
  fmt,
  gemDraw,
  seed: 11,
  streakLabel: 'DAY 1',
  resultText: '+2.00',
  buttonText: 'BACK TO REEF',
});

const outDir = path.join(root, 'docs');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'daily-temple-wheel-ui5-preview.png');
writeFileSync(out, canvas.toBuffer('image/png'));
console.log(JSON.stringify({ out, bytes: readFileSync(out).length, size: [W, H] }));

import { createCanvas, loadImage } from '/tmp/rr-napi/node_modules/@napi-rs/canvas/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MathBonus = require(path.join(root, 'bonus-choice-math.js'));
function loadArt(file) {
  const code = readFileSync(path.join(root, file), 'utf8');
  const sandbox = { globalThis: {}, Math, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox;
}
const wheelArt = loadArt('daily-wheel-art.js').ReefDailyWheelArt;
const bg = await loadImage(path.join(root, 'assets/bg.webp'));
const W = 985, H = 400;
mkdirSync('/workspace/shots', { recursive: true });
mkdirSync(path.join(root, 'docs'), { recursive: true });

function plate(g) {
  g.drawImage(bg, 0, 0, W, H);
  g.fillStyle = 'rgba(2,12,24,.55)';
  g.fillRect(0, 0, W, H);
  round(g, 40, 20, W - 80, H - 40, 18);
  const panel = g.createLinearGradient(40, 20, W - 40, H - 20);
  panel.addColorStop(0, 'rgba(18,55,72,.94)');
  panel.addColorStop(1, 'rgba(4,16,28,.96)');
  g.fillStyle = panel; g.fill();
  g.strokeStyle = '#c5a45d'; g.lineWidth = 3; g.stroke();
}
function round(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function title(g, text, y=48){g.textAlign='center';g.font='900 18px system-ui';g.fillStyle='#ffdf9d';g.fillText(text,W/2,y);}
function save(canvas, name) {
  const out = `/workspace/shots/${name}`;
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(JSON.stringify({ out, bytes: readFileSync(out).length }));
}

// 1) fixed daily wheel preview + docs copies
{
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');
  const DAILY = [100, 200, 300, 400, 500, 800, 1000, 1500, 2500, 10000];
  wheelArt.paintDailyModalChrome(g, W, H, {
    bgImage: bg, prizes: DAILY, fmt: (c) => (c / 100).toFixed(2), seed: 11,
    streakLabel: 'DAY 1', resultText: '', buttonText: 'SPIN · DAILY GIFT'
  });
  save(canvas, 'bonus1-daily-wheel.png');
  writeFileSync(path.join(root, 'docs/daily-temple-wheel-ui5-preview.png'), canvas.toBuffer('image/png'));
  // closeup
  const c2 = createCanvas(700, 700); const g2 = c2.getContext('2d');
  g2.fillStyle = '#041420'; g2.fillRect(0, 0, 700, 700);
  g2.save(); g2.translate(350, 350);
  wheelArt.paintDailyTempleWheel(g2, { R: 300, prizes: DAILY, fmt: (c) => (c / 100).toFixed(2), seed: 3 });
  g2.restore();
  writeFileSync(path.join(root, 'docs/daily-temple-wheel-ui5-closeup.png'), c2.toBuffer('image/png'));
  writeFileSync('/workspace/shots/bonus1-daily-wheel-closeup.png', c2.toBuffer('image/png'));
}

// 2) choice menu
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'TEMPLE RELIC BONUS');
  g.font = '600 12px system-ui'; g.fillStyle = 'rgba(200,230,240,.85)'; g.fillText('Locked stake 1.00 · pick ONE game · once per 12 hours', W / 2, 72);
  const cards = [
    ['TEMPLE WHEEL', 'Spin a sunken-temple stake wheel'],
    ['TREASURE CHESTS', 'Pick 1 of 3 · 2× / 5× / 10×'],
    ['TAP FRENZY', '20s free taps · rate raises mult']
  ];
  const cw = 260, ch = 150, gap = 24; const total = cards.length * cw + (cards.length - 1) * gap; let x = (W - total) / 2;
  for (const [t, b] of cards) {
    round(g, x, 110, cw, ch, 14);
    const grd = g.createLinearGradient(x, 110, x, 110 + ch);
    grd.addColorStop(0, 'rgba(40,90,110,.95)'); grd.addColorStop(1, 'rgba(12,32,44,.96)');
    g.fillStyle = grd; g.fill(); g.strokeStyle = 'rgba(197,164,93,.8)'; g.stroke();
    g.fillStyle = '#ffe28a'; g.font = '900 15px system-ui'; g.fillText(t, x + cw / 2, 165);
    g.fillStyle = 'rgba(200,230,240,.8)'; g.font = '600 11px system-ui'; g.fillText(b, x + cw / 2, 195);
    x += cw + gap;
  }
  save(canvas, 'bonus-choice-menu.png');
}

// 3) chests
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'TEMPLE TREASURE CHESTS');
  g.fillStyle = 'rgba(200,230,240,.85)'; g.font = '600 12px system-ui'; g.fillText('Stake 1.00 · pick a chest · server shuffled 2×·5×·10×', W / 2, 72);
  const labels = ['?', '?', '?'];
  for (let i = 0; i < 3; i++) {
    const x = W / 2 + (i - 1) * 150 - 55, y = 120;
    round(g, x, y, 110, 130, 14);
    g.fillStyle = '#3a2410'; g.fill(); g.strokeStyle = '#c5a45d'; g.stroke();
    round(g, x + 14, y + 12, 82, 70, 8); g.fillStyle = '#e3b23c'; g.fill();
    g.fillStyle = '#3a2000'; g.font = '900 22px system-ui'; g.fillText('▾', x + 55, y + 58);
    g.fillStyle = '#fff6d0'; g.font = '900 20px system-ui'; g.fillText(labels[i], x + 55, y + 115);
  }
  save(canvas, 'bonus2-treasure-chests.png');
}

// 4) tap frenzy
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'REEF TAP FRENZY');
  g.fillStyle = '#cde5e7'; g.font = '800 12px system-ui';
  g.fillText('TIME 14.2    TAPS 96    MULT 3.10×    LIVE 3.10', W / 2, 78);
  round(g, 180, 100, W - 360, 160, 16);
  const arena = g.createRadialGradient(W / 2, 180, 10, W / 2, 180, 220);
  arena.addColorStop(0, 'rgba(40,120,140,.5)'); arena.addColorStop(1, 'rgba(4,16,28,.95)');
  g.fillStyle = arena; g.fill(); g.strokeStyle = 'rgba(197,164,93,.6)'; g.stroke();
  g.fillStyle = '#ffe28a'; g.font = '900 28px system-ui'; g.fillText('TAP!', W / 2, 190);
  g.fillStyle = '#fff6d0'; g.font = '900 22px system-ui'; g.fillText('+3.10 live', W / 2, 300);
  save(canvas, 'bonus3-tap-frenzy.png');
}

// 5) choice wheel screen
{
  const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g); title(g, 'TEMPLE STAKE WHEEL');
  g.fillStyle = 'rgba(200,230,240,.85)'; g.font = '600 12px system-ui'; g.fillText('Stake 1.00 · weighted multipliers', W / 2, 70);
  g.save(); g.translate(W / 2, 220);
  const prizes = MathBonus.CHOICE_WHEEL.map(([m]) => Math.round(100 * m));
  wheelArt.paintDailyTempleWheel(g, { R: 130, prizes, fmt: (c) => (c / 100).toFixed(1) + '×', seed: 5 });
  g.restore();
  save(canvas, 'bonus-choice-wheel.png');
}

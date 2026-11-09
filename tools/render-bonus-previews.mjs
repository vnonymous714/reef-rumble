import { createCanvas, loadImage } from '/tmp/rr-napi/node_modules/@napi-rs/canvas/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const MathBonus = require(path.join(root, 'bonus-choice-math.js'));

function loadArt(file, extras = {}) {
  const code = readFileSync(path.join(root, file), 'utf8');
  const sandbox = { globalThis: {}, Math, console, Image: class Image {}, ...extras };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

const wheelArt = loadArt('daily-wheel-art.js').ReefDailyWheelArt;
const choiceArt = loadArt('bonus-choice-art.js', { ReefDailyWheelArt: wheelArt }).ReefBonusChoiceArt;

const bgReef = await loadImage(path.join(root, 'assets/bg.webp'));
const bonusBg = await loadImage(path.join(root, 'assets/bonus-bg.webp'));
choiceArt.setImages({
  bg: bonusBg,
  chestClosed: await loadImage(path.join(root, 'assets/bonus-chest-closed.webp')),
  chestOpen: await loadImage(path.join(root, 'assets/bonus-chest-open.webp')),
  pearl: await loadImage(path.join(root, 'assets/bonus-tap-pearl.webp')),
  chestClosedSm: await loadImage(path.join(root, 'assets/bonus-chest-closed-sm.webp')),
  chestOpenSm: await loadImage(path.join(root, 'assets/bonus-chest-open-sm.webp')),
  pearlSm: await loadImage(path.join(root, 'assets/bonus-tap-pearl-sm.webp'))
});

const SIZES = [
  [985, 400, ''],
  [844, 390, '@844'],
  [740, 360, '@740']
];
mkdirSync('/workspace/shots', { recursive: true });
mkdirSync(path.join(root, 'docs'), { recursive: true });

function round(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function plate(g, W, H) {
  const s = Math.max(W / bonusBg.width, H / bonusBg.height);
  const dw = bonusBg.width * s, dh = bonusBg.height * s;
  g.drawImage(bonusBg, (W - dw) / 2, (H - dh) / 2, dw, dh);
  g.fillStyle = 'rgba(2,12,24,.42)';
  g.fillRect(0, 0, W, H);
  round(g, 20, 10, W - 40, H - 20, 16);
  g.fillStyle = 'rgba(6,20,32,.50)';
  g.fill();
  g.strokeStyle = '#c5a45d'; g.lineWidth = 3; g.stroke();
}
function title(g, W, text, y=36){g.textAlign='center';g.font='900 16px system-ui';g.fillStyle='#ffdf9d';g.shadowColor='rgba(0,0,0,.5)';g.shadowBlur=6;g.fillText(text,W/2,y);g.shadowBlur=0;}
function save(canvas, name) {
  const out = `/workspace/shots/${name}`;
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(JSON.stringify({ out, bytes: readFileSync(out).length, w: canvas.width, h: canvas.height }));
}

const DAILY = [100, 200, 300, 400, 500, 800, 1000, 1500, 2500, 10000];

for (const [W, H, tag] of SIZES) {
  // daily wheel
  {
    const canvas = createCanvas(W, H);
    const g = canvas.getContext('2d');
    wheelArt.paintDailyModalChrome(g, W, H, {
      bgImage: bgReef, prizes: DAILY, fmt: (c) => (c / 100).toFixed(2), seed: 11,
      streakLabel: 'DAY 1', resultText: '', buttonText: 'SPIN · DAILY GIFT'
    });
    const name = tag ? `bonus1-daily-wheel${tag}.png` : 'bonus1-daily-wheel.png';
    save(canvas, name);
    if (!tag) writeFileSync(path.join(root, 'docs/daily-temple-wheel-ui5-preview.png'), canvas.toBuffer('image/png'));
  }

  // choice menu (primary size only for menu — already approved; still render primary)
  if (!tag) {
    const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g, W, H); title(g, W, 'TEMPLE RELIC BONUS');
    g.font = '600 11px system-ui'; g.fillStyle = 'rgba(200,230,240,.9)';
    g.fillText('Locked stake 1.00 · pick ONE game · once per 12 hours', W / 2, 56);
    const cards = [
      ['wheel', 'TEMPLE WHEEL', 'Spin a sunken-temple stake wheel'],
      ['chest', 'TREASURE CHESTS', 'Pick 1 of 3 · 2x / 5x / 10x'],
      ['tap', 'TAP FRENZY', '20s free taps · rate raises mult']
    ];
    const cw = Math.min(280, (W - 80) / 3 - 10), ch = H - 110, gap = 12;
    const total = cards.length * cw + (cards.length - 1) * gap;
    let x = (W - total) / 2;
    const y = 68;
    for (const [kind, tt, b] of cards) {
      g.save(); g.translate(x, y);
      choiceArt.paintChoiceCard(g, cw, ch, kind, tt, b, false);
      g.restore();
      x += cw + gap;
    }
    save(canvas, 'bonus-choice-menu.png');
  }

  // chests CLOSED (before pick)
  {
    const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g, W, H); title(g, W, 'TEMPLE TREASURE CHESTS');
    g.fillStyle = 'rgba(200,230,240,.9)'; g.font = '600 11px system-ui';
    g.fillText('Stake 1.00 · pick a chest · server shuffled 2x · 5x · 10x', W / 2, 54);
    const px = 28, py = 64, pw = W - 56, ph = H - 100;
    g.save();
    g.beginPath(); round(g, px, py, pw, ph, 12); g.clip();
    g.translate(px, py);
    choiceArt.paintChestPanel(g, pw, ph, [
      { open: false, mult: null },
      { open: false, mult: null },
      { open: false, mult: null }
    ]);
    g.restore();
    g.strokeStyle = 'rgba(197,164,93,.75)'; g.lineWidth = 2;
    round(g, px, py, pw, ph, 12); g.stroke();
    const name = tag ? `bonus2-treasure-chests-closed${tag}.png` : 'bonus2-treasure-chests-closed.png';
    save(canvas, name);
  }

  // chests OPEN (picked middle = 5x, others dimmed)
  {
    const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g, W, H); title(g, W, 'TEMPLE TREASURE CHESTS');
    g.fillStyle = 'rgba(200,230,240,.9)'; g.font = '600 11px system-ui';
    g.fillText('Stake 1.00 · pick a chest · server shuffled 2x · 5x · 10x', W / 2, 54);
    const px = 28, py = 64, pw = W - 56, ph = H - 100;
    g.save();
    g.beginPath(); round(g, px, py, pw, ph, 12); g.clip();
    g.translate(px, py);
    choiceArt.paintChestPanel(g, pw, ph, [
      { open: true, mult: 2, dim: true },
      { open: true, mult: 5, dim: false },
      { open: true, mult: 10, dim: true }
    ]);
    g.restore();
    g.strokeStyle = 'rgba(197,164,93,.75)'; g.lineWidth = 2;
    round(g, px, py, pw, ph, 12); g.stroke();
    g.fillStyle = '#fff6d0'; g.font = '900 18px system-ui';
    g.fillText('+5.00 · 5\u00d7', W / 2, H - 22);
    const name = tag ? `bonus2-treasure-chests${tag}.png` : 'bonus2-treasure-chests.png';
    save(canvas, name);
  }

  // tap frenzy
  {
    const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g, W, H); title(g, W, 'REEF TAP FRENZY');
    g.fillStyle = '#cde5e7'; g.font = '800 11px system-ui';
    g.fillText('TIME 14.2    TAPS 96    MULT 3.10\u00d7    LIVE 3.10', W / 2, 54);
    const px = 28, py = 64, pw = W - 56, ph = H - 100;
    g.save();
    g.beginPath(); round(g, px, py, pw, ph, 12); g.clip();
    g.translate(px, py);
    choiceArt.paintTapScene(g, pw, ph, {
      timeFrac: 14.2 / 20,
      timeLeft: '14.2',
      heat: 0.55,
      multLabel: '3.10\u00d7',
      pulse: 0.4,
      bursts: [
        { x: pw * 0.58, y: ph * 0.48, t: 1 },
        { x: pw * 0.68, y: ph * 0.40, t: 2 },
        { x: pw * 0.62, y: ph * 0.58, t: 3 }
      ]
    });
    g.restore();
    g.strokeStyle = 'rgba(197,164,93,.75)'; g.lineWidth = 2;
    round(g, px, py, pw, ph, 12); g.stroke();
    g.fillStyle = '#fff6d0'; g.font = '900 18px system-ui';
    g.fillText('+3.10 live', W / 2, H - 22);
    const name = tag ? `bonus3-tap-frenzy${tag}.png` : 'bonus3-tap-frenzy.png';
    save(canvas, name);
  }

  // choice wheel (primary only)
  if (!tag) {
    const canvas = createCanvas(W, H); const g = canvas.getContext('2d'); plate(g, W, H); title(g, W, 'TEMPLE STAKE WHEEL');
    g.fillStyle = 'rgba(200,230,240,.9)'; g.font = '600 11px system-ui';
    g.fillText('Stake 1.00 · weighted multipliers', W / 2, 54);
    g.save(); g.translate(W / 2, H * 0.48);
    const prizes = MathBonus.CHOICE_WHEEL.map(([m]) => Math.round(100 * m));
    const R = Math.min(H * 0.32, 110);
    wheelArt.paintDailyTempleWheel(g, { R, prizes, fmt: (c) => (c / 100).toFixed(1) + '\u00d7', seed: 5 });
    g.restore();
    const bw = 150, bh = 28, bx = W/2 - bw/2, by = H - 48;
    round(g, bx, by, bw, bh, 14);
    const btn = g.createLinearGradient(bx, by, bx, by + bh);
    btn.addColorStop(0, '#fff0b0'); btn.addColorStop(0.55, '#f0b532'); btn.addColorStop(1, '#b9770e');
    g.fillStyle = btn; g.fill(); g.strokeStyle = '#7a4a0c'; g.stroke();
    g.font = '900 12px system-ui'; g.fillStyle = '#3a2000'; g.textAlign='center';
    g.fillText('SPIN', W / 2, by + 19);
    save(canvas, 'bonus-choice-wheel.png');
  }
}

// closeup still useful
{
  const c2 = createCanvas(700, 700); const g2 = c2.getContext('2d');
  g2.fillStyle = '#041420'; g2.fillRect(0, 0, 700, 700);
  g2.save(); g2.translate(350, 350);
  wheelArt.paintDailyTempleWheel(g2, { R: 300, prizes: DAILY, fmt: (c) => (c / 100).toFixed(2), seed: 3 });
  g2.restore();
  writeFileSync(path.join(root, 'docs/daily-temple-wheel-ui5-closeup.png'), c2.toBuffer('image/png'));
  writeFileSync('/workspace/shots/bonus1-daily-wheel-closeup.png', c2.toBuffer('image/png'));
  console.log(JSON.stringify({ out: '/workspace/shots/bonus1-daily-wheel-closeup.png' }));
}

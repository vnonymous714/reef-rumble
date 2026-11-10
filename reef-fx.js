/* Presentation only: independent deterministic effects; never consumes game RNG. */
(function (root) {
  'use strict';
  const LIMITS = Object.freeze({ blasts: 6, particles: 96, duration: 6, active: 6, cooldown: 12, catches: 8, catchLife: 0.85, drills: 3, drillLife: 0.7 });
  function create() {
    let blasts = [], particles = [], catches = [], drills = [], mode = '', remaining = 0, cooldown = 0;
    function activate(name) {
      if (!['arc', 'plasma'].includes(name) || remaining > 0 || cooldown > 0) return false;
      mode = name; remaining = LIMITS.active; cooldown = LIMITS.active + LIMITS.cooldown; return true;
    }
    function bomb(x, y, scale, reduced) {
      if (![x, y, scale].every(Number.isFinite) || scale <= 0) return;
      blasts.push({ x, y, scale, t: 0 }); blasts = blasts.slice(-LIMITS.blasts);
      if (reduced) return;
      for (let i = 0; i < 20; i++) {
        const a = i * 2.399963, speed = (18 + i % 7 * 9) * scale;
        particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * .55 - 12 * scale, t: 0, life: 1.4 + i % 5 * .2, r: (1 + i % 3) * scale, sand: i % 3 !== 0 });
      }
      particles = particles.slice(-LIMITS.particles);
    }

    function catchPop(x, y, scale, tier, reduced) {
      if (![x, y, scale].every(Number.isFinite) || scale <= 0) return;
      const kind = ['small', 'mid', 'big', 'boss'].includes(tier) ? tier : 'small';
      catches.push({ x, y, scale, tier: kind, t: 0 });
      catches = catches.slice(-LIMITS.catches);
    }
    function drill(x0, y0, x1, y1, scale, reduced) {
      if (![x0, y0, x1, y1, scale].every(Number.isFinite) || scale <= 0) return;
      drills.push({ x0, y0, x1, y1, scale, t: 0, reduced: !!reduced });
      drills = drills.slice(-LIMITS.drills);
    }
    function update(dt) {
      if (!Number.isFinite(dt) || dt < 0) return;
      remaining = Math.max(0, remaining - dt); cooldown = Math.max(0, cooldown - dt);
      if (!remaining) mode = '';
      for (const b of blasts) b.t += dt;
      blasts = blasts.filter(b => b.t < LIMITS.duration);
      for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += dt * 12; }
      particles = particles.filter(p => p.t < p.life);
      for (const c of catches) c.t += dt;
      catches = catches.filter(c => c.t < LIMITS.catchLife);
      for (const d of drills) d.t += dt;
      drills = drills.filter(d => d.t < LIMITS.drillLife);
    }
    function terrain(g, reduced) {
      g.save();
      for (const b of blasts) {
        const fade = Math.min(1, (LIMITS.duration - b.t) / 2), r = 36 * b.scale;
        g.save(); g.translate(b.x, b.y); g.scale(1, .55);
        const scar = g.createRadialGradient(0, 0, r * .15, 0, 0, r);
        scar.addColorStop(0, 'rgba(12,20,24,' + .45 * fade + ')'); scar.addColorStop(.65, 'rgba(42,40,30,' + .24 * fade + ')'); scar.addColorStop(1, 'rgba(42,40,30,0)');
        g.fillStyle = scar; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
        if (!reduced && b.t < 1.8) {
          const u = b.t / 1.8, pr = (12 + u * 65) * b.scale;
          const plume = g.createRadialGradient(b.x, b.y - u * 18 * b.scale, 0, b.x, b.y, pr);
          plume.addColorStop(0, 'rgba(182,159,111,' + .22 * (1-u) + ')'); plume.addColorStop(1, 'rgba(150,140,110,0)');
          g.fillStyle = plume; g.beginPath(); g.ellipse(b.x, b.y - u * 18 * b.scale, pr, pr * .55, 0, 0, Math.PI * 2); g.fill();
          if (b.t < .7) { g.strokeStyle = 'rgba(170,232,236,' + .45 * (1-b.t/.7) + ')'; g.lineWidth = 1.5 * b.scale; g.beginPath(); g.ellipse(b.x,b.y,(10+b.t*150)*b.scale,(6+b.t*80)*b.scale,0,0,Math.PI*2); g.stroke(); }
        }
      }
      if (!reduced) for (const p of particles) { g.globalAlpha = Math.max(0, (1-p.t/p.life)*.65); g.fillStyle = p.sand ? '#bcaa7f' : '#58757a'; g.save(); g.translate(p.x,p.y); g.rotate(p.t*2); g.fillRect(-p.r,-p.r,p.r*2,p.r); g.restore(); }
      g.restore();
    }

    function catchDraw(g, sprites, reduced) {
      if (!catches.length) return;
      g.save();
      for (const c of catches) {
        const u = c.t / LIMITS.catchLife, fade = 1 - u, grow = 0.55 + u * 0.75;
        const spr = sprites && (sprites[c.tier] || sprites[c.tier + 'Sm']);
        const size = (c.tier === 'boss' ? 210 : c.tier === 'big' ? 170 : c.tier === 'mid' ? 130 : 90) * c.scale * grow;
        g.globalAlpha = Math.max(0, fade);
        if (spr && spr.ok && spr.img) {
          g.drawImage(spr.img, c.x - size / 2, c.y - size / 2, size, size);
        } else {
          const grd = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, size / 2);
          const col = c.tier === 'small' ? '170,230,255' : c.tier === 'mid' ? '120,220,190' : '255,214,74';
          grd.addColorStop(0, 'rgba(' + col + ',' + (0.55 * fade) + ')');
          grd.addColorStop(1, 'rgba(' + col + ',0)');
          g.fillStyle = grd; g.beginPath(); g.arc(c.x, c.y, size / 2, 0, Math.PI * 2); g.fill();
        }
      }
      g.restore();
    }
    function drillDraw(g, reduced) {
      if (!drills.length) return;
      g.save();
      for (const d of drills) {
        const u = d.t / LIMITS.drillLife, fade = 1 - u;
        const x = d.x0 + (d.x1 - d.x0) * Math.min(1, u * 1.35);
        const y = d.y0 + (d.y1 - d.y0) * Math.min(1, u * 1.35);
        g.strokeStyle = 'rgba(255,186,70,' + (0.85 * fade) + ')';
        g.lineWidth = Math.max(2, 5 * d.scale * (1 - u * 0.4));
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(d.x0, d.y0); g.lineTo(x, y); g.stroke();
        if (!reduced && !d.reduced) {
          const bloom = g.createRadialGradient(x, y, 0, x, y, 22 * d.scale);
          bloom.addColorStop(0, 'rgba(255,220,120,' + (0.7 * fade) + ')');
          bloom.addColorStop(1, 'rgba(255,140,40,0)');
          g.fillStyle = bloom; g.beginPath(); g.arc(x, y, 22 * d.scale, 0, Math.PI * 2); g.fill();
        }
        if (u > 0.62) {
          const ev = (u - 0.62) / 0.38, er = (18 + ev * 70) * d.scale;
          g.strokeStyle = 'rgba(255,170,60,' + (0.7 * (1 - ev)) + ')';
          g.lineWidth = 3 * d.scale;
          g.beginPath(); g.arc(d.x1, d.y1, er, 0, Math.PI * 2); g.stroke();
        }
      }
      g.restore();
    }
    return { activate, bomb, catchPop, drill, update, terrain, catchDraw, drillDraw, snapshot: () => ({ mode, remaining, cooldown, blasts: blasts.length, particles: particles.length, catches: catches.length, drills: drills.length }), get mode() { return mode; } };
  }
  const api = { create, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReefFX = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

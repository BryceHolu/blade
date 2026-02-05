// ========================= game.js =========================
// Performance-friendly visuals: no blur glow pass, capped particles, cheaper background.
// Keeps gameplay (bot, wave, boss, PvP score drop, plasma, regen).

(() => {
  "use strict";

  // ---------------------------
  // World + camera
  // ---------------------------
  const WORLD_W = 4200;
  const WORLD_H = 2600;

  // ---------------------------
  // Progression & stats
  // ---------------------------
  const EDGE_CAP = 32;
  const PLAYER_EDGE_CAP = 26;
  const PARTS_PER_EDGE = 3;

  const PARTS_PER_PLASMA = 3;
  const PLASMA_MAX = 10;
  const PLASMA_ATK_PER_LEVEL = 2;
  const PLASMA_PRIME_TIME_MS = 1200;
  const PLASMA_FIRST_HIT_MULT = 3;

  // Wave
  const WAVE_MAX = 8;
  const WAVE_PARTS_PER_LEVEL = 2;
  const WAVE_COOLDOWN_MS = 950;
  const WAVE_RANGE = 520;
  const WAVE_WIDTH = 44;
  const WAVE_SPEED = 980;
  const WAVE_DAMAGE_MULT = 2.0;

  // Part spawn chances
  const REGEN_PART_SPAWN_CHANCE = 0.22;
  const WAVE_PART_SPAWN_CHANCE = 0.05;
  const REGEN_BOOST_PER_PICKUP = 0.15;

  // Score rules
  const SCORE_PER_EDGE_PART = 5;
  const SCORE_PER_REGEN_PART = 6;
  const SCORE_PER_WAVE_PART = 10;
  const SCORE_PER_ENEMY_KO = 50;
  const SCORE_PER_BOSS_KO = 250;
  const SCORE_DROP_FRACTION_PVP = 0.35;
  const SCORE_ORB_LIFETIME_MS = 12000;

  // Stat scaling per edge beyond 4
  const ATK_PER_EDGE = 1.2;
  const DEF_PER_EDGE = 1.1;
  const MAXHP_PER_EDGE = 2.2;

  // Combat
  const HIT_RANGE = 38;
  const HIT_COOLDOWN_MS = 320;

  // Movement
  const BASE_SPEED = 230;
  const DASH_SPEED = 560;
  const DASH_TIME_MS = 125;
  const DASH_COOLDOWN_MS = 850;

  // Visual sizes
  const PLAYER_RADIUS = 18;
  const ENEMY_RADIUS = 16;
  const PART_RADIUS = 8;

  // Spawning
  const ENEMY_COUNT = 9;
  const PART_SPAWN_INTERVAL_MS = 800;
  const PART_MAX_ON_FIELD = 28;

  // Boss
  const BOSS_MIN_SPAWN_MS = 24000;
  const BOSS_MAX_SPAWN_MS = 45000;
  const BOSS_HP_MULT = 3.7;
  const BOSS_ATK_BONUS = 3;
  const BOSS_DEF_BONUS = 2;
  const BOSS_RADIUS = 34;

  // Obstacles
  const OBSTACLE_COUNT = 28;

  // Bot unstuck
  const BOT_STUCK_DIST_EPS = 2.0;
  const BOT_STUCK_FRAMES = 10;
  const BOT_ESCAPE_MS = 550;

  // FX performance knobs
  const MAX_PARTICLES = 220;         // hard cap
  const MAX_FLOAT_TEXT = 40;         // hard cap
  const GRID_STEP = 84;              // bigger = fewer lines
  const GRID_ALPHA = 0.18;           // lower opacity
  const SHADOW_BLUR_LIGHT = 8;       // cheap glow
  const SHADOW_BLUR_HEAVY = 12;

  // ---------------------------
  // DOM
  // ---------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const getEl = (id) => document.getElementById(id) || null;
  const elEdges = getEl("edges");
  const elAtk = getEl("atk");
  const elDef = getEl("def");
  const elPlasma = getEl("plasma"); // optional
  const elWave = getEl("wave");     // optional
  const elHp = getEl("hp");
  const elKos = getEl("kos");
  const elParts = getEl("parts");

  const overlay = getEl("overlay");
  const overlayTitle = getEl("overlayTitle");
  const overlayText = getEl("overlayText");
  const btnPause = getEl("btnPause");
  const btnReset = getEl("btnReset");
  const btnResume = getEl("btnResume");
  const btnHardReset = getEl("btnHardReset");

  const wrap = canvas.parentElement;

  // ---------------------------
  // Helpers
  // ---------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  };

  const C = {
    bgA: "rgba(126,231,255,0.06)",
    bgB: "rgba(166,255,126,0.045)",
    bgC: "rgba(178,107,255,0.045)",
    grid: "rgba(255,255,255,0.07)",

    playerFill: "rgba(126,231,255,0.30)",
    playerStroke: "rgba(126,231,255,0.95)",
    botFill: "rgba(255,255,255,0.12)",
    botStroke: "rgba(255,255,255,0.72)",

    enemyStroke: "rgba(255,126,166,0.92)",
    enemyFill: "rgba(255,126,166,0.20)",
    bruteStroke: "rgba(255,190,126,0.92)",
    bruteFill: "rgba(255,190,126,0.18)",
    skitterStroke: "rgba(255,126,220,0.92)",
    skitterFill: "rgba(255,126,220,0.16)",

    bossStroke: "rgba(255,80,80,0.95)",
    bossFill: "rgba(255,80,80,0.16)",

    edgePart: "rgba(166,255,126,0.92)",
    regenPart: "rgba(126,231,255,0.92)",
    wavePart: "rgba(178,107,255,0.92)",
    scoreOrb: "rgba(255,215,110,0.92)",
  };

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPolygon(g, x, y, radius, sides, rotation, fill, stroke) {
    const s = Math.max(3, Math.floor(sides));
    g.beginPath();
    for (let i = 0; i < s; i++) {
      const a = rotation + (i * Math.PI * 2) / s;
      const px = x + Math.cos(a) * radius;
      const py = y + Math.sin(a) * radius;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = stroke;
    g.stroke();
  }

  function drawHealthBar(g, x, y, w, h, hp, maxHp) {
    g.save();
    g.globalAlpha = 0.95;
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(x, y, w, h);
    const t = maxHp > 0 ? hp / maxHp : 0;
    g.fillStyle = "rgba(166,255,126,0.85)";
    g.fillRect(x, y, w * clamp(t, 0, 1), h);
    g.restore();
  }

  // ---------------------------
  // FX (capped + simple)
  // ---------------------------
  const FX = {
    particles: [],
    floatText: [],
    shakeT: 0,
    shakeMag: 0,
    flashT: 0,
  };

  function addShake(mag, ms = 120) {
    FX.shakeMag = Math.max(FX.shakeMag, mag);
    FX.shakeT = Math.max(FX.shakeT, ms);
  }
  function addFlash(ms = 70) { FX.flashT = Math.max(FX.flashT, ms); }

  function pushParticle(p) {
    // cap: drop oldest
    if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
    FX.particles.push(p);
  }

  function spawnParticles(x, y, color, count, speedMin, speedMax, lifeMin, lifeMax, sizeMin = 1.5, sizeMax = 3.5) {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(speedMin, speedMax);
      pushParticle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(lifeMin, lifeMax),
        born: now,
        size: rand(sizeMin, sizeMax),
        color,
      });
    }
  }

  function spawnFloatText(x, y, text, color = "rgba(255,255,255,0.92)", ms = 800) {
    if (FX.floatText.length >= MAX_FLOAT_TEXT) FX.floatText.shift();
    FX.floatText.push({ x, y, vy: -26, text, color, born: performance.now(), life: ms });
  }

  // ---------------------------
  // Canvas sizing (DPR clamp)
  // ---------------------------
  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    // DPR clamp helps a lot on high-DPI displays
    const dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
    const cssW = Math.max(600, Math.floor(rect.width));
    const cssH = Math.max(520, Math.floor(rect.height));

    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function viewSize() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  window.addEventListener("resize", () => resizeCanvas());

  // ---------------------------
  // State
  // ---------------------------
  const keys = new Set();
  let paused = false;
  let lastT = performance.now();
  let loopRunning = false;

  const state = {
    partsOnField: [],
    enemies: [],
    obstacles: [],
    projectiles: [],

    player: null,
    botPlayer: null,

    kos: 0,
    nextPartAt: 0,

    camX: 0,
    camY: 0,

    boss: null,
    nextBossAt: 0,

    message: null,
    messageUntil: 0,
  };

  // ---------------------------
  // Stats
  // ---------------------------
  function computeStats(edges) {
    const extra = Math.max(0, edges - 4);
    const atk = Math.round(10 + extra * ATK_PER_EDGE);
    const def = Math.round(10 + extra * DEF_PER_EDGE);
    const maxHp = Math.round(100 + extra * MAXHP_PER_EDGE);
    return { atk, def, maxHp };
  }

  function recomputeFighterStats(p) {
    const base = computeStats(p.edges);
    p.atk = base.atk + p.plasma * PLASMA_ATK_PER_LEVEL;
    p.def = base.def;
    p.maxHp = base.maxHp;
    p.hp = clamp(p.hp, 0, p.maxHp);
  }

  function addPlasma(p, amount) {
    const prev = p.plasma;
    p.plasma = clamp(p.plasma + amount, 0, PLASMA_MAX);
    if (p.plasma !== prev) {
      recomputeFighterStats(p);
      p.hp = clamp(p.hp + Math.round(p.maxHp * 0.06), 0, p.maxHp);
      spawnParticles(p.x, p.y, "rgba(126,231,255,0.85)", 8, 70, 180, 220, 420, 2, 3.5);
    }
  }

  function addWave(p, amount) {
    const prev = p.wave;
    p.wave = clamp(p.wave + amount, 0, WAVE_MAX);
    if (p.wave !== prev) {
      spawnParticles(p.x, p.y, "rgba(178,107,255,0.90)", 7, 60, 160, 220, 420, 2, 3.5);
    }
  }

  // ---------------------------
  // Entities
  // ---------------------------
  function makeFighter(x, y, tint) {
    const edges = 4;
    const base = computeStats(edges);
    return {
      x, y, vx: 0, vy: 0,
      r: PLAYER_RADIUS,
      tint,

      edges,
      parts: 0,

      plasma: 0,
      plasmaParts: 0,

      wave: 0,
      waveParts: 0,

      regenParts: 0,
      regenRate: 0.8,

      atk: base.atk,
      def: base.def,
      maxHp: base.maxHp,
      hp: base.maxHp,

      rot: 0,
      hitReadyAt: 0,

      dashReadyAt: 0,
      dashingUntil: 0,

      plasmaPrimed: true,
      lastLandedHitAt: -1e9,

      aimX: 1,
      aimY: 0,

      waveReadyAt: 0,

      score: 0,

      stuckFrames: 0,
      escapeUntil: 0,
      escapeX: 0,
      escapeY: 0,
      invulnUntil: 0,

      // plasma proc flash
      plasmaFlashUntil: 0,

    };
  }

  function makePlayer() { return makeFighter(WORLD_W * 0.5, WORLD_H * 0.55, "player"); }
  function makeBotPlayer() { return makeFighter(WORLD_W * 0.5 + 120, WORLD_H * 0.55 + 90, "bot"); }

  function makeObstacle() {
    const w = rand(70, 190);
    const h = rand(50, 160);
    return { x: rand(100, WORLD_W - 100 - w), y: rand(100, WORLD_H - 100 - h), w, h };
  }
  function obstacleOverlaps(a, b) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }
  function buildObstacles() {
    const obs = [];
    let attempts = 0;
    while (obs.length < OBSTACLE_COUNT && attempts < 4000) {
      attempts++;
      const o = makeObstacle();
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      const safe = dist2(cx, cy, WORLD_W * 0.5, WORLD_H * 0.55) > 260 * 260;
      if (!safe) continue;
      let ok = true;
      for (const k of obs) if (obstacleOverlaps(o, k)) { ok = false; break; }
      if (ok) obs.push(o);
    }
    state.obstacles = obs;
  }

  function makeEnemy(i, typeOverride = null) {
    const roll = Math.random();
    const type = typeOverride || (roll < 0.55 ? "chaser" : (roll < 0.80 ? "skitter" : "brute"));

    let edges = 4;
    if (type === "brute") edges = 6;
    const base = computeStats(edges);
    const r = type === "brute" ? ENEMY_RADIUS + 6 : (type === "skitter" ? ENEMY_RADIUS - 2 : ENEMY_RADIUS);

    return {
      id: i, type,
      x: rand(120, WORLD_W - 120),
      y: rand(120, WORLD_H - 120),
      vx: 0, vy: 0,
      r, edges,
      atk: type === "brute" ? base.atk + 2 : (type === "skitter" ? Math.max(6, base.atk - 1) : base.atk),
      def: type === "skitter" ? Math.max(6, base.def - 1) : base.def,
      maxHp: type === "brute" ? Math.round(base.maxHp * 1.25) : (type === "skitter" ? Math.round(base.maxHp * 0.85) : base.maxHp),
      hp: base.maxHp,
      rot: rand(0, Math.PI * 2),
      hitReadyAt: 0,
      targetX: rand(0, WORLD_W),
      targetY: rand(0, WORLD_H),
      retargetAt: 0,
    };
  }

  function makeBoss() {
    const edges = 10;
    const base = computeStats(edges);
    const maxHp = Math.round(base.maxHp * BOSS_HP_MULT);
    return {
      id: "boss", type: "boss",
      x: rand(200, WORLD_W - 200),
      y: rand(200, WORLD_H - 200),
      vx: 0, vy: 0,
      r: BOSS_RADIUS,
      edges,
      atk: base.atk + BOSS_ATK_BONUS,
      def: base.def + BOSS_DEF_BONUS,
      maxHp, hp: maxHp,
      rot: rand(0, Math.PI * 2),
      hitReadyAt: 0,
    };
  }

  // ---------------------------
  // Overlay
  // ---------------------------
  function showOverlay(title, text) {
    if (!overlay) return;
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayText) overlayText.textContent = text;
    overlay.hidden = false;
  }
  function hideOverlay() { if (overlay) overlay.hidden = true; }

  // ---------------------------
  // Input
  // ---------------------------
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup","arrowdown","arrowleft","arrowright"," ","p","e"].includes(k)) e.preventDefault();
    if (k === "p") { setPaused(!paused); return; }
    keys.add(k);
    if (k === "e") tryWave(state.player, performance.now());
  }, { passive:false });

  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  if (btnPause) btnPause.addEventListener("click", () => setPaused(!paused));
  if (btnReset) btnReset.addEventListener("click", () => resetGame());
  if (btnResume) btnResume.addEventListener("click", () => setPaused(false));
  if (btnHardReset) btnHardReset.addEventListener("click", () => resetGame());

  function setPaused(value) {
    paused = !!value;
    if (paused) {
      showOverlay("Paused", "Press P or click Resume.");
      if (btnPause) btnPause.textContent = "Resume";
      loopRunning = false;
    } else {
      hideOverlay();
      if (btnPause) btnPause.textContent = "Pause";
      lastT = performance.now();
      if (!loopRunning) {
        loopRunning = true;
        requestAnimationFrame(tick);
      }
    }
  }

  // ---------------------------
  // Collision
  // ---------------------------
  function resolveCircleRect(ent, rect) {
    const closestX = clamp(ent.x, rect.x, rect.x + rect.w);
    const closestY = clamp(ent.y, rect.y, rect.y + rect.h);
    const dx = ent.x - closestX;
    const dy = ent.y - closestY;
    const d2 = dx * dx + dy * dy;
    const r = ent.r + 2;
    if (d2 >= r * r) return;
    const d = Math.sqrt(Math.max(1e-6, d2));
    const push = (r - d);
    ent.x += (dx / d) * push;
    ent.y += (dy / d) * push;
  }
  function resolveWorldBounds(ent) {
    ent.x = clamp(ent.x, ent.r + 6, WORLD_W - ent.r - 6);
    ent.y = clamp(ent.y, ent.r + 6, WORLD_H - ent.r - 6);
  }
  function moveEntity(ent, dt, speed) {
    ent.x += ent.vx * speed * dt;
    ent.y += ent.vy * speed * dt;
    resolveWorldBounds(ent);
    for (const o of state.obstacles) resolveCircleRect(ent, o);
  }

  // ---------------------------
  // Regen
  // ---------------------------
  function regenTick(p, dt) {
    const edgeBonus = Math.max(0, p.edges - 4) * 0.02;
    const rate = p.regenRate + p.regenParts * REGEN_BOOST_PER_PICKUP;
    p.hp = clamp(p.hp + rate * (1 + edgeBonus) * dt, 0, p.maxHp);
  }

  // ---------------------------
  // Parts
  // ---------------------------
  function choosePartKind() {
    const r = Math.random();
    if (r < WAVE_PART_SPAWN_CHANCE) return "wave";
    if (r < WAVE_PART_SPAWN_CHANCE + REGEN_PART_SPAWN_CHANCE) return "regen";
    return "edge";
  }

  function spawnPart() {
    const p = state.player;
    const a = rand(0, Math.PI * 2);
    const rad = rand(220, 720);
    const x = clamp(p.x + Math.cos(a) * rad, 40, WORLD_W - 40);
    const y = clamp(p.y + Math.sin(a) * rad, 40, WORLD_H - 40);
    state.partsOnField.push({ x, y, r: PART_RADIUS, kind: choosePartKind(), born: performance.now() });
  }

  function spawnScoreOrbs(x, y, scoreAmount) {
    const now = performance.now();
    let remaining = Math.max(0, Math.floor(scoreAmount));
    const chunks = clamp(Math.ceil(remaining / 35), 2, 7);

    for (let i = 0; i < chunks; i++) {
      const val = (i === chunks - 1) ? remaining : Math.floor(remaining / (chunks - i));
      remaining -= val;
      const a = rand(0, Math.PI * 2);
      const d = rand(6, 26);
      state.partsOnField.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, r: PART_RADIUS + 1, kind: "score", value: val, born: now });
    }
    spawnParticles(x, y, "rgba(255,215,110,0.90)", 10, 70, 160, 240, 460, 2, 3.5);
  }

  // ---------------------------
  // Pickups
  // ---------------------------
  function pickupPart(f, part) {
    if (part.kind === "score") {
      const val = part.value || 0;
      f.score += val;
      spawnFloatText(f.x, f.y - f.r - 18, `+${val}`, "rgba(255,215,110,0.95)", 900);
      return;
    }

    if (part.kind === "edge") {
      if (f.edges < PLAYER_EDGE_CAP) {
        f.parts++;
        f.score += SCORE_PER_EDGE_PART;
        spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_EDGE_PART}`, "rgba(166,255,126,0.95)", 700);

        if (f.parts % PARTS_PER_EDGE === 0) {
          const before = f.edges;
          f.edges = clamp(f.edges + 1, 3, PLAYER_EDGE_CAP);
          if (f.edges !== before) {
            recomputeFighterStats(f);
            f.hp = clamp(f.hp + Math.round(0.12 * f.maxHp), 0, f.maxHp);
            spawnParticles(f.x, f.y, "rgba(166,255,126,0.92)", 10, 70, 190, 220, 480, 2, 4);
            addShake(1.2, 100);
          }
        }
      } else {
        f.plasmaParts++;
        f.score += SCORE_PER_EDGE_PART;
        if (f.plasmaParts % PARTS_PER_PLASMA === 0) addPlasma(f, 1);
      }
    } else if (part.kind === "regen") {
      f.regenParts++;
      f.score += SCORE_PER_REGEN_PART;
      spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_REGEN_PART}`, "rgba(126,231,255,0.95)", 720);
      spawnParticles(f.x, f.y, "rgba(126,231,255,0.85)", 8, 50, 150, 180, 420, 2, 3.5);
    } else if (part.kind === "wave") {
      f.waveParts++;
      f.score += SCORE_PER_WAVE_PART;
      spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_WAVE_PART}`, "rgba(178,107,255,0.98)", 760);
      spawnParticles(f.x, f.y, "rgba(178,107,255,0.85)", 9, 60, 160, 200, 450, 2, 3.5);
      if (f.waveParts % WAVE_PARTS_PER_LEVEL === 0) addWave(f, 1);
    }
  }

  // ---------------------------
  // Wave projectiles
  // ---------------------------
  function tryWave(p, now) {
    if (p.wave <= 0) return;
    if (p.waveReadyAt > now) return;
    p.waveReadyAt = now + WAVE_COOLDOWN_MS;

    const ax = p.aimX || 1, ay = p.aimY || 0;
    const mag = Math.hypot(ax, ay) || 1;
    const dx = ax / mag, dy = ay / mag;

    state.projectiles.push({
      owner: p,
      x: p.x + dx * (p.r + 8),
      y: p.y + dy * (p.r + 8),
      dx, dy,
      w: WAVE_WIDTH,
      len: 52,
      speed: WAVE_SPEED,
      life: WAVE_RANGE / WAVE_SPEED,
      age: 0,
      damageMult: WAVE_DAMAGE_MULT,
      waveLevel: p.wave,
      born: now,
    });

    spawnParticles(p.x + dx * 18, p.y + dy * 18, "rgba(178,107,255,0.85)", 7, 70, 170, 140, 300, 2, 3.5);
    addShake(1.0, 80);
  }

  function rectHitProjectile(proj, target) {
    const px = proj.x, py = proj.y;
    const tx = target.x, ty = target.y;
    const ex = px + proj.dx * proj.len;
    const ey = py + proj.dy * proj.len;

    const vx = ex - px, vy = ey - py;
    const wx = tx - px, wy = ty - py;

    const c1 = vx * wx + vy * wy;
    const r2 = (target.r + proj.w / 2) ** 2;

    if (c1 <= 0) return dist2(tx, ty, px, py) <= r2;
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return dist2(tx, ty, ex, ey) <= r2;

    const b = c1 / c2;
    const bx = px + b * vx;
    const by = py + b * vy;
    return dist2(tx, ty, bx, by) <= r2;
  }

  function updateProjectiles(dt, now) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const pr = state.projectiles[i];
      pr.age += dt;
      pr.x += pr.dx * pr.speed * dt;
      pr.y += pr.dy * pr.speed * dt;

      const targets = [...state.enemies];
      if (state.boss) targets.push(state.boss);
      if (state.botPlayer) targets.push(state.botPlayer);
      targets.push(state.player);

      let hit = false;
      for (const t of targets) {
        if (!t || t.hp <= 0) continue;
        if (t === pr.owner) continue;
        if (rectHitProjectile(pr, t)) {
          const mult = pr.damageMult * (1 + pr.waveLevel * 0.05);
          pr.owner.hitReadyAt = Math.min(pr.owner.hitReadyAt, now);
          applyDamage(pr.owner, t, now, mult, true);
          hit = true;
          break;
        }
      }

      if (pr.age >= pr.life || hit) state.projectiles.splice(i, 1);
    }
  }

  // ---------------------------
  // Combat
  // ---------------------------
  function applyDamage(attacker, defender, now, extraMult = 1, fromWave = false) {
    if (attacker.hitReadyAt > now && !fromWave) return;
    attacker.hitReadyAt = now + HIT_COOLDOWN_MS;
    // Spawn protection
    if (defender.invulnUntil && now < defender.invulnUntil) return;

    let mult = extraMult;

    if (attacker.plasmaPrimed) {
        mult *= PLASMA_FIRST_HIT_MULT;
        attacker.plasmaPrimed = false;

        // VISUAL PROC FEEDBACK
        attacker.plasmaFlashUntil = now + 160;
        spawnParticles(defender.x, defender.y, "rgba(178,107,255,0.95)", 14, 140, 360, 180, 420, 2, 4.2);
        addShake(2.2, 140);
      }

    const base = attacker.atk - defender.def * 0.58;
    const dmg = Math.max(2, Math.round((base + rand(-2, 2)) * mult));
    defender.hp = Math.max(0, defender.hp - dmg);

    if (attacker === state.player) attacker.lastLandedHitAt = now;

    const big = mult >= 2.2;
    spawnFloatText(defender.x, defender.y - defender.r - 6, `-${dmg}`, big ? "rgba(255,215,110,0.98)" : "rgba(255,255,255,0.92)", big ? 900 : 650);
    // fewer particles than before
    spawnParticles(defender.x, defender.y, "rgba(255,255,255,0.80)", big ? 12 : 7, 90, 220, 160, 360, 1.5, 3.2);
    addShake(big ? 1.8 : 1.0, big ? 130 : 80);

    if (defender.hp <= 0) {
      addFlash(55);

      if (defender === state.boss) {
        attacker.score += SCORE_PER_BOSS_KO;
        spawnFloatText(attacker.x, attacker.y - attacker.r - 22, `+${SCORE_PER_BOSS_KO}`, "rgba(255,215,110,0.98)", 1100);
        state.message = "BOSS DEFEATED!";
        state.messageUntil = now + 1400;
        spawnParticles(defender.x, defender.y, "rgba(255,80,80,0.92)", 22, 120, 320, 380, 720, 2, 4.8);
        addShake(2.8, 200);
        state.boss = null;
        scheduleNextBoss(now);
        return;
      }

      const isDefenderAPlayer = (defender === state.player || defender === state.botPlayer);
      const isAttackerAPlayer = (attacker === state.player || attacker === state.botPlayer);

      if (isDefenderAPlayer && isAttackerAPlayer && attacker !== defender) {
        const dropped = Math.floor(defender.score * SCORE_DROP_FRACTION_PVP);
        defender.score = Math.max(0, defender.score - dropped);
        if (dropped > 0) spawnScoreOrbs(defender.x, defender.y, dropped);

        attacker.score += SCORE_PER_ENEMY_KO;
        spawnFloatText(attacker.x, attacker.y - attacker.r - 22, `+${SCORE_PER_ENEMY_KO}`, "rgba(255,215,110,0.98)", 980);

        respawnFighter(defender, defender === state.player);
        return;
      }

      if (defender !== state.player && defender !== state.botPlayer) {
        state.kos++;
        attacker.score += SCORE_PER_ENEMY_KO;
        spawnFloatText(attacker.x, attacker.y - attacker.r - 22, `+${SCORE_PER_ENEMY_KO}`, "rgba(255,215,110,0.98)", 980);
        respawnEnemy(defender);
        return;
      }

      respawnFighter(defender, defender === state.player);
    }
  }

  function respawnEnemy(enemy) {
    enemy.x = rand(120, WORLD_W - 120);
    enemy.y = rand(120, WORLD_H - 120);
    enemy.vx = 0; enemy.vy = 0;

    if (Math.random() < 0.65) {
      const prev = enemy.edges;
      enemy.edges = clamp(enemy.edges + 1, 3, EDGE_CAP);
      if (enemy.edges !== prev) {
        const s = computeStats(enemy.edges);
        enemy.atk = s.atk; enemy.def = s.def; enemy.maxHp = s.maxHp;
      }
    }
    enemy.hp = enemy.maxHp;
  }

  function respawnFighter(p, isPlayer) {
    const now = performance.now();

    p.x = WORLD_W * 0.5 + (isPlayer ? 0 : 220);
    p.y = WORLD_H * 0.55 + (isPlayer ? 0 : 160);
    p.vx = 0; p.vy = 0;

    recomputeFighterStats(p);
    p.hp = p.maxHp;

    p.plasmaPrimed = true;
    p.lastLandedHitAt = -1e9;

    p.stuckFrames = 0;
    p.escapeUntil = 0;

    // Spawn protection (prevents insta-death + reduces jitter)
    p.invulnUntil = now + 1400;

    // If boss exists and we're too close, shove spawn away
    if (state.boss) {
      const dx = p.x - state.boss.x;
      const dy = p.y - state.boss.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 420) {
        const ux = dx / d, uy = dy / d;
        p.x = clamp(state.boss.x + ux * 520, p.r + 10, WORLD_W - p.r - 10);
        p.y = clamp(state.boss.y + uy * 520, p.r + 10, WORLD_H - p.r - 10);
      }
    }
  }

  // ---------------------------
  // Dash
  // ---------------------------
  function tryDash(p, now) {
    if (p.dashReadyAt > now) return;
    p.dashReadyAt = now + DASH_COOLDOWN_MS;
    p.dashingUntil = now + DASH_TIME_MS;
    spawnParticles(p.x, p.y, "rgba(126,231,255,0.65)", 7, 90, 220, 180, 380, 2, 3.6);
    addShake(0.9, 60);
  }

  // ---------------------------
  // Camera + shake
  // ---------------------------
  function updateCamera(dt) {
    const { w, h } = viewSize();
    const p = state.player;
    const targetX = clamp(p.x - w / 2, 0, WORLD_W - w);
    const targetY = clamp(p.y - h / 2, 0, WORLD_H - h);

    // slightly less math than exp() version but still smooth
    const lerp = clamp(dt * 10, 0, 1);
    state.camX += (targetX - state.camX) * lerp;
    state.camY += (targetY - state.camY) * lerp;
  }

  function worldToScreen(x, y) {
    let sx = x - state.camX;
    let sy = y - state.camY;

    if (FX.shakeT > 0 && FX.shakeMag > 0.001) {
      sx += rand(-FX.shakeMag, FX.shakeMag);
      sy += rand(-FX.shakeMag, FX.shakeMag);
    }
    return { x: sx, y: sy };
  }

  // ---------------------------
  // Boss scheduling
  // ---------------------------
  function scheduleNextBoss(now) { state.nextBossAt = now + rand(BOSS_MIN_SPAWN_MS, BOSS_MAX_SPAWN_MS); }
  function maybeSpawnBoss(now) {
    if (state.boss) return;
    if (now < state.nextBossAt) return;
    state.boss = makeBoss();
    state.message = "A BOSS has appeared!";
    state.messageUntil = now + 1500;
    spawnParticles(state.boss.x, state.boss.y, "rgba(255,80,80,0.85)", 14, 120, 260, 360, 720, 2.2, 4.6);
    addShake(2.5, 180);
    scheduleNextBoss(now);
  }

  // ---------------------------
  // AI
  // ---------------------------
  function updateEnemyAI(e, dt, now) {
    if (now > e.retargetAt) {
      e.retargetAt = now + rand(650, 1200);
      const dp = dist2(e.x, e.y, state.player.x, state.player.y);
      const db = state.botPlayer ? dist2(e.x, e.y, state.botPlayer.x, state.botPlayer.y) : Infinity;
      const chase = (db < dp) ? state.botPlayer : state.player;
      e.targetX = chase.x + rand(-160, 160);
      e.targetY = chase.y + rand(-160, 160);
    }

    let best = null, bestD2 = Infinity;
    for (const p of state.partsOnField) {
      if (p.kind === "score") continue;
      const d2 = dist2(e.x, e.y, p.x, p.y);
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    const partBias = e.type === "brute" ? 0.55 : 1.0;
    if (best && bestD2 < (260 * 260) * partBias) {
      e.targetX = best.x; e.targetY = best.y;
    }

    let dx = e.targetX - e.x, dy = e.targetY - e.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    e.vx = dx; e.vy = dy;

    let speedMul = 0.9;
    if (e.type === "skitter") speedMul = 1.15;
    if (e.type === "brute") speedMul = 0.75;

    const speed = (BASE_SPEED * 0.86 * speedMul) + (e.edges - 4) * 2.8;
    moveEntity(e, dt, speed);
    e.rot += dt * (1.6 + (e.edges - 4) * 0.05);

    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const part = state.partsOnField[i];
      if (part.kind === "score") continue;
      const rr = e.r + part.r + 2;
      if (dist2(e.x, e.y, part.x, part.y) <= rr * rr) {
        state.partsOnField.splice(i, 1);
        if (part.kind === "edge") {
          if (Math.random() < 0.40) {
            const prev = e.edges;
            e.edges = clamp(e.edges + 1, 3, EDGE_CAP);
            if (e.edges !== prev) {
              const s = computeStats(e.edges);
              e.atk = s.atk; e.def = s.def; e.maxHp = s.maxHp;
            }
          }
        } else {
          e.hp = clamp(e.hp + Math.round(e.maxHp * 0.14), 0, e.maxHp);
        }
      }
    }
  }

  function updateBoss(dt) {
    const b = state.boss;
    if (!b) return;

    const dp = dist2(b.x, b.y, state.player.x, state.player.y);
    const db = state.botPlayer ? dist2(b.x, b.y, state.botPlayer.x, state.botPlayer.y) : Infinity;
    const chase = (db < dp) ? state.botPlayer : state.player;

    let dx = chase.x - b.x, dy = chase.y - b.y;
    const len = Math.hypot(dx, dy) || 1;
    b.vx = dx / len; b.vy = dy / len;

    moveEntity(b, dt, BASE_SPEED * 0.78);
    b.rot += dt * 1.2;
  }

  // ---------------------------
  // Player update
  // ---------------------------
  function updatePlayer(dt, now) {
    const p = state.player;

    let ax = 0, ay = 0;
    const up = keys.has("w") || keys.has("arrowup");
    const down = keys.has("s") || keys.has("arrowdown");
    const left = keys.has("a") || keys.has("arrowleft");
    const right = keys.has("d") || keys.has("arrowright");

    if (up) ay -= 1;
    if (down) ay += 1;
    if (left) ax -= 1;
    if (right) ax += 1;

    const len = Math.hypot(ax, ay);
    if (len > 0.001) { p.aimX = ax / len; p.aimY = ay / len; }

    const n = len || 1;
    p.vx = ax / n; p.vy = ay / n;

    if (keys.has(" ")) tryDash(p, now);

    const isDashing = now < p.dashingUntil;
    const speed = isDashing ? DASH_SPEED : BASE_SPEED;
    moveEntity(p, dt, speed);

    p.rot += dt * (1.8 + (p.edges - 4) * 0.07);
    regenTick(p, dt);

    // pickups
    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const part = state.partsOnField[i];
      const rr = p.r + part.r + 4;
      if (dist2(p.x, p.y, part.x, part.y) <= rr * rr) {
        state.partsOnField.splice(i, 1);
        pickupPart(p, part);
      }
    }

    // combat
    for (const e of state.enemies) {
      if (dist2(p.x, p.y, e.x, e.y) <= HIT_RANGE * HIT_RANGE) {
        applyDamage(p, e, now);
        applyDamage(e, p, now);
      }
    }
    if (state.boss && dist2(p.x, p.y, state.boss.x, state.boss.y) <= (HIT_RANGE + 14) ** 2) {
      applyDamage(p, state.boss, now);
      applyDamage(state.boss, p, now);
    }
    if (state.botPlayer && dist2(p.x, p.y, state.botPlayer.x, state.botPlayer.y) <= HIT_RANGE * HIT_RANGE) {
      applyDamage(p, state.botPlayer, now);
      applyDamage(state.botPlayer, p, now);
    }

    updateCamera(dt);
  }

    function updateBotPlayer(dt, now) {
    const b = state.botPlayer;
    if (!b) return;

    // --- helper steering (smooth) ---
    function steerTo(tx, ty, strength = 1.0) {
      let dx = tx - b.x, dy = ty - b.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;

      // smooth direction to reduce jitter
      const s = clamp(dt * 10 * strength, 0, 1);
      b.vx = b.vx + (dx - b.vx) * s;
      b.vy = b.vy + (dy - b.vy) * s;

      const aimLen = Math.hypot(b.vx, b.vy) || 1;
      b.aimX = b.vx / aimLen;
      b.aimY = b.vy / aimLen;
    }

    // escape mode if stuck
    if (now < b.escapeUntil) {
      b.vx = b.escapeX;
      b.vy = b.escapeY;
    } else {
      // 1) Boss avoidance: keep distance if boss is near
      if (state.boss) {
        const bd = Math.hypot(b.x - state.boss.x, b.y - state.boss.y);
        const preferRange = 520;

        if (bd < preferRange) {
          // kite away
          const dx = b.x - state.boss.x;
          const dy = b.y - state.boss.y;
          const d = Math.hypot(dx, dy) || 1;
          const awayX = b.x + (dx / d) * 240;
          const awayY = b.y + (dy / d) * 240;

          steerTo(awayX, awayY, 1.3);

          // occasionally wave while kiting
          if (b.wave > 0 && Math.random() < 0.018) tryWave(b, now);
        } else {
          // 2) Otherwise: go for nearest non-score part
          let target = null, best = Infinity;
          for (const part of state.partsOnField) {
            if (part.kind === "score") continue;
            const d2 = dist2(b.x, b.y, part.x, part.y);
            if (d2 < best) { best = d2; target = part; }
          }

          if (target) steerTo(target.x, target.y, 1.0);
          else steerTo(state.player.x + rand(-160, 160), state.player.y + rand(-160, 160), 0.9);

          // occasional wave
          if (b.wave > 0 && Math.random() < 0.010) tryWave(b, now);
        }
      } else {
        // No boss: prioritize parts, then shadow the player
        let target = null, best = Infinity;
        for (const part of state.partsOnField) {
          if (part.kind === "score") continue;
          const d2 = dist2(b.x, b.y, part.x, part.y);
          if (d2 < best) { best = d2; target = part; }
        }
        if (target) steerTo(target.x, target.y, 1.0);
        else steerTo(state.player.x + rand(-140, 140), state.player.y + rand(-140, 140), 0.9);

        if (b.wave > 0 && Math.random() < 0.010) tryWave(b, now);
      }
    }

    // Movement
    const preX = b.x, preY = b.y;
    moveEntity(b, dt, BASE_SPEED * 0.94);
    b.rot += dt * 1.7;

    // Stuck detection
    const moved = Math.hypot(b.x - preX, b.y - preY);
    const trying = Math.hypot(b.vx, b.vy) > 0.2;
    if (trying && moved < BOT_STUCK_DIST_EPS) b.stuckFrames++;
    else b.stuckFrames = Math.max(0, b.stuckFrames - 1);

    if (b.stuckFrames >= BOT_STUCK_FRAMES) {
      b.stuckFrames = 0;

      // choose a random escape direction (works better than just perpendicular near rectangles)
      const a = rand(0, Math.PI * 2);
      b.escapeX = Math.cos(a);
      b.escapeY = Math.sin(a);
      b.escapeUntil = now + BOT_ESCAPE_MS + rand(120, 280);
    }

    regenTick(b, dt);

    // pickups
    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const part = state.partsOnField[i];
      const rr = b.r + part.r + 4;
      if (dist2(b.x, b.y, part.x, part.y) <= rr * rr) {
        state.partsOnField.splice(i, 1);
        pickupPart(b, part);
      }
    }

    // combat: enemies + player + boss
    for (const e of state.enemies) {
      if (dist2(b.x, b.y, e.x, e.y) <= HIT_RANGE * HIT_RANGE) {
        applyDamage(b, e, now);
        applyDamage(e, b, now);
      }
    }

    if (state.boss && dist2(b.x, b.y, state.boss.x, state.boss.y) <= (HIT_RANGE + 14) ** 2) {
      applyDamage(b, state.boss, now);
      applyDamage(state.boss, b, now);
    }

    if (dist2(b.x, b.y, state.player.x, state.player.y) <= HIT_RANGE * HIT_RANGE) {
      applyDamage(b, state.player, now);
      applyDamage(state.player, b, now);
    }
  }


  // ---------------------------
  // Rendering (cheap but good)
  // ---------------------------
  function drawBackground(now) {
    const { w, h } = viewSize();

    const t = now * 0.00010;
    const cx = w * (0.45 + Math.sin(t) * 0.02);
    const cy = h * (0.40 + Math.cos(t * 1.1) * 0.02);

    const grd = ctx.createRadialGradient(cx, cy, 70, w * 0.5, h * 0.5, Math.max(w, h) * 0.85);
    grd.addColorStop(0, C.bgA);
    grd.addColorStop(0.45, C.bgB);
    grd.addColorStop(0.9, C.bgC);
    grd.addColorStop(1, "rgba(0,0,0,0.48)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // cheaper grid (fewer lines)
    ctx.save();
    ctx.globalAlpha = GRID_ALPHA;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;

    const step = GRID_STEP;
    const startX = -((state.camX) % step);
    const startY = -((state.camY) % step);

    for (let x = startX; x <= w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = startY; y <= h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function partColor(kind) {
    if (kind === "regen") return C.regenPart;
    if (kind === "wave") return C.wavePart;
    if (kind === "score") return C.scoreOrb;
    return C.edgePart;
  }

  function drawObstacles() {
    const { w, h } = viewSize();
    for (const o of state.obstacles) {
      const s = worldToScreen(o.x, o.y);
      if (s.x > w + 40 || s.y > h + 40 || s.x + o.w < -40 || s.y + o.h < -40) continue;

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      roundRectPath(s.x, s.y, o.w, o.h, 14);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawParts(now) {
    const { w, h } = viewSize();
    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const p = state.partsOnField[i];
      if (p.kind === "score" && now - p.born > SCORE_ORB_LIFETIME_MS) {
        state.partsOnField.splice(i, 1);
        continue;
      }

      const s = worldToScreen(p.x, p.y);
      if (s.x < -50 || s.y < -50 || s.x > w + 50 || s.y > h + 50) continue;

      const pulse = 1 + Math.sin((now - p.born) * 0.007) * 0.10;
      const r = p.r * pulse;

      ctx.save();
      ctx.shadowColor = partColor(p.kind);
      ctx.shadowBlur = SHADOW_BLUR_LIGHT;

      // outer ring
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // core
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = partColor(p.kind);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // icon
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(0,0,0,0.36)";
      if (p.kind === "regen") {
        ctx.fillRect(s.x - 5, s.y - 1, 10, 2);
        ctx.fillRect(s.x - 1, s.y - 5, 2, 10);
      } else if (p.kind === "wave") {
        ctx.beginPath();
        ctx.moveTo(s.x - 7, s.y + 1);
        ctx.quadraticCurveTo(s.x - 2, s.y - 5, s.x + 3, s.y + 1);
        ctx.quadraticCurveTo(s.x + 7, s.y + 7, s.x + 11, s.y + 1);
        ctx.strokeStyle = "rgba(0,0,0,0.36)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (p.kind === "score") {
        ctx.font = "800 10px system-ui, sans-serif";
        ctx.fillText(String(p.value || 0), s.x - 6, s.y + 4);
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawProjectiles() {
    for (const pr of state.projectiles) {
      const s = worldToScreen(pr.x, pr.y);
      const ex = pr.x + pr.dx * pr.len;
      const ey = pr.y + pr.dy * pr.len;
      const se = worldToScreen(ex, ey);

      ctx.save();
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(178,107,255,0.75)";
      ctx.shadowBlur = SHADOW_BLUR_HEAVY;

      ctx.strokeStyle = "rgba(178,107,255,0.65)";
      ctx.lineWidth = pr.w + 8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(se.x, se.y);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(178,107,255,0.92)";
      ctx.lineWidth = pr.w;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(se.x, se.y);
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawEnemies() {
    const { w, h } = viewSize();
    for (const e of state.enemies) {
      const s = worldToScreen(e.x, e.y);
      if (s.x < -100 || s.y < -100 || s.x > w + 100 || s.y > h + 100) continue;

      let fill = C.enemyFill, stroke = C.enemyStroke;
      if (e.type === "brute") { fill = C.bruteFill; stroke = C.bruteStroke; }
      if (e.type === "skitter") { fill = C.skitterFill; stroke = C.skitterStroke; }

      ctx.save();
      ctx.shadowColor = stroke;
      ctx.shadowBlur = SHADOW_BLUR_LIGHT;
      drawPolygon(ctx, s.x, s.y, e.r, e.edges, e.rot, fill, stroke);
      ctx.shadowBlur = 0;
      drawHealthBar(ctx, s.x - 18, s.y - e.r - 12, 36, 5, e.hp, e.maxHp);
      ctx.restore();
    }
  }

  function drawBoss() {
    const b = state.boss;
    if (!b) return;
    const s = worldToScreen(b.x, b.y);

    ctx.save();
    ctx.shadowColor = C.bossStroke;
    ctx.shadowBlur = SHADOW_BLUR_HEAVY;
    drawPolygon(ctx, s.x, s.y, b.r, b.edges, b.rot, C.bossFill, C.bossStroke);
    ctx.shadowBlur = 0;
    drawHealthBar(ctx, s.x - 34, s.y - b.r - 14, 68, 7, b.hp, b.maxHp);
    ctx.restore();
  }


  function drawBlade(g, x, y, angle, length, width) {
    // simple triangular blade
    const tipX = x + Math.cos(angle) * length;
    const tipY = y + Math.sin(angle) * length;

    const nx = -Math.sin(angle);
    const ny =  Math.cos(angle);

    const b1x = x + nx * width;
    const b1y = y + ny * width;
    const b2x = x - nx * width;
    const b2y = y - ny * width;

    g.beginPath();
    g.moveTo(tipX, tipY);
    g.lineTo(b1x, b1y);
    g.lineTo(b2x, b2y);
    g.closePath();
    g.fill();
    g.stroke();
  }


  function drawFighter(p, now) {
    if (!p) return;
    const s = worldToScreen(p.x, p.y);

    // plasma blades (cheap dots)
        if (p.plasma > 0) {
      const blades = Math.min(PLASMA_MAX, p.plasma);
      const orbitR = p.r + 14;

      const procFlash = (p.plasmaFlashUntil && now < p.plasmaFlashUntil);
      const glow = procFlash ? SHADOW_BLUR_HEAVY : SHADOW_BLUR_LIGHT;

      ctx.save();
      ctx.shadowBlur = glow;

      for (let i = 0; i < blades; i++) {
        const a = now * 0.0026 + (i * Math.PI * 2) / blades;
        const bx = s.x + Math.cos(a) * orbitR;
        const by = s.y + Math.sin(a) * orbitR;

        // blade points outward
        const outward = a;

        // core color + purple edge
        ctx.fillStyle = procFlash ? "rgba(255,255,255,0.92)" : "rgba(126,231,255,0.85)";
        ctx.strokeStyle = "rgba(178,107,255,0.85)";
        ctx.lineWidth = procFlash ? 2.4 : 1.8;

        ctx.shadowColor = procFlash ? "rgba(178,107,255,0.95)" : "rgba(126,231,255,0.70)";

        // draw triangular blade
        const len = procFlash ? 16 : 13;
        const wid = procFlash ? 5.2 : 4.3;
        drawBlade(ctx, bx, by, outward, len, wid);

        // small spark at the tip during proc flash (cheap)
        if (procFlash && i % 2 === 0) {
          const tx = bx + Math.cos(outward) * len;
          const ty = by + Math.sin(outward) * len;
          ctx.beginPath();
          ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(178,107,255,0.95)";
          ctx.fill();
        }
      }

      ctx.restore();
    }


    const isBot = p.tint === "bot";
    const fill = isBot ? C.botFill : C.playerFill;
    const stroke = isBot ? C.botStroke : C.playerStroke;

    ctx.save();
    ctx.shadowColor = stroke;
    ctx.shadowBlur = SHADOW_BLUR_HEAVY;
    drawPolygon(ctx, s.x, s.y, p.r, p.edges, p.rot, fill, stroke);
    ctx.shadowBlur = 0;

    drawHealthBar(ctx, s.x - 22, s.y - p.r - 14, 44, 6, p.hp, p.maxHp);

    // score text
    ctx.globalAlpha = 0.92;
    ctx.font = "900 13px system-ui, sans-serif";
    ctx.fillStyle = isBot ? "rgba(255,255,255,0.85)" : "rgba(255,215,110,0.96)";
    ctx.fillText(String(p.score), s.x - 10, s.y - p.r - 26);
    ctx.restore();
  }

  function drawParticles(now, dt) {
    // update particles (simple Euler with dt)
    for (let i = FX.particles.length - 1; i >= 0; i--) {
      const pt = FX.particles[i];
      const age = now - pt.born;
      if (age > pt.life) { FX.particles.splice(i, 1); continue; }

      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;

      const t = 1 - age / pt.life;
      const s = worldToScreen(pt.x, pt.y);

      ctx.save();
      ctx.globalAlpha = clamp(t, 0, 1) * 0.9;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // float texts
    for (let i = FX.floatText.length - 1; i >= 0; i--) {
      const ft = FX.floatText[i];
      const age = now - ft.born;
      if (age > ft.life) { FX.floatText.splice(i, 1); continue; }

      const a = 1 - age / ft.life;
      ft.y += ft.vy * dt;
      const s = worldToScreen(ft.x, ft.y);

      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = "900 14px system-ui, sans-serif";
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, s.x - 10, s.y);
      ctx.restore();
    }
  }

  function drawFlash(dtMs) {
    if (FX.flashT <= 0) return;
    FX.flashT = Math.max(0, FX.flashT - dtMs);
    const a = FX.flashT / 70;
    const { w, h } = viewSize();
    ctx.save();
    ctx.globalAlpha = 0.16 * a;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function render(now, dt, dtMs) {
    // shake decay
    if (FX.shakeT > 0) {
      FX.shakeT = Math.max(0, FX.shakeT - dtMs);
      FX.shakeMag *= 0.90;
      if (FX.shakeT <= 0) FX.shakeMag = 0;
    }

    const { w, h } = viewSize();
    ctx.clearRect(0, 0, w, h);

    drawBackground(now);
    drawObstacles();
    drawParts(now);
    drawProjectiles();
    drawEnemies();
    drawBoss();
    drawFighter(state.botPlayer, now);
    drawFighter(state.player, now);
    drawParticles(now, dt);

    // toast message
    if (state.message && now < state.messageUntil) {
      ctx.save();
      ctx.font = "800 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const text = state.message;
      const padX = 12;
      const metrics = ctx.measureText(text);
      const bx = w * 0.5;
      const by = 34;
      const bw = metrics.width + padX * 2;
      const bh = 28;

      ctx.fillStyle = "rgba(0,0,0,0.50)";
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      roundRectPath(bx - bw / 2, by - bh / 2, bw, bh, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(text, bx, by);
      ctx.restore();
    }

    // dash cooldown
    const cd = Math.max(0, state.player.dashReadyAt - now);
    if (cd > 0) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.font = "700 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillText(`Dash CD: ${(cd / 1000).toFixed(1)}s`, 14, h - 14);
      ctx.restore();
    }

    drawFlash(dtMs);
  }

  // ---------------------------
  // HUD
  // ---------------------------
  function updateHUD() {
    const p = state.player;
    if (elEdges) elEdges.textContent = String(p.edges);
    if (elAtk) elAtk.textContent = String(p.atk);
    if (elDef) elDef.textContent = String(p.def);
    if (elPlasma) elPlasma.textContent = String(p.plasma);
    if (elWave) elWave.textContent = String(p.wave);
    if (elHp) elHp.textContent = String(Math.round(p.hp));
    if (elKos) elKos.textContent = String(state.kos);
    if (elParts) elParts.textContent = String(p.parts);
  }

  // ---------------------------
  // Reset
  // ---------------------------
  function resetGame() {
    resizeCanvas();
    buildObstacles();

    state.partsOnField = [];
    state.projectiles = [];
    FX.particles = [];
    FX.floatText = [];
    FX.shakeT = 0; FX.shakeMag = 0; FX.flashT = 0;

    state.enemies = Array.from({ length: ENEMY_COUNT }, (_, i) => makeEnemy(i));
    state.player = makePlayer();
    state.botPlayer = makeBotPlayer();
    recomputeFighterStats(state.player);
    recomputeFighterStats(state.botPlayer);

    state.kos = 0;
    state.nextPartAt = performance.now() + 250;

    state.boss = null;
    scheduleNextBoss(performance.now());

    const { w, h } = viewSize();
    state.camX = clamp(state.player.x - w / 2, 0, WORLD_W - w);
    state.camY = clamp(state.player.y - h / 2, 0, WORLD_H - h);

    state.message = "Optimized visuals: smoother FPS. WASD/Arrows • Space dash • E wave";
    state.messageUntil = performance.now() + 2400;

    hideOverlay();
    paused = false;
    if (btnPause) btnPause.textContent = "Pause";
    updateHUD();
  }

  // ---------------------------
  // Main loop
  // ---------------------------
  function tick(now) {
    if (paused) return;

    const dt = Math.min(0.033, (now - lastT) / 1000);
    const dtMs = Math.min(33, now - lastT);
    lastT = now;

    if (now > state.nextPartAt) {
      state.nextPartAt = now + PART_SPAWN_INTERVAL_MS;
      if (state.partsOnField.length < PART_MAX_ON_FIELD) spawnPart();
    }

    maybeSpawnBoss(now);

    updatePlayer(dt, now);
    updateBotPlayer(dt, now);
    for (const e of state.enemies) updateEnemyAI(e, dt, now);
    updateBoss(dt);

    updateProjectiles(dt, now);

    updateHUD();
    render(now, dt, dtMs);

    requestAnimationFrame(tick);
  }

  // ---------------------------
  // Start
  // ---------------------------
  resetGame();
  setPaused(false);

})();

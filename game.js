// ========================= game.js =========================
// Polygon Parts Arena — bots + wave stat + boss + score + PvP drops
//
// Controls: WASD/Arrows move • Space dash • P pause • E wave attack (requires Wave>0)
//
// Pickups:
//  - Green  = Edge part
//  - Blue   = Regen part
//  - Purple = Wave part (rare) -> Wave stat
//  - Gold   = Score orb (drops on PvP elimination)
//
// Plasma:
//  After 26 edges, green parts feed Plasma (blades). Plasma boosts Attack only.
//  Plasma: first hit after quiet window does 3×, follow-ups 1× until re-primed.
//
// Score:
//  + part pickups, + KOs, + boss defeat.
//  PvP elimination drops % of victim score as gold orbs.
//
// Fake multiplayer:
//  A bot player follows same growth loop and can PvP you.
//
// Boss:
//  Rare spawn, huge HP, slightly stronger.

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

  // Plasma hit behavior
  const PLASMA_PRIME_TIME_MS = 1200;
  const PLASMA_FIRST_HIT_MULT = 3;

  // Wave stat
  const WAVE_MAX = 8;
  const WAVE_PARTS_PER_LEVEL = 2;
  const WAVE_COOLDOWN_MS = 950;
  const WAVE_RANGE = 520;
  const WAVE_WIDTH = 46;
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
  const SCORE_DROP_FRACTION_PVP = 0.35;     // % of victim score dropped
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
  const BOT_STUCK_DIST_EPS = 2.0;      // px per frame considered "not moving"
  const BOT_STUCK_FRAMES = 10;         // frames before escape
  const BOT_ESCAPE_MS = 550;           // how long to escape steer

  // ---------------------------
  // DOM
  // ---------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const elEdges = document.getElementById("edges");
  const elAtk = document.getElementById("atk");
  const elDef = document.getElementById("def");
  const elPlasma = document.getElementById("plasma");
  const elWave = document.getElementById("wave");
  const elHp = document.getElementById("hp");
  const elKos = document.getElementById("kos");
  const elParts = document.getElementById("parts");
  const elBot = document.getElementById("bot");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");
  const btnResume = document.getElementById("btnResume");
  const btnHardReset = document.getElementById("btnHardReset");

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

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPolygon(x, y, radius, sides, rotation, fill, stroke) {
    const s = Math.max(3, Math.floor(sides));
    ctx.beginPath();
    for (let i = 0; i < s; i++) {
      const a = rotation + (i * Math.PI * 2) / s;
      const px = x + Math.cos(a) * radius;
      const py = y + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  function drawHealthBar(x, y, w, h, hp, maxHp) {
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x, y, w, h);
    const t = maxHp > 0 ? hp / maxHp : 0;
    ctx.fillStyle = "rgba(166,255,126,0.85)";
    ctx.fillRect(x, y, w * clamp(t, 0, 1), h);
    ctx.restore();
  }

  // Floating numbers (score popups)
  function spawnFloatText(x, y, text, lifeMs = 900) {
    state.floatText.push({
      x, y,
      vy: -28,
      text,
      born: performance.now(),
      life: lifeMs,
    });
  }

  // ---------------------------
  // Canvas sizing
  // ---------------------------
  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

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
    partsOnField: [],      // includes edge/regen/wave/score orbs
    enemies: [],
    obstacles: [],
    projectiles: [],
    floatText: [],
    player: null,
    botPlayer: null,
    kos: 0,
    nextPartAt: 0,
    message: null,
    messageUntil: 0,
    camX: 0,
    camY: 0,
    boss: null,
    nextBossAt: 0,
  };

  // ---------------------------
  // Stats / progression
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
    }
  }

  function addWave(p, amount) {
    const prev = p.wave;
    p.wave = clamp(p.wave + amount, 0, WAVE_MAX);
    if (p.wave !== prev && p === state.player) {
      state.message = "Wave +1!";
      state.messageUntil = performance.now() + 900;
    }
  }

  // ---------------------------
  // Entities
  // ---------------------------
  function makeFighter(x, y, tint) {
    const edges = 4;
    const base = computeStats(edges);

    return {
      x, y,
      vx: 0, vy: 0,
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

      // score
      score: 0,

      // bot unstuck helpers
      stuckFrames: 0,
      lastX: x,
      lastY: y,
      escapeUntil: 0,
      escapeX: 0,
      escapeY: 0,
    };
  }

  function makePlayer() {
    const p = makeFighter(WORLD_W * 0.5, WORLD_H * 0.55, "player");
    p.score = 0;
    return p;
  }

  function makeBotPlayer() {
    const b = makeFighter(WORLD_W * 0.5 + 120, WORLD_H * 0.55 + 90, "bot");
    b.score = 0;
    return b;
  }

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
      for (const k of obs) {
        if (obstacleOverlaps(o, k)) { ok = false; break; }
      }
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
      id: i,
      type,
      x: rand(120, WORLD_W - 120),
      y: rand(120, WORLD_H - 120),
      vx: 0, vy: 0,
      r,
      edges,

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
      id: "boss",
      type: "boss",
      x: rand(200, WORLD_W - 200),
      y: rand(200, WORLD_H - 200),
      vx: 0, vy: 0,
      r: BOSS_RADIUS,
      edges,

      atk: base.atk + BOSS_ATK_BONUS,
      def: base.def + BOSS_DEF_BONUS,
      maxHp,
      hp: maxHp,

      rot: rand(0, Math.PI * 2),
      hitReadyAt: 0,
    };
  }

  // ---------------------------
  // Overlay
  // ---------------------------
  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlay.hidden = false;
  }
  function hideOverlay() {
    overlay.hidden = true;
  }

  // ---------------------------
  // Input
  // ---------------------------
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "p", "e"].includes(k)) e.preventDefault();

    if (k === "p") { setPaused(!paused); return; }
    keys.add(k);

    if (k === "e") {
      tryWave(state.player, performance.now());
    }
  }, { passive: false });

  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  btnPause.addEventListener("click", () => setPaused(!paused));
  btnReset.addEventListener("click", () => resetGame());
  btnResume.addEventListener("click", () => setPaused(false));
  btnHardReset.addEventListener("click", () => resetGame());

  function setPaused(value) {
    paused = !!value;
    if (paused) {
      showOverlay("Paused", "Press P or click Resume.");
      btnPause.textContent = "Resume";
      loopRunning = false;
    } else {
      hideOverlay();
      btnPause.textContent = "Pause";
      lastT = performance.now();
      if (!loopRunning) {
        loopRunning = true;
        requestAnimationFrame(tick);
      }
    }
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
    const angle = rand(0, Math.PI * 2);
    const radius = rand(220, 720);

    const x = clamp(p.x + Math.cos(angle) * radius, 40, WORLD_W - 40);
    const y = clamp(p.y + Math.sin(angle) * radius, 40, WORLD_H - 40);

    const kind = choosePartKind();
    state.partsOnField.push({ x, y, r: PART_RADIUS, kind, born: performance.now() });
  }

  function spawnScoreOrbs(x, y, scoreAmount) {
    // split into multiple small orbs for satisfying pickups
    const now = performance.now();
    let remaining = Math.max(0, Math.floor(scoreAmount));
    const chunks = clamp(Math.ceil(remaining / 35), 2, 8);

    for (let i = 0; i < chunks; i++) {
      const val = (i === chunks - 1) ? remaining : Math.floor(remaining / (chunks - i));
      remaining -= val;

      const a = rand(0, Math.PI * 2);
      const d = rand(6, 30);

      state.partsOnField.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        r: PART_RADIUS + 1,
        kind: "score",
        value: val,
        born: now,
      });
    }
  }

  // ---------------------------
  // Collision: circle vs rect
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
  // Wave projectiles
  // ---------------------------
  function tryWave(p, now) {
    if (p.wave <= 0) return;
    if (p.waveReadyAt > now) return;
    p.waveReadyAt = now + WAVE_COOLDOWN_MS;

    const ax = p.aimX || 1;
    const ay = p.aimY || 0;
    const mag = Math.hypot(ax, ay) || 1;
    const dx = ax / mag;
    const dy = ay / mag;

    state.projectiles.push({
      owner: p,
      x: p.x + dx * (p.r + 8),
      y: p.y + dy * (p.r + 8),
      dx, dy,
      w: WAVE_WIDTH,
      len: 54,
      speed: WAVE_SPEED,
      life: WAVE_RANGE / WAVE_SPEED,
      age: 0,
      damageMult: WAVE_DAMAGE_MULT,
      waveLevel: p.wave,
    });

    if (p === state.player) {
      state.message = "WAVE!";
      state.messageUntil = now + 420;
    }
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

      // PvP: wave can hit the other player too
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
        }
      }

      if (pr.age >= pr.life || hit) state.projectiles.splice(i, 1);
    }
  }

  // ---------------------------
  // Combat (includes PvP)
  // ---------------------------
  function applyDamage(attacker, defender, now, extraMult = 1, fromWave = false) {
    if (attacker.hitReadyAt > now && !fromWave) return;
    attacker.hitReadyAt = now + HIT_COOLDOWN_MS;

    let mult = extraMult;

    // Plasma bonus: only for the real player (you can toggle for bot too later)
    if (attacker === state.player && attacker.plasma > 0) {
      if (now - attacker.lastLandedHitAt > PLASMA_PRIME_TIME_MS) attacker.plasmaPrimed = true;
      if (attacker.plasmaPrimed) {
        mult *= PLASMA_FIRST_HIT_MULT;
        attacker.plasmaPrimed = false;
      }
    }

    const base = attacker.atk - defender.def * 0.58;
    const dmg = Math.max(2, Math.round((base + rand(-2, 2)) * mult));

    defender.hp = Math.max(0, defender.hp - dmg);

    if (attacker === state.player) attacker.lastLandedHitAt = now;

    // small text pop (score-like feedback)
    spawnFloatText(defender.x, defender.y - defender.r - 4, `-${dmg}`, 650);

    if (defender.hp <= 0) {
      // Boss death
      if (defender === state.boss) {
        attacker.score += SCORE_PER_BOSS_KO;
        spawnFloatText(attacker.x, attacker.y - attacker.r - 18, `+${SCORE_PER_BOSS_KO}`, 900);
        state.message = "BOSS DEFEATED!";
        state.messageUntil = now + 1400;
        state.boss = null;
        scheduleNextBoss(now);
        return;
      }

      // PvP death (player vs bot)
      const isDefenderAPlayer = (defender === state.player || defender === state.botPlayer);
      const isAttackerAPlayer = (attacker === state.player || attacker === state.botPlayer);

      if (isDefenderAPlayer && isAttackerAPlayer && attacker !== defender) {
        const dropped = Math.floor(defender.score * SCORE_DROP_FRACTION_PVP);
        defender.score = Math.max(0, defender.score - dropped);
        if (dropped > 0) spawnScoreOrbs(defender.x, defender.y, dropped);

        // attacker gets KO bonus
        attacker.score += SCORE_PER_ENEMY_KO;
        spawnFloatText(attacker.x, attacker.y - attacker.r - 18, `+${SCORE_PER_ENEMY_KO}`, 900);

        respawnFighter(defender, defender === state.player);
        return;
      }

      // Enemy death
      if (defender !== state.player && defender !== state.botPlayer) {
        state.kos++;
        attacker.score += SCORE_PER_ENEMY_KO;
        spawnFloatText(attacker.x, attacker.y - attacker.r - 18, `+${SCORE_PER_ENEMY_KO}`, 900);
        respawnEnemy(defender);
        return;
      }

      // Player/bot died to enemies
      respawnFighter(defender, defender === state.player);
    }
  }

  function respawnEnemy(enemy) {
    enemy.x = rand(120, WORLD_W - 120);
    enemy.y = rand(120, WORLD_H - 120);
    enemy.vx = 0;
    enemy.vy = 0;

    if (Math.random() < 0.65) {
      const prev = enemy.edges;
      enemy.edges = clamp(enemy.edges + 1, 3, EDGE_CAP);
      if (enemy.edges !== prev) {
        const s = computeStats(enemy.edges);
        enemy.atk = s.atk;
        enemy.def = s.def;
        enemy.maxHp = s.maxHp;
      }
    }
    enemy.hp = enemy.maxHp;
  }

  function respawnFighter(p, isPlayer) {
    p.x = WORLD_W * 0.5 + (isPlayer ? 0 : 160);
    p.y = WORLD_H * 0.55 + (isPlayer ? 0 : 120);
    p.vx = 0;
    p.vy = 0;

    recomputeFighterStats(p);
    p.hp = p.maxHp;

    p.plasmaPrimed = true;
    p.lastLandedHitAt = -1e9;

    p.stuckFrames = 0;
    p.escapeUntil = 0;
  }

  // ---------------------------
  // Pickups / progression logic for fighters
  // ---------------------------
  function pickupPart(f, part, now) {
    if (part.kind === "score") {
      const val = part.value || 0;
      f.score += val;
      spawnFloatText(f.x, f.y - f.r - 18, `+${val}`, 850);
      return;
    }

    if (part.kind === "edge") {
      if (f.edges < PLAYER_EDGE_CAP) {
        f.parts++;
        f.score += SCORE_PER_EDGE_PART;
        spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_EDGE_PART}`, 700);

        if (f.parts % PARTS_PER_EDGE === 0) {
          const before = f.edges;
          f.edges = clamp(f.edges + 1, 3, PLAYER_EDGE_CAP);
          if (f.edges !== before) {
            recomputeFighterStats(f);
            f.hp = clamp(f.hp + Math.round(0.12 * f.maxHp), 0, f.maxHp);
          }
        }
      } else {
        f.plasmaParts++;
        f.score += SCORE_PER_EDGE_PART;
        spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_EDGE_PART}`, 700);

        if (f.plasmaParts % PARTS_PER_PLASMA === 0) addPlasma(f, 1);
      }
    } else if (part.kind === "regen") {
      f.regenParts++;
      f.score += SCORE_PER_REGEN_PART;
      spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_REGEN_PART}`, 700);
    } else if (part.kind === "wave") {
      f.waveParts++;
      f.score += SCORE_PER_WAVE_PART;
      spawnFloatText(f.x, f.y - f.r - 18, `+${SCORE_PER_WAVE_PART}`, 750);
      if (f.waveParts % WAVE_PARTS_PER_LEVEL === 0) addWave(f, 1);
    }
  }

  // ---------------------------
  // Player update
  // ---------------------------
  function tryDash(p, now) {
    if (p.dashReadyAt > now) return;
    p.dashReadyAt = now + DASH_COOLDOWN_MS;
    p.dashingUntil = now + DASH_TIME_MS;
  }

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
    if (len > 0.001) {
      p.aimX = ax / len;
      p.aimY = ay / len;
    }

    const n = len || 1;
    p.vx = ax / n;
    p.vy = ay / n;

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
        pickupPart(p, part, now);
      }
    }

    // combat vs enemies
    for (const e of state.enemies) {
      if (dist2(p.x, p.y, e.x, e.y) <= HIT_RANGE * HIT_RANGE) {
        applyDamage(p, e, now);
        applyDamage(e, p, now);
      }
    }

    // combat vs boss
    if (state.boss && dist2(p.x, p.y, state.boss.x, state.boss.y) <= (HIT_RANGE + 14) ** 2) {
      applyDamage(p, state.boss, now);
      applyDamage(state.boss, p, now);
    }

    // PvP vs bot
    if (state.botPlayer && dist2(p.x, p.y, state.botPlayer.x, state.botPlayer.y) <= HIT_RANGE * HIT_RANGE) {
      applyDamage(p, state.botPlayer, now);
      applyDamage(state.botPlayer, p, now);
    }

    updateCamera();
  }

  // ---------------------------
  // Bot player (fake multiplayer) — includes unstuck logic
  // ---------------------------
  function updateBotPlayer(dt, now) {
    const b = state.botPlayer;
    if (!b) return;

    // If stuck, run escape steer
    if (now < b.escapeUntil) {
      b.vx = b.escapeX;
      b.vy = b.escapeY;
    } else {
      // choose target: nearest part, else boss, else nearest enemy, else drift near player
      let target = null;
      let best = Infinity;

      for (const part of state.partsOnField) {
        if (part.kind === "score") continue; // bot can still pick it up later; no need to prioritize
        const d = dist2(b.x, b.y, part.x, part.y);
        if (d < best) { best = d; target = part; }
      }

      let tx, ty;
      if (target) {
        tx = target.x; ty = target.y;
      } else if (state.boss) {
        tx = state.boss.x; ty = state.boss.y;
      } else {
        let foe = null;
        let foeD = Infinity;
        for (const e of state.enemies) {
          const d = dist2(b.x, b.y, e.x, e.y);
          if (d < foeD) { foeD = d; foe = e; }
        }
        if (foe) { tx = foe.x; ty = foe.y; }
        else { tx = state.player.x + rand(-140, 140); ty = state.player.y + rand(-140, 140); }
      }

      let dx = tx - b.x;
      let dy = ty - b.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;

      b.vx = dx;
      b.vy = dy;

      b.aimX = dx;
      b.aimY = dy;
    }

    const preX = b.x, preY = b.y;
    moveEntity(b, dt, BASE_SPEED * 0.92);
    b.rot += dt * 1.7;

    // Stuck detection (if barely moved while trying to move)
    const moved = Math.hypot(b.x - preX, b.y - preY);
    const trying = Math.hypot(b.vx, b.vy) > 0.2;

    if (trying && moved < BOT_STUCK_DIST_EPS) b.stuckFrames++;
    else b.stuckFrames = 0;

    if (b.stuckFrames >= BOT_STUCK_FRAMES) {
      // Escape: turn ~90deg and go
      b.stuckFrames = 0;
      const turn = Math.random() < 0.5 ? 1 : -1;
      const ex = -b.vy * turn;
      const ey = b.vx * turn;
      const mag = Math.hypot(ex, ey) || 1;
      b.escapeX = ex / mag;
      b.escapeY = ey / mag;
      b.escapeUntil = now + BOT_ESCAPE_MS;
    }

    regenTick(b, dt);

    // pickups
    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const part = state.partsOnField[i];
      const rr = b.r + part.r + 4;
      if (dist2(b.x, b.y, part.x, part.y) <= rr * rr) {
        state.partsOnField.splice(i, 1);
        pickupPart(b, part, now);
      }
    }

    // bot wave usage (occasionally)
    if (b.wave > 0 && Math.random() < 0.012) tryWave(b, now);

    // combat vs enemies
    for (const e of state.enemies) {
      if (dist2(b.x, b.y, e.x, e.y) <= HIT_RANGE * HIT_RANGE) {
        applyDamage(b, e, now);
        applyDamage(e, b, now);
      }
    }

    // boss
    if (state.boss && dist2(b.x, b.y, state.boss.x, state.boss.y) <= (HIT_RANGE + 14) ** 2) {
      applyDamage(b, state.boss, now);
      applyDamage(state.boss, b, now);
    }

    // PvP
    if (dist2(b.x, b.y, state.player.x, state.player.y) <= HIT_RANGE * HIT_RANGE) {
      applyDamage(b, state.player, now);
      applyDamage(state.player, b, now);
    }
  }

  // ---------------------------
  // Enemy AI
  // ---------------------------
  function updateEnemyAI(e, dt, now) {
    if (now > e.retargetAt) {
      e.retargetAt = now + rand(650, 1200);

      // chase closer of player/bot
      const dp = dist2(e.x, e.y, state.player.x, state.player.y);
      const db = state.botPlayer ? dist2(e.x, e.y, state.botPlayer.x, state.botPlayer.y) : Infinity;
      const chase = (db < dp) ? state.botPlayer : state.player;

      e.targetX = chase.x + rand(-160, 160);
      e.targetY = chase.y + rand(-160, 160);
    }

    let best = null;
    let bestD2 = Infinity;
    for (const p of state.partsOnField) {
      if (p.kind === "score") continue;
      const d2 = dist2(e.x, e.y, p.x, p.y);
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    const partBias = e.type === "brute" ? 0.55 : 1.0;
    if (best && bestD2 < (260 * 260) * partBias) {
      e.targetX = best.x;
      e.targetY = best.y;
    }

    let dx = e.targetX - e.x;
    let dy = e.targetY - e.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;

    e.vx = dx;
    e.vy = dy;

    let speedMul = 0.9;
    if (e.type === "skitter") speedMul = 1.15;
    if (e.type === "brute") speedMul = 0.75;

    const speed = (BASE_SPEED * 0.86 * speedMul) + (e.edges - 4) * 2.8;
    moveEntity(e, dt, speed);
    e.rot += dt * (1.6 + (e.edges - 4) * 0.05);

    // pickups
    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const part = state.partsOnField[i];
      const rr = e.r + part.r + 2;
      if (dist2(e.x, e.y, part.x, part.y) <= rr * rr) {
        state.partsOnField.splice(i, 1);
        if (part.kind === "edge") {
          if (Math.random() < 0.40) {
            const prev = e.edges;
            e.edges = clamp(e.edges + 1, 3, EDGE_CAP);
            if (e.edges !== prev) {
              const s = computeStats(e.edges);
              e.atk = s.atk;
              e.def = s.def;
              e.maxHp = s.maxHp;
            }
          }
        } else if (part.kind === "regen") {
          e.hp = clamp(e.hp + Math.round(e.maxHp * 0.20), 0, e.maxHp);
        } else {
          e.hp = clamp(e.hp + Math.round(e.maxHp * 0.10), 0, e.maxHp);
        }
      }
    }
  }

  function updateBoss(dt, now) {
    const b = state.boss;
    if (!b) return;

    const dp = dist2(b.x, b.y, state.player.x, state.player.y);
    const db = state.botPlayer ? dist2(b.x, b.y, state.botPlayer.x, state.botPlayer.y) : Infinity;
    const chase = (db < dp) ? state.botPlayer : state.player;

    let dx = chase.x - b.x;
    let dy = chase.y - b.y;
    const len = Math.hypot(dx, dy) || 1;
    b.vx = dx / len;
    b.vy = dy / len;

    moveEntity(b, dt, BASE_SPEED * 0.78);
    b.rot += dt * 1.2;
  }

  // ---------------------------
  // Camera
  // ---------------------------
  function updateCamera() {
    const { w, h } = viewSize();
    const p = state.player;
    state.camX = clamp(p.x - w / 2, 0, WORLD_W - w);
    state.camY = clamp(p.y - h / 2, 0, WORLD_H - h);
  }

  function worldToScreen(x, y) {
    return { x: x - state.camX, y: y - state.camY };
  }

  // ---------------------------
  // Boss scheduling
  // ---------------------------
  function scheduleNextBoss(now) {
    state.nextBossAt = now + rand(BOSS_MIN_SPAWN_MS, BOSS_MAX_SPAWN_MS);
  }

  function maybeSpawnBoss(now) {
    if (state.boss) return;
    if (now < state.nextBossAt) return;
    state.boss = makeBoss();
    state.message = "A BOSS has appeared!";
    state.messageUntil = now + 1600;
    scheduleNextBoss(now);
  }

  // ---------------------------
  // Rendering
  // ---------------------------
  function drawBackground() {
    const { w, h } = viewSize();

    const g = ctx.createRadialGradient(w * 0.45, h * 0.2, 80, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(126,231,255,0.07)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;

    const step = 56;
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

    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    const tl = worldToScreen(0, 0);
    ctx.strokeRect(tl.x, tl.y, WORLD_W, WORLD_H);
    ctx.restore();
  }

  function render(now) {
    const { w, h } = viewSize();
    ctx.clearRect(0, 0, w, h);
    drawBackground();

    // obstacles
    for (const o of state.obstacles) {
      const s = worldToScreen(o.x, o.y);
      if (s.x > w + 40 || s.y > h + 40 || s.x + o.w < -40 || s.y + o.h < -40) continue;

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 2;
      roundRect(s.x, s.y, o.w, o.h, 14);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // parts (including score orbs)
    const nowMs = now;
    for (let i = state.partsOnField.length - 1; i >= 0; i--) {
      const p = state.partsOnField[i];

      // expire score orbs
      if (p.kind === "score" && nowMs - p.born > SCORE_ORB_LIFETIME_MS) {
        state.partsOnField.splice(i, 1);
        continue;
      }

      const s = worldToScreen(p.x, p.y);
      if (s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > h + 40) continue;

      ctx.beginPath();
      ctx.arc(s.x, s.y, p.r, 0, Math.PI * 2);

      if (p.kind === "regen") ctx.fillStyle = "rgba(126,231,255,0.90)";
      else if (p.kind === "wave") ctx.fillStyle = "rgba(178,107,255,0.92)";
      else if (p.kind === "score") ctx.fillStyle = "rgba(255,215,110,0.92)";
      else ctx.fillStyle = "rgba(166,255,126,0.90)";

      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.stroke();

      if (p.kind === "score") {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.font = "700 10px system-ui, sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(String(p.value || 0), s.x - 6, s.y + 4);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fill();
      }
    }

    // wave projectiles
    for (const pr of state.projectiles) {
      const s = worldToScreen(pr.x, pr.y);
      const ex = pr.x + pr.dx * pr.len;
      const ey = pr.y + pr.dy * pr.len;
      const se = worldToScreen(ex, ey);

      ctx.save();
      ctx.strokeStyle = "rgba(178,107,255,0.85)";
      ctx.lineWidth = pr.w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(se.x, se.y);
      ctx.stroke();
      ctx.restore();
    }

    // enemies
    for (const e of state.enemies) {
      const s = worldToScreen(e.x, e.y);
      if (s.x < -90 || s.y < -90 || s.x > w + 90 || s.y > h + 90) continue;

      const fill =
        e.type === "brute" ? "rgba(255,190,126,0.28)" :
        e.type === "skitter" ? "rgba(255,126,220,0.26)" :
                               "rgba(255,126,166,0.30)";

      const stroke =
        e.type === "brute" ? "rgba(255,190,126,0.95)" :
        e.type === "skitter" ? "rgba(255,126,220,0.95)" :
                               "rgba(255,126,166,0.95)";

      drawPolygon(s.x, s.y, e.r, e.edges, e.rot, fill, stroke);
      drawHealthBar(s.x - 18, s.y - e.r - 12, 36, 5, e.hp, e.maxHp);
    }

    // boss
    if (state.boss) {
      const b = state.boss;
      const s = worldToScreen(b.x, b.y);
      drawPolygon(s.x, s.y, b.r, b.edges, b.rot, "rgba(255,80,80,0.20)", "rgba(255,80,80,0.95)");
      drawHealthBar(s.x - 32, s.y - b.r - 14, 64, 7, b.hp, b.maxHp);

      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.font = "800 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,120,120,0.95)";
      ctx.fillText("BOSS", s.x - 18, s.y + b.r + 24);
      ctx.restore();
    }

    // fighters (bot behind player for clarity)
    drawFighter(state.botPlayer, now);
    drawFighter(state.player, now);

    // floating texts
    for (let i = state.floatText.length - 1; i >= 0; i--) {
      const ft = state.floatText[i];
      const age = nowMs - ft.born;
      if (age > ft.life) { state.floatText.splice(i, 1); continue; }

      ft.y += (ft.vy * (1 / 60));
      const s = worldToScreen(ft.x, ft.y);

      const a = 1 - (age / ft.life);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = "800 14px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(ft.text, s.x - 10, s.y);
      ctx.restore();
    }

    // toast
    if (state.message && nowMs < state.messageUntil) {
      ctx.save();
      ctx.font = "700 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const text = state.message;
      const padX = 12;
      const metrics = ctx.measureText(text);
      const bx = w * 0.5;
      const by = 34;
      const bw = metrics.width + padX * 2;
      const bh = 28;

      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      roundRect(bx - bw / 2, by - bh / 2, bw, bh, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(text, bx, by);
      ctx.restore();
    }
  }

  function drawFighter(p, now) {
    if (!p) return;
    const s = worldToScreen(p.x, p.y);

    // plasma blades
    if (p.plasma > 0) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      const blades = Math.min(PLASMA_MAX, p.plasma);
      const orbitR = p.r + 12;
      for (let i = 0; i < blades; i++) {
        const a = now * 0.0022 + (i * Math.PI * 2) / blades;
        const bx = s.x + Math.cos(a) * orbitR;
        const by = s.y + Math.sin(a) * orbitR;
        const rot = a + Math.PI / 2;

        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(rot) * 10, by + Math.sin(rot) * 10);
        ctx.lineTo(bx + Math.cos(rot + 2.4) * 7, by + Math.sin(rot + 2.4) * 7);
        ctx.lineTo(bx + Math.cos(rot - 2.4) * 7, by + Math.sin(rot - 2.4) * 7);
        ctx.closePath();

        ctx.fillStyle = "rgba(180,255,255,0.38)";
        ctx.fill();
        ctx.strokeStyle = "rgba(126,231,255,0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }

    const fill = p.tint === "bot" ? "rgba(255,255,255,0.14)" : "rgba(126,231,255,0.35)";
    const stroke = p.tint === "bot" ? "rgba(255,255,255,0.65)" : "rgba(126,231,255,0.95)";

    drawPolygon(s.x, s.y, p.r, p.edges, p.rot, fill, stroke);
    drawHealthBar(s.x - 22, s.y - p.r - 14, 44, 6, p.hp, p.maxHp);

    // SCORE HOVER (requested): show above fighter
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.font = "800 13px system-ui, sans-serif";
    ctx.fillStyle = p.tint === "bot" ? "rgba(255,255,255,0.85)" : "rgba(255,215,110,0.95)";
    ctx.fillText(String(p.score), s.x - 10, s.y - p.r - 26);
    ctx.restore();
  }

  // ---------------------------
  // HUD
  // ---------------------------
  function updateHUD() {
    const p = state.player;
    elEdges.textContent = String(p.edges);
    elAtk.textContent = String(p.atk);
    elDef.textContent = String(p.def);
    elPlasma.textContent = String(p.plasma);
    elWave.textContent = String(p.wave);
    elHp.textContent = String(Math.round(p.hp));
    elKos.textContent = String(state.kos);
    elParts.textContent = String(p.parts);
    elBot.textContent = state.botPlayer ? "Alive" : "None";
  }

  // ---------------------------
  // Reset
  // ---------------------------
  function resetGame() {
    resizeCanvas();

    state.partsOnField = [];
    state.projectiles = [];
    state.floatText = [];
    buildObstacles();

    state.enemies = Array.from({ length: ENEMY_COUNT }, (_, i) => makeEnemy(i));
    state.player = makePlayer();
    state.botPlayer = makeBotPlayer();
    recomputeFighterStats(state.player);
    recomputeFighterStats(state.botPlayer);

    state.kos = 0;
    state.nextPartAt = performance.now() + 250;

    state.boss = null;
    scheduleNextBoss(performance.now());

    state.message = "WASD/Arrows • Space dash • E wave • PvP drops score orbs";
    state.messageUntil = performance.now() + 3200;

    hideOverlay();
    paused = false;
    btnPause.textContent = "Pause";
    updateHUD();
  }

  // ---------------------------
  // Main loop
  // ---------------------------
  function tick(now) {
    if (paused) return;

    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;

    if (now > state.nextPartAt) {
      state.nextPartAt = now + PART_SPAWN_INTERVAL_MS;
      if (state.partsOnField.length < PART_MAX_ON_FIELD) spawnPart();
    }

    maybeSpawnBoss(now);

    updatePlayer(dt, now);
    updateBotPlayer(dt, now);

    for (const e of state.enemies) updateEnemyAI(e, dt, now);
    updateBoss(dt, now);

    updateProjectiles(dt, now);

    // rotate fighters a bit for life
    state.player.rot += dt * 0.0;
    if (state.botPlayer) state.botPlayer.rot += dt * 0.0;

    updateHUD();
    render(now);

    requestAnimationFrame(tick);
  }

  // ---------------------------
  // Start
  // ---------------------------
  resetGame();
  setPaused(false);
})();

// hop.js —— 跳跃拾金：30 关关卡制像素横版平台跳跃（第三个独立游戏）
//
// 跟另外两个游戏的边界：弹珠解谜 = 确定性解谜；无尽冲刺 = 无尽刷分；跳跃拾金 = 有终点的关卡。
// 三个游戏各自一套状态机，只共用画布、音效和统一金库 B.U.coins()。
//
// 关卡结构（这是「决策密度」的来源）：
//   每关由若干「分叉段」拼成，每段同时给两条路，段末汇合到同一块平台：
//     上路 = 两块浮空高台，金币多（6 枚），要连跳、高关有巡逻怪，风险高
//     下路 = 地面长平台，金币少（3 枚），高关有小坑或尖刺，稳定
//   玩家靠跳不跳来选路，选错可以掉回下路继续，不会被卡死。
//   走到终点旗 = 通关；三星 = 通关 / 金币 ≥70% / 一条命没掉。关卡全部开放，不解锁。
//
// 公平性红线：所有坑宽 ≤ MAX_GAP(150)、高台上升 ≤ MAX_RISE(90)，都远小于理论跳距 252 / 跳高 148。
//   关卡用固定种子一次生成完（不是边跑边生成），所以布局可记忆、可复现、第二次玩能做得更好。
//   生成违规记在 st.genBad，测试断言 30 关恒为 0。
//
// 经济：本关金币 + 星级奖励在通关 / 阵亡 / 重来 / 退大厅时一次性进合集统一金库，只记一次。
var B = window.B = window.B || {};

B.Hop = (function () {
  var U = B.U;

  // 世界尺寸跟随 B.C：Game.startHop() 会把 C.W/C.H 换成 1100×620 的横屏视野再调 resize()。
  var W = 1100, H = 620;
  function syncWH() { W = B.C.W; H = B.C.H; }

  // ---------- 物理常量（单位 px / s）----------
  var GRAV = 2100, JUMP_V = 790, RUN_V = 335;
  var ACC_GROUND = 3000, ACC_AIR = 2100, FRICTION = 2600, MAX_FALL = 1200;
  var COYOTE = 0.10, JBUF = 0.12;
  var PW = 32, PH = 46, PLAT_H = 40;
  // 滞空 0.752s / 最高 148.6px / 满速跳距 252px；生成上限只取六成，留足余量。
  var MAX_GAP = 150, MAX_RISE = 90;
  var JUMP_HIGH = JUMP_V * JUMP_V / (2 * GRAV);   // 148.6px，生成时用来校验高台够得着

  var LEVEL_COUNT = 30;
  var SEG_W = 560;                        // 每个分叉段的宽度
  function segmentsOf(n) { return 5 + Math.floor((n - 1) / 4); }   // 1 关 5 段 → 30 关 12 段
  function seedOf(n) { return (n * 7919 + 12345) >>> 0; }

  function sfx(n) { if (B.A && B.A.play) B.A.play(n); }

  // ---------- 永久强化 + 关卡星级存档 ----------
  var UP = [
    { id: 'boots', name: '弹跳', icon: '⤴', max: 3, desc: '每级跳高 +6%，够得到更高的金币', cost: [110, 280, 680] },
    { id: 'heart', name: '生命', icon: '♥', max: 2, desc: '每局开局 +1 条命（默认 3 条）', cost: [140, 360] },
    { id: 'magnet', name: '磁石', icon: '◎', max: 3, desc: '金币吸附范围每级 +24', cost: [90, 230, 580] },
    { id: 'shield', name: '护盾', icon: '⬡', max: 3, desc: '每局开局带一层护盾，挡一次伤害', cost: [150, 380, 880] }
  ];
  var UPKEY = 'bounce.hopup', STARKEY = 'bounce.hopstars', LASTKEY = 'bounce.hoplast';

  function upDef(id) { for (var i = 0; i < UP.length; i++) if (UP[i].id === id) return UP[i]; return null; }
  function loadUp() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(UPKEY) || '{}') || {}; } catch (e) { o = {}; }
    var r = {}; for (var i = 0; i < UP.length; i++) r[UP[i].id] = o[UP[i].id] || 0; return r;
  }
  function saveUp(u) { try { localStorage.setItem(UPKEY, JSON.stringify(u)); } catch (e) { } }
  function loadStars() {
    try { return JSON.parse(localStorage.getItem(STARKEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function starsOf(n) { var s = loadStars(); return s[n] || 0; }
  function totalStars() { var s = loadStars(), t = 0; for (var k in s) if (s.hasOwnProperty(k)) t += s[k] || 0; return t; }
  function saveStars(n, v) {
    var s = loadStars();
    if ((s[n] || 0) < v) { s[n] = v; try { localStorage.setItem(STARKEY, JSON.stringify(s)); } catch (e) { } }
  }
  function lastLevel() { try { return U.clamp(parseInt(localStorage.getItem(LASTKEY) || '1', 10) || 1, 1, LEVEL_COUNT); } catch (e) { return 1; } }
  function saveLast(n) { try { localStorage.setItem(LASTKEY, String(n)); } catch (e) { } }

  function costOf(id) {
    var d = upDef(id); if (!d) return Infinity;
    var l = loadUp()[id] || 0;
    return l >= d.max ? Infinity : d.cost[l];
  }
  function canBuy(id) { var c = costOf(id); return c !== Infinity && B.U.coins() >= c; }
  function buy(id) {
    var c = costOf(id); if (c === Infinity) return false;
    if (!B.U.spendCoins(c)) return false;
    var u = loadUp(); u[id] = (u[id] || 0) + 1; saveUp(u);
    return true;
  }

  var st = null;
  var endHook = null;                   // 通关 / 阵亡时通知 UI 弹结算页

  function px(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  // ---------- 关卡生成：一次性固定布局 ----------
  function addPlat(x, y, w, kind) { st.plats.push({ x: x, y: y, w: w, h: PLAT_H, kind: kind }); }
  function addCoins(x, y, w, n, avoid) {
    for (var i = 0; i < n; i++) {
      var cx = x + w * (i + 1) / (n + 1);
      var bad = false;
      for (var j = 0; j < avoid.length; j++) if (Math.abs(cx - avoid[j]) < 42) bad = true;
      if (bad) continue;
      st.coins.push({ x: cx, y: y - 52, got: false, ph: st.coins.length * 0.83 });
      st.coinsTotal++;
    }
  }

  function buildLevel(n) {
    var rng = U.rng(seedOf(n));
    var diff = (n - 1) / (LEVEL_COUNT - 1);
    var segs = segmentsOf(n);
    var groundY = H - 150;
    st.plats = []; st.coins = []; st.foes = []; st.spikes = [];
    st.trees = []; st.flags = []; st.signs = []; st.pops = [];
    st.coinsTotal = 0;

    addPlat(0, groundY, 520, 'start');           // 起跑台：又长又平，先熟悉操作
    addCoins(140, groundY, 300, 2, []);

    var x0 = 520;
    for (var s = 0; s < segs; s++) {
      // 下路：两段地面，中间按难度开一个必定跳得过去的小坑
      var gap = (rng() < 0.15 + 0.5 * diff) ? 60 + rng() * (MAX_GAP - 60) : 0;
      var l2x = x0 + 150 + gap, l2w = 250 - gap;
      addPlat(x0, groundY, 150, 'low');
      addPlat(l2x, groundY, l2w, 'low');

      var avoidLow = [];
      if (n >= 6 && l2w > 150 && rng() < 0.10 + 0.40 * diff) {
        var sx = l2x + 40 + rng() * Math.max(1, l2w - 100);
        st.spikes.push({ x: sx, y: groundY - 17, w: 30, h: 17 });
        avoidLow.push(sx + 15);
      }
      addCoins(x0, groundY, 150, 1, []);
      addCoins(l2x, groundY, l2w, 2, avoidLow);

      // 上路：两块浮空高台，落差与间隔都远在跳跃能力内，金币翻倍
      var h1y = groundY - 92, h2y = groundY - 118;
      addPlat(x0 + 40, h1y, 170, 'high');
      addPlat(x0 + 280, h2y, 170, 'high');
      var avoidHigh = [];
      if (n >= 12 && rng() < 0.08 + 0.40 * diff) {
        st.foes.push({
          x: x0 + 330, y: h2y - 30, w: 34, h: 30,
          vx: (rng() < 0.5 ? -1 : 1) * (52 + 30 * diff),
          lo: x0 + 282, hi: x0 + 414, alive: true, t: rng() * 6
        });
        avoidHigh.push(x0 + 347);
      }
      addCoins(x0 + 40, h1y, 170, 3, []);
      addCoins(x0 + 280, h2y, 170, 3, avoidHigh);

      // 段末汇合平台：两条路都落回这里
      addPlat(x0 + 420, groundY, 140, 'merge');
      addCoins(x0 + 420, groundY, 140, 1, []);

      // 分叉路标：金色 ↑ 指上路（金币多），白色 → 指下路（稳）。不用文字，一眼能懂。
      st.signs.push({ x: x0 + 40, y: h1y - 34, up: true });
      st.signs.push({ x: x0 + 20, y: groundY - 34, up: false });
      if (rng() < 0.7) st.trees.push({ x: x0 + 470 + rng() * 60, y: groundY, s: 0.8 + rng() * 0.5 });

      // 硬约束被破坏就记账（30 关恒为 0，测试会逐关断言）
      if (gap > MAX_GAP + 0.5) st.genBad++;                        // 下路小坑跳得过
      if (l2w < 100 || (groundY - h2y) > JUMP_HIGH) st.genBad++;   // 下路落脚点够宽、高台够得着
      if ((x0 + 280) - (x0 + 40 + 170) > MAX_GAP) st.genBad++;     // 高台之间
      if ((x0 + 420) - (x0 + 400) > MAX_GAP) st.genBad++;          // 下路 → 汇合
      if ((groundY - h1y) > JUMP_HIGH) st.genBad++;                 // 地面 → 第一块高台
      if (s > 0 && x0 - (x0 - SEG_W + 420 + 140) > MAX_GAP) st.genBad++;  // 上一汇合 → 本段下路
      x0 += SEG_W;
    }

    // 终点：一段宽平台 + 旗子，跑过旗子就通关
    addPlat(x0, groundY, 320, 'goal');
    addCoins(x0 + 30, groundY, 80, 2, []);
    st.flags.push({ x: x0 + 130, y: groundY, label: '终点' });
    st.goalX = x0 + 130;
    st.segCount = segs;
  }

  // ---------- 开始 / 重来 / 下一关 ----------
  function start(n) {
    syncWH();
    n = U.clamp(n | 0 || 1, 1, LEVEL_COUNT);
    var up = loadUp(), groundY = H - 150;
    st = {
      level: n, t: 0, camX: 0, startX: 60,
      dir: 0, jumpBuf: 0, jumpHeld: false,
      p: { x: 90, y: groundY - PH, vx: 0, vy: 0, grounded: true, coyote: COYOTE, face: 1, anim: 0 },
      plats: [], coins: [], foes: [], spikes: [], trees: [], flags: [], signs: [], pops: [],
      coinsTotal: 0, goalX: 0, segCount: 0,
      lives: 3 + (up.heart || 0), maxLives: 3 + (up.heart || 0),
      shield: up.shield || 0, invuln: 0,
      jumpMul: 1 + 0.06 * (up.boots || 0), magnetR: 24 + 24 * (up.magnet || 0),
      coinsGot: 0, bankedTotal: 0, stars: 0,
      dead: false, won: false, banked: false, shake: 0,
      genBad: 0, falls: 0, hits: 0, picked: 0, stomped: 0
    };
    buildLevel(n);
    saveLast(n);
    return st;
  }
  // 兼容旧调用：reset(seed) 现在等价于 start(level)
  function reset(n) { return start(n || 1); }
  function init() { start(lastLevel()); }

  // 本关结算（只记一次）。通关额外给星级奖励，阵亡不丢已吃到的金币。
  function cashOut() {
    if (!st || st.banked) return 0;
    st.banked = true;
    var total = st.coinsGot + (st.won ? st.stars * 10 : 0);
    if (total > 0) B.U.addCoins(total);
    st.bankedTotal = total;
    return total;
  }
  function restart() { cashOut(); start(st ? st.level : 1); }
  function nextLevel() { cashOut(); start(Math.min(LEVEL_COUNT, (st ? st.level : 1) + 1)); }

  // ---------- 输入 ----------
  function setDir(d) { if (st && !st.dead && !st.won) st.dir = d < 0 ? -1 : (d > 0 ? 1 : 0); }
  function jump() { if (st && !st.dead && !st.won) st.jumpBuf = JBUF; }
  function releaseJump() { if (st && !st.dead && !st.won && st.p.vy < -140) st.p.vy *= 0.5; }
  function setJumpHeld(b) { if (!st) return; st.jumpHeld = !!b; if (!b) releaseJump(); }

  // ---------- 碰撞 ----------
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function landOnPlats(p, prevBottom) {
    p.grounded = false;
    if (p.vy < 0) return;
    for (var i = 0; i < st.plats.length; i++) {
      var q = st.plats[i];
      if (p.x + PW <= q.x || p.x >= q.x + q.w) continue;
      var bottom = p.y + PH;
      if (prevBottom <= q.y + 10 && bottom >= q.y && p.y < q.y + 12) {
        p.y = q.y - PH; p.vy = 0; p.grounded = true; p.coyote = COYOTE;
      }
    }
  }
  function pop(x, y, txt, col) { st.pops.push({ x: x, y: y, txt: txt, col: col, life: 0.78 }); }

  function loseLife() {
    if (st.dead || st.won) return;
    if (st.shield > 0) { st.shield--; st.invuln = 1.1; st.shake = 0.18; sfx('brk'); return; }
    st.lives--; st.invuln = 1.4; st.shake = 0.34; sfx('lose');
    if (st.lives <= 0) die();
  }
  function hit(force) {
    if (st.dead || st.won || (!force && st.invuln > 0)) return;
    loseLife();
    if (!st.dead) respawn();
  }
  function respawn() {
    var p = st.p, target = Math.max(st.camX + W * 0.28, p.x - 120), best = null;
    for (var i = 0; i < st.plats.length; i++) {
      var q = st.plats[i];
      if (q.kind === 'high' || q.x + q.w < target) continue;   // 掉下来一律回地面路，不回高台
      if (!best || q.x < best.x) best = q;
    }
    if (!best) best = { x: st.camX + W * 0.28, y: H - 150, w: 220, h: PLAT_H, kind: 'low' };
    var minX = st.camX + 12;
    var maxX = Math.max(minX, best.x + best.w - PW - 12);
    p.x = U.clamp(best.x + 30, minX, maxX);
    p.y = best.y - PH - 2;
    p.vx = 0; p.vy = 0; p.grounded = true; p.coyote = COYOTE;
    st.jumpBuf = 0;
  }
  function finish(won) {
    if (st.dead || st.won) return;
    if (won) {
      st.won = true;
      st.stars = 1;
      if (st.coinsTotal > 0 && st.coinsGot >= Math.ceil(st.coinsTotal * 0.7)) st.stars++;
      if (st.lives >= st.maxLives) st.stars++;
      saveStars(st.level, st.stars);
      sfx('buy');
    } else { st.dead = true; sfx('lose'); }
    cashOut();
    if (endHook) endHook({
      won: won, level: st.level, stars: st.stars, coins: st.bankedTotal,
      picked: st.coinsGot, total: st.coinsTotal, lives: st.lives, maxLives: st.maxLives
    });
  }
  function die() { finish(false); }

  // ---------- 每帧 ----------
  function update(dt) {
    if (!st) return;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    st.t += dt;
    for (var pi = st.pops.length - 1; pi >= 0; pi--) {
      var pp = st.pops[pi]; pp.life -= dt; pp.y -= 46 * dt;
      if (pp.life <= 0) st.pops.splice(pi, 1);
    }
    if (st.dead || st.won) return;
    syncWH();

    var p = st.p;
    if (st.invuln > 0) st.invuln -= dt;
    if (st.shake > 0) st.shake -= dt;

    var tv = st.dir * RUN_V, acc = p.grounded ? ACC_GROUND : ACC_AIR;
    if (st.dir !== 0) {
      if (p.vx < tv) p.vx = Math.min(tv, p.vx + acc * dt);
      else if (p.vx > tv) p.vx = Math.max(tv, p.vx - acc * dt);
      p.face = st.dir;
    } else {
      if (p.vx > 0) p.vx = Math.max(0, p.vx - FRICTION * dt);
      else if (p.vx < 0) p.vx = Math.min(0, p.vx + FRICTION * dt);
    }
    p.x += p.vx * dt;
    if (p.x < st.camX + 8) { p.x = st.camX + 8; if (p.vx < 0) p.vx = 0; }

    if (st.jumpBuf > 0) st.jumpBuf -= dt;
    if (p.coyote > 0) p.coyote -= dt;
    if ((p.grounded || p.coyote > 0) && st.jumpBuf > 0) {
      p.vy = -JUMP_V * st.jumpMul;
      p.grounded = false; p.coyote = 0; st.jumpBuf = 0;
      sfx('bumper');
    }
    p.vy = Math.min(MAX_FALL, p.vy + GRAV * dt);
    var prevBottom = p.y + PH;
    p.y += p.vy * dt;
    landOnPlats(p, prevBottom);
    if (p.grounded) p.coyote = COYOTE;
    p.anim += Math.abs(p.vx) * dt * 0.05;

    var target = p.x - W * 0.34;
    if (target > st.camX) st.camX = target;

    // 金币：磁石吸附 + 接触拾取
    var pcx = p.x + PW / 2, pcy = p.y + PH / 2, mr2 = st.magnetR * st.magnetR;
    for (var ci = 0; ci < st.coins.length; ci++) {
      var c = st.coins[ci];
      if (c.got) continue;
      var dx = pcx - c.x, dy = pcy - c.y, d2 = dx * dx + dy * dy;
      if (d2 < mr2) { c.x += dx * dt * 7; c.y += dy * dt * 7; }
      if (Math.abs(pcx - c.x) < 22 && Math.abs(pcy - c.y) < 30) {
        c.got = true; st.coinsGot++; st.picked++;
        pop(c.x, c.y - 12, '◈ +1', '#ffd04a'); sfx('coin');
      }
    }

    // 巡逻怪：踩头消灭 +3，侧面撞掉命
    for (var fi = 0; fi < st.foes.length; fi++) {
      var f = st.foes[fi];
      if (!f.alive) continue;
      f.t += dt; f.x += f.vx * dt;
      if (f.x < f.lo) { f.x = f.lo; f.vx = -f.vx; }
      if (f.x > f.hi) { f.x = f.hi; f.vx = -f.vx; }
      if (overlaps({ x: p.x, y: p.y, w: PW, h: PH }, f)) {
        if (p.vy > 0 && prevBottom <= f.y + 16) {
          f.alive = false; p.vy = -430; st.coinsGot += 3; st.stomped++;
          pop(f.x + 17, f.y - 10, '◈ +3', '#8dffb0'); sfx('brk');
        } else { st.hits++; hit(false); }
      }
    }
    for (var si = 0; si < st.spikes.length; si++) {
      if (overlaps({ x: p.x, y: p.y, w: PW, h: PH }, st.spikes[si])) { st.hits++; hit(false); break; }
    }
    if (st.dead || st.won) return;

    if (p.y > H + 60) {
      st.falls++;
      if (st.invuln <= 0) loseLife();
      if (!st.dead) respawn();
    }
    // 必须人还在地面附近才算走到旗子，掉进坑里飘过旗子的 x 不算过关
    if (p.x + PW / 2 >= st.goalX && p.y + PH <= st.flags[0].y + 90) finish(true);
  }

  // ---------- 绘制 ----------
  function drawCloud(ctx, x, y, s) {
    px(ctx, x, y + 10 * s, 74 * s, 16 * s, '#ffffff');
    px(ctx, x + 12 * s, y, 34 * s, 16 * s, '#ffffff');
    px(ctx, x + 34 * s, y - 8 * s, 24 * s, 18 * s, '#ffffff');
    px(ctx, x + 4 * s, y + 20 * s, 82 * s, 5 * s, 'rgba(255,255,255,.62)');
  }
  function drawHill(ctx, x, base, w, h, c) {
    ctx.fillStyle = c; ctx.beginPath();
    ctx.moveTo(x - w / 2, base); ctx.lineTo(x, base - h); ctx.lineTo(x + w / 2, base); ctx.closePath(); ctx.fill();
  }
  function drawTree(ctx, d) {
    var s = d.s, x = d.x, y = d.y;
    px(ctx, x - 6 * s, y - 62 * s, 12 * s, 62 * s, '#6d4324');
    px(ctx, x - 9 * s, y - 62 * s, 18 * s, 8 * s, '#54321b');
    px(ctx, x - 32 * s, y - 100 * s, 64 * s, 42 * s, '#2c8b3c');
    px(ctx, x - 24 * s, y - 116 * s, 48 * s, 26 * s, '#3bab48');
    px(ctx, x - 16 * s, y - 108 * s, 12 * s, 10 * s, '#63cf5a');
    px(ctx, x + 8 * s, y - 94 * s, 10 * s, 9 * s, '#228034');
  }
  function drawPlat(ctx, q) {
    px(ctx, q.x, q.y, q.w, 9, q.kind === 'high' ? '#8ee06a' : '#59c94a');
    px(ctx, q.x, q.y + 9, q.w, 4, '#2d8a31');
    px(ctx, q.x, q.y + 13, q.w, q.h - 13, '#8a5a2b');
    px(ctx, q.x, q.y + q.h - 4, q.w, 4, '#5e3a1c');
    var step = 26, start = Math.floor(q.x / step) * step;
    for (var x = start; x < q.x + q.w; x += step) {
      var xx = Math.max(x, q.x), ww = Math.min(x + step, q.x + q.w) - xx;
      if (ww <= 8) continue;
      var k = (Math.floor(x / step) * 7) % 3;
      px(ctx, xx + 5, q.y + 19, ww - 10, 5, k === 0 ? '#a5703a' : '#74481f');
      px(ctx, xx + 3, q.y + 30, ww - 6, 3, '#6a3f1f');
    }
    for (var g = q.x + 12; g < q.x + q.w - 6; g += 46) {
      px(ctx, g, q.y - 5, 3, 5, '#4dbb42');
      px(ctx, g + 7, q.y - 3, 2, 3, '#6fdc55');
    }
  }
  function drawCoin(ctx, c, t) {
    var w = 5 + 14 * Math.abs(Math.cos(t * 3.1 + c.ph));
    ctx.save();
    ctx.shadowColor = 'rgba(255,196,48,.85)'; ctx.shadowBlur = 14;
    U.roundRect(ctx, c.x - w / 2, c.y - 11, w, 22, w / 2);
    ctx.fillStyle = '#ffcf3f'; ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#b8790a'; ctx.lineWidth = 1.5;
    U.roundRect(ctx, c.x - w / 2, c.y - 11, w, 22, w / 2); ctx.stroke();
    if (w > 11) px(ctx, c.x - 2, c.y - 7, 3, 12, '#fff2b0');
  }
  function drawFoe(ctx, f) {
    var bob = Math.sin(f.t * 7) * 2, x = f.x, y = f.y + bob;
    px(ctx, x + 2, y + 6, 30, 24, '#2f9d55');
    px(ctx, x, y + 12, 34, 18, '#39b961');
    px(ctx, x + 4, y + 4, 26, 7, '#54d477');
    px(ctx, x + 7, y + 14, 7, 8, '#fff'); px(ctx, x + 20, y + 14, 7, 8, '#fff');
    px(ctx, x + 10, y + 17, 3, 4, '#172b1c'); px(ctx, x + 22, y + 17, 3, 4, '#172b1c');
  }
  function drawSpike(ctx, s) {
    ctx.fillStyle = '#9aa6b5';
    for (var i = 0; i < 3; i++) {
      var x = s.x + i * 10;
      ctx.beginPath(); ctx.moveTo(x, s.y + s.h); ctx.lineTo(x + 5, s.y); ctx.lineTo(x + 10, s.y + s.h); ctx.closePath(); ctx.fill();
    }
    px(ctx, s.x, s.y + s.h - 3, s.w, 3, '#5c6a7c');
  }
  function drawFlag(ctx, f) {
    px(ctx, f.x - 2, f.y - 130, 5, 130, '#e8f2ff');
    ctx.fillStyle = '#ffcf3f'; ctx.beginPath();
    ctx.moveTo(f.x + 3, f.y - 128); ctx.lineTo(f.x + 58, f.y - 113); ctx.lineTo(f.x + 3, f.y - 96); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a3448'; ctx.font = '700 15px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(f.label, f.x + 8, f.y - 88);
  }
  function drawPlayer(ctx, p) {
    var x = Math.round(p.x), y = Math.round(p.y), f = p.face;
    var blink = st.invuln > 0 ? (0.38 + 0.62 * Math.abs(Math.sin(st.t * 22))) : 1;
    ctx.save(); ctx.globalAlpha = blink;
    var sw = p.grounded ? Math.round(Math.sin(p.anim) * 5) : 3;
    px(ctx, x + 6, y + 32, 9, 11 - sw, '#2b47a8');
    px(ctx, x + 17, y + 32, 9, 11 + sw, '#3457c4');
    px(ctx, x + 4, y + 42 - sw, 12, 4, '#20242e');
    px(ctx, x + 16, y + 42 + sw, 12, 4, '#20242e');
    px(ctx, x + 4, y + 18, 24, 16, '#e33b3b');
    px(ctx, x + 1, y + 20 + (sw > 0 ? 2 : -2), 6, 12, '#f0b48c');
    px(ctx, x + 25, y + 20 - (sw > 0 ? 2 : -2), 6, 12, '#f0b48c');
    px(ctx, x + 6, y + 4, 20, 16, '#f5c19b');
    px(ctx, x + 5, y, 22, 7, '#5b3524');
    px(ctx, x + (f > 0 ? 21 : 5) - 2, y + 3, 7, 9, '#5b3524');
    px(ctx, x + (f > 0 ? 19 : 10), y + 11, 3, 4, '#241b19');
    ctx.restore();
  }
  function heart(ctx, x, y, s, fill) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(0, 0.3);
    ctx.bezierCurveTo(0, -0.35, -1, -0.3, -1, 0.25);
    ctx.bezierCurveTo(-1, 0.85, 0, 1.15, 0, 1.5);
    ctx.bezierCurveTo(0, 1.15, 1, 0.85, 1, 0.25);
    ctx.bezierCurveTo(1, -0.3, 0, -0.35, 0, 0.3);
    ctx.fill(); ctx.restore();
  }

  function draw(ctx, t) {
    if (!st) return;
    syncWH();
    ctx.imageSmoothingEnabled = false;

    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#3f9fe0'); sky.addColorStop(0.6, '#8fd2f2'); sky.addColorStop(1, '#dff2f7');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    px(ctx, W - 118, 82, 54, 54, 'rgba(255,241,170,.9)');

    var cloudOff = -((st.camX * 0.18) % 260);
    ctx.save(); ctx.translate(cloudOff, 0);
    for (var ci = 0; ci < 7; ci++) drawCloud(ctx, ci * 260 - 120, 48 + (ci % 3) * 42, 0.85 + (ci % 2) * 0.3);
    ctx.restore();
    var hillOff = -((st.camX * 0.42) % 330);
    ctx.save(); ctx.translate(hillOff, 0);
    for (var hi = 0; hi < 6; hi++) drawHill(ctx, hi * 330 + 120, H - 210, 460, 150 + (hi % 3) * 34, 'rgba(94,168,149,.28)');
    ctx.restore();

    var pit = ctx.createLinearGradient(0, H * 0.72, 0, H);
    pit.addColorStop(0, 'rgba(12,44,80,0)'); pit.addColorStop(1, 'rgba(7,26,52,.62)');
    ctx.fillStyle = pit; ctx.fillRect(0, H * 0.72, W, H * 0.28);

    ctx.save();
    ctx.translate(-st.camX, 0);
    if (st.shake > 0) ctx.translate((Math.random() - 0.5) * 7, 0);

    ctx.save(); ctx.translate(st.camX * 0.28, 0);
    for (var ti = 0; ti < st.trees.length; ti++) {
      var d = st.trees[ti];
      if (d.x + st.camX * 0.28 < st.camX - 120 || d.x + st.camX * 0.28 > st.camX + W + 120) continue;
      drawTree(ctx, d);
    }
    ctx.restore();

    for (var i = 0; i < st.plats.length; i++) drawPlat(ctx, st.plats[i]);
    for (var gi = 0; gi < st.flags.length; gi++) drawFlag(ctx, st.flags[gi]);
    for (var si = 0; si < st.spikes.length; si++) drawSpike(ctx, st.spikes[si]);
    for (var ki = 0; ki < st.coins.length; ki++) if (!st.coins[ki].got) drawCoin(ctx, st.coins[ki], t);
    for (var fi = 0; fi < st.foes.length; fi++) if (st.foes[fi].alive) drawFoe(ctx, st.foes[fi]);

    // 分叉路标只在镜头附近画，避免远处一片箭头
    for (var ai = 0; ai < st.signs.length; ai++) {
      var sg = st.signs[ai];
      if (sg.x < st.camX - 40 || sg.x > st.camX + W + 40) continue;
      ctx.fillStyle = sg.up ? '#ffcf3f' : 'rgba(255,255,255,.92)';
      ctx.font = '900 28px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sg.up ? '↑' : '→', sg.x, sg.y);
    }
    drawPlayer(ctx, st.p);

    for (var oi = 0; oi < st.pops.length; oi++) {
      var o = st.pops[oi];
      ctx.save(); ctx.globalAlpha = Math.min(1, o.life * 1.8);
      ctx.fillStyle = o.col; ctx.font = '900 19px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.txt, o.x, o.y); ctx.restore();
    }
    ctx.restore();

    // 屏幕固定 HUD：进度条 / 本关金币 / 命。通关与阵亡交给 DOM 结算页，不再往画布上堆小字。
    var prog = U.clamp((st.p.x - st.startX) / (st.goalX - st.startX), 0, 1);
    px(ctx, 18, 22, 240, 7, 'rgba(5,20,36,.28)');
    px(ctx, 18, 22, 240 * prog, 7, '#3fd6ff');
    px(ctx, 18 + 240 * prog - 3, 17, 6, 17, '#ffffff');

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffd04a'; ctx.font = '900 24px "PingFang SC",sans-serif';
    ctx.textAlign = 'right'; ctx.fillText('◈ ' + st.coinsGot + '/' + st.coinsTotal, W - 18, 14);
    var hw = 24, total = st.maxLives * hw, hx0 = W / 2 - total / 2 + hw / 2;
    for (var k = 0; k < st.maxLives; k++) heart(ctx, hx0 + k * hw, 26, 9, k < st.lives ? '#ff4f66' : 'rgba(255,79,102,.22)');
    if (st.shield > 0) {
      ctx.fillStyle = '#8dffb0'; ctx.font = '700 13px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('⬡ ×' + st.shield, W / 2, 46);
    }
  }

  // ---------- 对外接口 ----------
  return {
    // 画面最底行的颜色，渲染器用它填充固定宽高比留下的上下空白，避免出现一条突兀黑带
    bgColor: '#5e7284',
    init: init, start: start, reset: reset, update: update, draw: draw,
    restart: restart, nextLevel: nextLevel, cashOut: cashOut,
    setDir: setDir, jump: jump, releaseJump: releaseJump, setJumpHeld: setJumpHeld,
    setEndHook: function (fn) { endHook = fn; },
    state: function () { return st; },
    LEVEL_COUNT: LEVEL_COUNT, segmentsOf: segmentsOf, starsOf: starsOf,
    totalStars: totalStars, lastLevel: lastLevel, goalX: function () { return st ? st.goalX : 0; },
    shopData: function () { return { wallet: B.U.coins(), up: loadUp(), defs: UP }; },
    wallet: function () { return B.U.coins(); }, upgrades: loadUp, shopDefs: function () { return UP; },
    costOf: costOf, canBuy: canBuy, buy: buy,
    cfg: function () { return { MAX_GAP: MAX_GAP, MAX_RISE: MAX_RISE, RUN_V: RUN_V, JUMP_V: JUMP_V, GRAV: GRAV, PW: PW, PH: PH, SEG_W: SEG_W }; }
  };
})();

// 注册到合集：大厅只认 B.Games 这张表，不用改任何 UI 代码就自动多一张卡。
if (B.Games && B.Games.add) {
  B.Games.add({
    id: 'hop', name: '跳跃拾金', category: '动作', icon: '⤴',
    desc: '跑跳收金币，选条路走到旗子过关。',
    resume: function () { B.UI.startHop(B.Hop.lastLevel()); },
    enter: function () { B.UI.show('screenHopLevels'); },
    shop: function () { B.UI.show('screenHopShop'); }
  });
}

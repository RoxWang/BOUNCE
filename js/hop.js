// hop.js —— 跳跃拾金：像素风横版平台跳跃（第三个独立游戏）
//
// 构成参考的是同类网页平台跳跃游戏的通行做法：requestAnimationFrame 主循环、重力 + 跳跃抛物线、
// AABB 分轴碰撞（只从上方落脚的单向平台）、程序化生成 + 摄像机横向跟随、接触即拾取的金币。
// 参考：MDN / 常见 HTML5 platformer 实现、Mario-style platformer（github.com/donghaozhang/mario-platformer-game），
// 以及 XSCT Bench「平台跳跃版」对重力、落脚、金币、镜头跟随的构成要求。
//
// 与合集里另外两个游戏的边界：
//   弹珠解谜 = 确定性解谜；无尽冲刺 = 竖屏躲落块；跳跃拾金 = 横卷轴跑跳 + 收集。
//   三个游戏各自一套状态机，只共用画布、音效和统一金库 B.U.coins()。
//
// 公平性红线（跟无尽冲刺的「缝一定够得着」同理）：
//   坑宽永远 ≤ MAX_GAP、上升落差永远 ≤ MAX_RISE，两者都远小于当前跳跃能力的理论极限，
//   所以程序化生成不可能造出「按死方向键也过不去」的死局。生成时把随机量夹死，
//   并用 st.genBad 记违规次数（正常恒为 0，自测会断言）。
//
// 经济：本局吃到的金币在 GAME OVER 时一次性存进合集统一金库，阵亡不丢、跨游戏共用。
//   金库可在本游戏的强化页买永久升级（弹跳 / 生命 / 磁石 / 护盾）。
var B = window.B = window.B || {};

B.Hop = (function () {
  var U = B.U;

  // 世界尺寸跟随 B.C：Game.startHop() 会把 C.W/C.H 换成 1100×620 的横屏视野再调 resize()。
  // 渲染器缩放、裁剪、toWorld 都用同一套 C.W/C.H，所以指针输入自动对得上。
  var W = 1100, H = 620;
  function syncWH() { W = B.C.W; H = B.C.H; }

  // ---------- 物理常量（单位 px / s）----------
  var GRAV = 2100, JUMP_V = 790, RUN_V = 335;
  var ACC_GROUND = 3000, ACC_AIR = 2100, FRICTION = 2600, MAX_FALL = 1200;
  var COYOTE = 0.10;     // 离开平台后仍可起跳的宽限（手感，不算作弊）
  var JBUF = 0.12;       // 落地前提前按跳也算数
  var PW = 32, PH = 46;  // 玩家 AABB
  var PLAT_H = 40;

  // 跳跃能力：滞空 2*790/2100 = 0.752s，最高 148.6px，满速水平跳距 252px。
  // 生成上限只取理论值的六成左右，留出「没助跑 / 手慢 / 要吃金币」的余量。
  var MAX_GAP = 150;      // 坑宽上限
  var MAX_RISE = 90;      // 下一块比上一块高多少的上限
  var CHUNK_MIN = 200, CHUNK_MAX = 340;

  function sfx(n) { if (B.A && B.A.play) B.A.play(n); }

  // ---------- 永久强化（存档键独立，不碰另外两个游戏的历史键）----------
  var UP = [
    { id: 'boots', name: '弹跳', icon: '⤴', max: 3, desc: '每级跳高 +6%，够得到更高的金币', cost: [110, 280, 680] },
    { id: 'heart', name: '生命', icon: '♥', max: 2, desc: '每局开局 +1 条命（默认 3 条）', cost: [140, 360] },
    { id: 'magnet', name: '磁石', icon: '◎', max: 3, desc: '金币吸附范围每级 +24', cost: [90, 230, 580] },
    { id: 'shield', name: '护盾', icon: '⬡', max: 3, desc: '每局开局带一层护盾，挡一次伤害', cost: [150, 380, 880] }
  ];
  var UPKEY = 'bounce.hopup', BESTKEY = 'bounce.hopbest';

  function upDef(id) { for (var i = 0; i < UP.length; i++) if (UP[i].id === id) return UP[i]; return null; }
  function loadUp() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(UPKEY) || '{}') || {}; } catch (e) { o = {}; }
    var r = {}; for (var i = 0; i < UP.length; i++) r[UP[i].id] = o[UP[i].id] || 0; return r;
  }
  function saveUp(u) { try { localStorage.setItem(UPKEY, JSON.stringify(u)); } catch (e) { } }
  function loadBest() { try { return parseInt(localStorage.getItem(BESTKEY) || '0', 10) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(BESTKEY, String(v)); } catch (e) { } }

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

  function px(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  // ---------- 世界生成 ----------
  function addPlat(x, y, w, kind) { st.plats.push({ x: x, y: y, w: w, h: PLAT_H, kind: kind }); }

  // 金币只放在平台正上方、跳跃可及的高度；避开尖刺和怪物正上方的「必吃伤害」位置。
  function addCoins(x, y, w, n, avoid) {
    for (var i = 0; i < n; i++) {
      var cx = x + w * (i + 1) / (n + 1);
      var bad = false;
      for (var j = 0; j < avoid.length; j++) if (Math.abs(cx - avoid[j]) < 42) bad = true;
      if (bad) continue;
      st.coins.push({ x: cx, y: y - 52, got: false, ph: st.coins.length * 0.83 });
    }
  }

  function genChunk() {
    var r = st.rng;
    var diff = Math.min(1, st.chunkIdx / 26);          // 前 26 段难度缓升，之后封顶
    var avoid = [];
    var prevY = st.lastY;                              // 校验要用改动前的值，别拿已覆盖的 st.lastY 比

    // 坑：从 60 起，随难度逼近 MAX_GAP，但永远不超过它。
    var gap = r() < (0.52 + 0.22 * diff)
      ? 58 + r() * (MAX_GAP - 58) * (0.55 + 0.45 * diff)
      : 0;
    gap = U.clamp(gap, 0, MAX_GAP);

    // 高低差：y 向下为正，负数 = 变高。上升夹在 MAX_RISE 内，下降不得超过 62。
    var dy = U.clamp((r() * 2 - 1) * (30 + 46 * diff), -MAX_RISE, 62);
    var y = U.clamp(st.lastY + dy, H * 0.42, H - 140);
    // 往上跳时滞空变短，顺手把坑再收一截，保证「升得高 + 跨得远」不会同时发生。
    if (y < st.lastY - 20) gap = Math.min(gap, MAX_GAP * 0.72);

    var x = st.lastX + gap;
    var w = CHUNK_MIN + r() * (CHUNK_MAX - CHUNK_MIN) * (1 - 0.18 * diff);
    addPlat(x, y, w, 'ground');

    // 浮空高台：可选的「多跳一下多吃两枚」路线，不挡主路。
    if (r() < 0.52) {
      var fw = 104 + r() * 66;
      var fx = x + 18 + r() * Math.max(1, w - fw - 36);
      var fy = y - (68 + r() * 22);
      addPlat(fx, fy, fw, 'ledge');
      addCoins(fx, fy, fw, 2, []);
    }

    // 尖刺：只放在够宽的平台中段，两侧各留 ≥ 70 落脚空间，能被跳过或绕开。
    if (w > 258 && r() < 0.30 + 0.26 * diff) {
      var sx = x + 96 + r() * Math.max(1, w - 192);
      st.spikes.push({ x: sx, y: y - 17, w: 30, h: 17 });
      avoid.push(sx + 15);
    }
    // 巡逻怪：踩头能消灭，侧面撞才掉命；只在够宽的地面段出现。
    if (w > 236 && r() < 0.26 + 0.30 * diff) {
      var ex = x + 74 + r() * Math.max(1, w - 150);
      st.foes.push({
        x: ex, y: y - 30, w: 34, h: 30,
        vx: (r() < 0.5 ? -1 : 1) * (58 + 34 * diff),
        lo: x + 8, hi: x + w - 42, alive: true, t: r() * 6
      });
      avoid.push(ex + 17);
    }

    addCoins(x, y, w, 2 + (r() < 0.42 ? 1 : 0), avoid);

    if (r() < 0.62) st.trees.push({ x: x + 20 + r() * Math.max(1, w - 40), y: y, s: 0.8 + r() * 0.55 });
    var mile = Math.floor((x - st.startX) / 5000);
    if (mile > st.lastFlag) { st.flags.push({ x: x + 46, y: y, m: mile * 500 }); st.lastFlag = mile; }

    st.lastX = x + w;
    st.lastY = y;
    st.chunkIdx++;
    // 硬约束被破坏就记账（正常应为 0）。测试会断言它，也能在自测 title 里看到。
    if (gap > MAX_GAP + 0.5 || (prevY - y) > MAX_RISE + 0.5 || (y - prevY) > 62.5) st.genBad++;
    if (w < 120) st.genBad++;
  }

  function ensureGenerated() {
    var need = st.camX + W + 900, guard = 0;
    while (st.lastX < need && guard++ < 48) genChunk();
    var cut = st.camX - W * 1.2;
    st.plats = st.plats.filter(function (q) { return q.x + q.w > cut; });
    st.coins = st.coins.filter(function (c) { return c.x > cut && !c.got; });
    st.foes = st.foes.filter(function (f) { return f.x > cut && f.alive; });
    st.spikes = st.spikes.filter(function (s) { return s.x > cut; });
    st.trees = st.trees.filter(function (d) { return d.x > cut; });
    st.flags = st.flags.filter(function (f) { return f.x > cut; });
  }

  // ---------- 初始化 / 重开 ----------
  function reset(seed) {
    syncWH();
    var up = loadUp();
    var s = (seed == null ? (Date.now() >>> 0) : seed) >>> 0;
    if (!s) s = 1;
    var groundY = H - 150;
    st = {
      rng: U.rng(s), seed: s, t: 0, camX: 0, genX: 0, startX: 60,
      dir: 0, jumpBuf: 0, jumpHeld: false,
      p: { x: 90, y: groundY - PH, vx: 0, vy: 0, grounded: true, coyote: COYOTE, face: 1, anim: 0 },
      plats: [], coins: [], foes: [], spikes: [], trees: [], flags: [], pops: [],
      lastX: 0, lastY: groundY, chunkIdx: 0, lastFlag: 0,
      lives: 3 + (up.heart || 0), maxLives: 3 + (up.heart || 0),
      shield: up.shield || 0, invuln: 0,
      jumpMul: 1 + 0.06 * (up.boots || 0),
      magnetR: 24 + 24 * (up.magnet || 0),
      coinsGot: 0, score: 0, best: loadBest(), dead: false, banked: false, shake: 0,
      genBad: 0, falls: 0, hits: 0, picked: 0, stomped: 0
    };
    // 起跑台：又长又平、没坑没怪，先把操作手感交到玩家手里。
    addPlat(0, groundY, 520, 'ground');
    addCoins(120, groundY, 320, 3, []);
    st.lastX = 520;
    ensureGenerated();
    return st;
  }
  function init() { reset(); }
  // 本局金币入账（只记一次）。阵亡、中途重来、直接退大厅都会走这里，
  // 否则玩家跑了一局不结算就退出，金币凭空消失。
  function cashOut() {
    if (!st || st.banked) return 0;
    st.banked = true;
    if (st.coinsGot > 0) B.U.addCoins(st.coinsGot);
    return st.coinsGot;
  }
  // 重来键 / 死亡后空格 / 点击：一律无条件开新局，跟「无尽冲刺」的重来行为一致。
  function restart() { cashOut(); reset(); }

  // ---------- 输入（键盘 / 虚拟按键 / 画布点击走同一套）----------
  function setDir(d) { if (st && !st.dead) st.dir = d < 0 ? -1 : (d > 0 ? 1 : 0); }
  function jump() { if (st && !st.dead) st.jumpBuf = JBUF; }
  function releaseJump() {
    // 松开跳跃键就把上升速度砍半 = 短按小跳、长按大跳（平台跳跃的标准手感）
    if (st && !st.dead && st.p.vy < -140) st.p.vy *= 0.5;
  }
  function setJumpHeld(b) {
    if (!st) return;
    st.jumpHeld = !!b;
    if (!b) releaseJump();
  }

  // ---------- 碰撞：单向平台，只从上方落脚 ----------
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function landOnPlats(p, prevBottom) {
    p.grounded = false;
    if (p.vy < 0) return;                      // 上升中：单向平台不挡头，也不会卡在平台肚子
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
    if (st.dead) return;
    if (st.shield > 0) { st.shield--; st.invuln = 1.1; st.shake = 0.18; sfx('brk'); return; }
    st.lives--; st.invuln = 1.4; st.shake = 0.34; sfx('lose');
    if (st.lives <= 0) die();
  }
  function hit(force) {
    if (st.dead || (!force && st.invuln > 0)) return;
    loseLife();
    if (!st.dead) respawn();
  }
  function respawn() {
    var p = st.p;
    var target = Math.max(st.camX + W * 0.30, p.x - 180);
    var best = null;
    for (var i = 0; i < st.plats.length; i++) {
      var q = st.plats[i];
      if (q.kind !== 'ground' || q.x + q.w < target) continue;
      if (!best || q.x < best.x) best = q;
    }
    if (!best) {   // 极端情况兜底：脚下永远有一块地，绝不让人悬空
      best = { x: st.camX + W * 0.3, y: H - 150, w: 220, h: PLAT_H, kind: 'ground' };
      st.plats.push(best);
    }
    p.x = U.clamp(best.x + 38, st.camX + 10, best.x + best.w - PW - 10);
    p.y = best.y - PH - 2;
    p.vx = 0; p.vy = 0; p.grounded = true; p.coyote = COYOTE;
    st.jumpBuf = 0;
  }
  function die() {
    if (st.dead) return;
    st.dead = true;
    if (st.score > st.best) { st.best = st.score; saveBest(st.score); }
    cashOut();                                // 本局金币进合集统一金库，阵亡不丢
    sfx('lose');
  }

  // ---------- 每帧 ----------
  function update(dt) {
    if (!st) return;
    if (dt > 0.05) dt = 0.05;                // 切标签回来别让人瞬移
    if (dt < 0) dt = 0;
    st.t += dt;
    for (var pi = st.pops.length - 1; pi >= 0; pi--) {
      var pp = st.pops[pi]; pp.life -= dt; pp.y -= 46 * dt;
      if (pp.life <= 0) st.pops.splice(pi, 1);
    }
    if (st.dead) return;
    syncWH();

    var p = st.p;
    if (st.invuln > 0) st.invuln -= dt;
    if (st.shake > 0) st.shake -= dt;

    // 水平：地面 / 空中分别给加速度，松手有摩擦，不会一松就急停也不会一直滑
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

    // 垂直：重力 → 跳跃缓冲 → 位移 → 落脚
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

    // 摄像机只向右推进（无尽跑酷），玩家被挡在屏幕左沿，回收过的世界不会露馅。
    var target = p.x - W * 0.34;
    if (target > st.camX) st.camX = target;
    ensureGenerated();

    // 金币：磁石吸附 + 接触拾取
    var pcx = p.x + PW / 2, pcy = p.y + PH / 2, mr2 = st.magnetR * st.magnetR;
    for (var ci = 0; ci < st.coins.length; ci++) {
      var c = st.coins[ci];
      if (c.got) continue;
      var dx = pcx - c.x, dy = pcy - c.y, d2 = dx * dx + dy * dy;
      if (d2 < mr2) { c.x += dx * dt * 7; c.y += dy * dt * 7; }
      if (Math.abs(pcx - c.x) < 22 && Math.abs(pcy - c.y) < 30) {
        c.got = true; st.coinsGot++; st.picked++;
        pop(c.x, c.y - 12, '◈ +1', '#ffd04a');
        sfx('coin');
      }
    }

    // 巡逻怪：从上方踩头消灭，侧面碰到掉命
    for (var fi = 0; fi < st.foes.length; fi++) {
      var f = st.foes[fi];
      if (!f.alive) continue;
      f.t += dt;
      f.x += f.vx * dt;
      if (f.x < f.lo) { f.x = f.lo; f.vx = -f.vx; }
      if (f.x > f.hi) { f.x = f.hi; f.vx = -f.vx; }
      if (overlaps({ x: p.x, y: p.y, w: PW, h: PH }, f)) {
        if (p.vy > 0 && prevBottom <= f.y + 16) {
          f.alive = false; p.vy = -430; st.coinsGot += 3; st.stomped++;
          pop(f.x + 17, f.y - 10, '◈ +3', '#8dffb0'); sfx('brk');
        } else { st.hits++; hit(false); }
      }
    }

    // 尖刺
    for (var si = 0; si < st.spikes.length; si++) {
      if (overlaps({ x: p.x, y: p.y, w: PW, h: PH }, st.spikes[si])) { st.hits++; hit(false); break; }
    }
    if (st.dead) return;

    // 掉出屏幕：硬失败。就算还在无敌帧也必须把人拉回来，否则会一直往下掉、永远卡住。
    if (p.y > H + 60) {
      st.falls++;
      if (st.invuln <= 0) loseLife();
      if (!st.dead) respawn();
    }

    st.score = Math.max(st.score, Math.floor((p.x - st.startX) / 10));
  }

  // ---------- 绘制（世界坐标，主循环已设好变换）----------
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
    px(ctx, q.x, q.y, q.w, 9, '#59c94a');
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
    // 草叶：让平台边缘不至于是一条死直线
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
    var bob = Math.sin(f.t * 7) * 2;
    var x = f.x, y = f.y + bob;
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
    px(ctx, f.x - 2, f.y - 104, 4, 104, '#e8f2ff');
    ctx.fillStyle = '#ff5a5a'; ctx.beginPath();
    ctx.moveTo(f.x + 2, f.y - 102); ctx.lineTo(f.x + 42, f.y - 90); ctx.lineTo(f.x + 2, f.y - 76); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a3448'; ctx.font = '700 15px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(f.m + ' m', f.x + 8, f.y - 70);
  }
  function drawPlayer(ctx, p) {
    var x = Math.round(p.x), y = Math.round(p.y), f = p.face;
    var blink = st.invuln > 0 ? (0.38 + 0.62 * Math.abs(Math.sin(st.t * 22))) : 1;
    ctx.save(); ctx.globalAlpha = blink;
    var sw = p.grounded ? Math.round(Math.sin(p.anim) * 5) : 3;
    // 腿（两帧交替）+ 鞋
    px(ctx, x + 6, y + 32, 9, 11 - sw, '#2b47a8');
    px(ctx, x + 17, y + 32, 9, 11 + sw, '#3457c4');
    px(ctx, x + 4, y + 42 - sw, 12, 4, '#20242e');
    px(ctx, x + 16, y + 42 + sw, 12, 4, '#20242e');
    // 上衣 + 手臂
    px(ctx, x + 4, y + 18, 24, 16, '#e33b3b');
    px(ctx, x + 1, y + 20 + (sw > 0 ? 2 : -2), 6, 12, '#f0b48c');
    px(ctx, x + 25, y + 20 - (sw > 0 ? 2 : -2), 6, 12, '#f0b48c');
    // 头 + 头发（棕）、眼睛
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

    // 太阳 + 云 + 远山：各自视差，跑起来才有纵深
    px(ctx, W - 118, 82, 54, 54, 'rgba(255,241,170,.9)');
    // 视差层用取模平铺：镜头跑多远都铺得满，不会跑出画面后整片消失。
    var cloudOff = -((st.camX * 0.18) % 260);
    ctx.save(); ctx.translate(cloudOff, 0);
    // 云一律待在角色跳跃最高点（约 y=276）上方，否则跳起来时云会像顶帽子扣在头上。
    for (var ci = 0; ci < 7; ci++) drawCloud(ctx, ci * 260 - 120, 48 + (ci % 3) * 42, 0.85 + (ci % 2) * 0.3);
    ctx.restore();
    var hillOff = -((st.camX * 0.42) % 330);
    ctx.save(); ctx.translate(hillOff, 0);
    for (var hi = 0; hi < 6; hi++) drawHill(ctx, hi * 330 + 120, H - 210, 460, 150 + (hi % 3) * 34, 'rgba(94,168,149,.28)');
    ctx.restore();

    // 平台下方越走越暗 = 深渊，一眼就知道掉下去要扣命，不会误以为下面还有地。
    var pit = ctx.createLinearGradient(0, H * 0.72, 0, H);
    pit.addColorStop(0, 'rgba(12,44,80,0)');
    pit.addColorStop(1, 'rgba(7,26,52,.62)');
    ctx.fillStyle = pit; ctx.fillRect(0, H * 0.72, W, H * 0.28);

    ctx.save();
    ctx.translate(-st.camX, 0);
    if (st.shake > 0) ctx.translate((Math.random() - 0.5) * 7, 0);

    // 树挂在地面后方，视差靠抵消一部分镜头位移实现
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
    drawPlayer(ctx, st.p);

    for (var oi = 0; oi < st.pops.length; oi++) {
      var o = st.pops[oi];
      ctx.save(); ctx.globalAlpha = Math.min(1, o.life * 1.8);
      ctx.fillStyle = o.col; ctx.font = '900 19px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(o.txt, o.x, o.y); ctx.restore();
    }
    ctx.restore();

    // 屏幕固定 HUD：分数 / 金币 / 命 / 最高
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff'; ctx.font = '900 34px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(st.score + ' m', 18, 14);

    ctx.fillStyle = '#ffd04a'; ctx.font = '900 24px "PingFang SC",sans-serif';
    ctx.textAlign = 'right'; ctx.fillText('◈ ' + st.coinsGot, W - 18, 16);
    var hw = 24, total = st.maxLives * hw, hx0 = W / 2 - total / 2 + hw / 2;
    for (var k = 0; k < st.maxLives; k++) heart(ctx, hx0 + k * hw, 26, 9, k < st.lives ? '#ff4f66' : 'rgba(255,79,102,.22)');
    if (st.shield > 0) {
      ctx.fillStyle = '#8dffb0'; ctx.font = '700 13px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('⬡ ×' + st.shield, W / 2, 46);
    }

    if (st.dead) {
      ctx.fillStyle = 'rgba(5,12,24,.84)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff6b6b'; ctx.font = '900 54px "PingFang SC",sans-serif';
      ctx.fillText('游戏结束', W / 2, H / 2 - 92);
      ctx.fillStyle = '#fff'; ctx.font = '900 38px "PingFang SC",sans-serif';
      ctx.fillText('跑了 ' + st.score + ' m', W / 2, H / 2 - 26);
      ctx.fillStyle = '#ffb02e'; ctx.font = '700 19px "PingFang SC",sans-serif';
      ctx.fillText('最高 ' + st.best + ' m', W / 2, H / 2 + 18);
      ctx.fillStyle = '#ffd04a'; ctx.font = '700 17px "PingFang SC",sans-serif';
      ctx.fillText('本局金币 +' + st.coinsGot + '  ·  合集金库 ◈ ' + B.U.coins(), W / 2, H / 2 + 50);
      ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.font = '700 18px "PingFang SC",sans-serif';
      ctx.fillText('空格 / 点击 重来', W / 2, H / 2 + 96);
    }
  }

  // ---------- 对外接口 ----------
  var api = {
    init: init, update: update, draw: draw, restart: restart, cashOut: cashOut,
    setDir: setDir, jump: jump, releaseJump: releaseJump, setJumpHeld: setJumpHeld,
    state: function () { return st; }, best: loadBest,
    shopData: function () { return { wallet: B.U.coins(), up: loadUp(), defs: UP }; },
    wallet: function () { return B.U.coins(); }, upgrades: loadUp, shopDefs: function () { return UP; },
    costOf: costOf, canBuy: canBuy, buy: buy,
    // 自测用：暴露物理上限与生成入口，测试可以直接断言公平性约束
    cfg: function () { return { MAX_GAP: MAX_GAP, MAX_RISE: MAX_RISE, RUN_V: RUN_V, JUMP_V: JUMP_V, GRAV: GRAV, PW: PW, PH: PH }; },
    reset: reset, genChunk: genChunk, ensureGenerated: ensureGenerated
  };

  // 注册到合集：大厅只认 B.Games 这张表，不用改任何 UI 代码就自动多一张卡。
  if (B.Games && B.Games.add) {
    B.Games.add({
      id: 'hop', name: '跳跃拾金', category: '动作', icon: '⤴',
      desc: '左右跑跳收金币，别掉下平台。',
      resume: function () { B.UI.startHop(); },
      enter: function () { B.UI.startHop(); },
      shop: function () { B.UI.show('screenHopShop'); }
    });
  }
  return api;
})();

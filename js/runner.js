// runner.js —— 无尽冲刺：方向键 / 拖拽操控的躲避刷分游戏（独立游戏，不依赖弹珠解谜）
//
// 设计取舍（跟弹珠解谜的红线区分开）：
//   弹珠解谜是"预测=真实、绝不靠运气"——每一关都确定性、可反复算。
//   无尽冲刺是街机式刷分，对标神庙逃亡（Temple Run）/ 跳一跳（Jump Jump）这类——
//   不确定性来自程序化生成 + 技巧上限 + 分数追逐，而不是掷骰子决定一发的结果。
//   所以这里用 Math.random 生成下落障碍的布局，属于这类玩法的正常手法。
//   操作：← → 或拖动屏幕，让小球左右躲开下落方块；活得越久分越高，命没了才结束。
//
// 公平性红线：每行"缝"的位置锁在上一行缝的可达范围内，数学上不存在躲不过去的死局。
//   旧版随机撒缝会出现"按住方向键也挪不过去、必死"的局面，已修掉。
//   难度随分数缓升（开局宽而慢，越后越窄越快），而不是一上来就给死局。
//
// 经济：每行安全通过 +1 金币，阵亡时存进统一金库（bounce.coins，两个游戏共用）。
//   金库可在本游戏的强化页买永久升级：多命 / 护盾 / 缓速 / 巨球。死了不掉，跨局生效。
var B = window.B = window.B || {};

B.Runner = (function () {
  var C = B.C, U = B.U;
  // 画布尺寸不能只在模块加载时取一次：弹珠大地图会改 C.W/C.H，切回来必须跟着变。
  var W = C.W, H = C.H;
  function syncWH() { W = B.C.W; H = B.C.H; }
  var VX = 420;          // 小球水平速度 px/s（配合可达性约束的手感）

  // 强化定义（类似王者荣耀铭文：等级越高越强，费用递增）。id 与本地存档键一致。
  var UP = [
    { id: 'lives', name: '生命', icon: '❤', max: 2, desc: '每局开局 +1 条命（默认 3 条）', cost: [120, 320] },
    { id: 'shield', name: '护盾', icon: '🛡', max: 3, desc: '每局开局带一层护盾，挡一次撞击', cost: [150, 380, 900] },
    { id: 'slow', name: '缓速', icon: '🐢', max: 3, desc: '下落障碍速度每级 -8%', cost: [100, 260, 640] },
    { id: 'fat', name: '巨球', icon: '⚪', max: 3, desc: '球变大，更容易从缝里钻过去', cost: [90, 240, 600] }
  ];

  function upDef(id) { for (var i = 0; i < UP.length; i++) if (UP[i].id === id) return UP[i]; return null; }

  // ---------- 本地存档（强化等级 + 最高分），全部 try/catch，隐私模式写不了也不崩 ----------
  // 键名沿用历史值 bounce.s2up / bounce.s2best，是为了不丢老玩家的强化与最高分；只是内部名字。
  // 金币走统一金库 B.U.coins()（bounce.coins），两个游戏共用同一个池子。
  function loadUp() {
    try { var o = JSON.parse(localStorage.getItem('bounce.s2up') || '{}'); } catch (e) { var o = {}; }
    var r = {}; for (var i = 0; i < UP.length; i++) r[UP[i].id] = o[UP[i].id] || 0; return r;
  }
  function saveUp(u) { try { localStorage.setItem('bounce.s2up', JSON.stringify(u)); } catch (e) { } }
  function loadBest() { try { return parseInt(localStorage.getItem('bounce.s2best') || '0', 10) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('bounce.s2best', String(v)); } catch (e) { } }

  function costOf(id) {
    var d = upDef(id); if (!d) return Infinity;
    var l = (loadUp()[id] || 0);
    return l >= d.max ? Infinity : d.cost[l];
  }
  function canBuy(id) { var c = costOf(id); return c !== Infinity && B.U.coins() >= c; }
  function buy(id) {
    var c = costOf(id); if (c === Infinity) return false;
    if (!B.U.spendCoins(c)) return false;             // 从合集金库扣费（跨游戏共用）
    var up = loadUp(); up[id] = (up[id] || 0) + 1; saveUp(up);
    return true;
  }

  var st = null;

  function reset() {
    syncWH();                       // 几何可能刚被弹珠大地图改过
    var up = loadUp();
    st = {
      x: W / 2, y: H - 130, r: 16 + 3 * (up.fat || 0),
      dir: 0, obstacles: [], pickups: [],
      prevGap: W / 2,           // 上一行缝的中心，用来约束下一行"够得着"
      spawnT: 1.05, spawnTimer: 0,
      spawnPT: 7,               // 道具刷新计时（秒）
      slowT: 0,                 // 缓速道具剩余时长
      scoreMul: 1 - 0.08 * (up.slow || 0),   // 缓速强化
      score: 0, best: loadBest(),
      lives: 3 + (up.lives || 0), maxLives: 3 + (up.lives || 0),
      shield: up.shield || 0,
      coins: 0,                  // 本局已攒金币
      dead: false, t: 0, shake: 0, invuln: 0,
      _reachBad: 0,             // 自测用：出现过"缝够不着"的次数，正常应为 0
      _picked: 0                // 自测用：吃到的道具数
    };
  }

  function init() { reset(); }

  // ---------- 输入 ----------
  function setTarget(x) { if (st && !st.dead) st.x = U.clamp(x, st.r + 8, W - st.r - 8); }
  function nudge(dx) { if (st && !st.dead) st.x = U.clamp(st.x + dx, st.r + 8, W - st.r - 8); }
  function setDir(d) { if (st) st.dir = d; }
  function restart() { if (st && st.dead) { reset(); } }

  // ---------- 生成一行下落障碍 ----------
  // 核心公平性：新缝中心 = 上一行缝中心 + 一个随机偏移，偏移幅度不超过"球在 spawnT 内的最大横移"。
  // 这样相邻两行的缝永远在可达范围内 → 不存在躲不过去的死局。开局 60 分走"热身"，又宽又慢又贴近中线。
  function spawnRow() {
    var warm = st.score < 60;                       // 开局一小段纯热身
    var gapW = warm ? 172 : U.clamp(180 - st.score * 0.06, 2 * st.r + 40, 180);
    var left = st.r + 8, right = W - st.r - 8;
    var spawnT = warm ? 1.05 : U.clamp(1.05 - st.score * 0.0011, 0.55, 1.05);
    var maxReach = Math.max(30, VX * spawnT - 44);  // 球这一行间能横移的极限（留安全余量）

    // 新缝中心锁在 [prevGap - maxReach, prevGap + maxReach]，再夹到合法区间
    var center = st.prevGap + (Math.random() * 2 - 1) * maxReach;
    if (Math.abs(center - st.prevGap) > maxReach + 0.5) st._reachBad++;
    center = U.clamp(center, left + gapW / 2, right - gapW / 2);
    st.prevGap = center;

    var gapX = center - gapW / 2, thick = 30, y = -thick;
    var hasLeft = gapX > left + 0.5, hasRight = (gapX + gapW) < right - 0.5;
    // 恰好让"左半"或"右半"之一带 row:true，用于每行只记一次金币
    if (hasLeft) st.obstacles.push({ x: 0, y: y, w: gapX, h: thick, row: true });
    if (hasRight) st.obstacles.push({ x: gapX + gapW, y: y, w: W - (gapX + gapW), h: thick, row: !hasLeft });

    // 浮空小砖：只放在缝"外面"的实心区，绝不去堵唯一的缝（否则又变死局）
    if (Math.random() < (warm ? 0.12 : 0.38)) {
      var bw = 54 + Math.random() * 60;
      var side = Math.random() < 0.5;
      var bx = null;
      if (side && gapX - 12 - bw > left) bx = left + Math.random() * (gapX - 12 - bw - left);
      else if (!side && (gapX + gapW) + 12 + bw < right) bx = (gapX + gapW) + 12 + Math.random() * (right - 12 - bw - ((gapX + gapW) + 12));
      if (bx != null) st.obstacles.push({ x: bx, y: y - 78, w: bw, h: 22, row: false });
    }
  }

  // ---------- 道具：偶尔从顶部飘下一个可选拾取物 ----------
  // 设计：x 偏向"当前缝中心"附近撒落，玩家即便不主动去够也大概率顺路吃到，
  // 绝不会被逼着撞墙去捡；纯增益、不强制。种类：护盾🛡 / 缓速🐢 / 金币◈。
  function spawnPickup() {
    var kinds = ['shield', 'slow', 'coin'];
    var kind = kinds[(Math.random() * kinds.length) | 0];
    var left = st.r + 8, right = W - st.r - 8;
    var x = U.clamp(st.prevGap + (Math.random() * 2 - 1) * (W * 0.26), left, right);
    st.pickups.push({ x: x, y: -30, r: 15, kind: kind, t: 0 });
  }

  function applyPickup(kind) {
    if (kind === 'shield') st.shield = Math.min(st.shield + 1, 3);
    else if (kind === 'slow') st.slowT = 4.2;          // 4.2 秒缓速
    else if (kind === 'coin') st.coins += 5;           // 额外金币
    st.shake = Math.max(st.shake, 0.08);
    st._picked++;
  }

  // ---------- 命中 / 掉命 ----------
  function hit() {
    if (st.invuln > 0 || st.dead) return;
    if (st.shield > 0) { st.shield--; st.invuln = 1.1; st.shake = 0.18; return; }  // 护盾抵消一次
    st.lives--; st.invuln = 1.3; st.shake = 0.32;
    if (st.lives <= 0) die();
  }

  // ---------- 更新 ----------
  function update(dt) {
    if (!st || st.dead) return;
    st.t += dt;
    if (st.invuln > 0) st.invuln -= dt;
    if (st.shake > 0) st.shake -= dt;

    if (st.dir) st.x = U.clamp(st.x + st.dir * VX * dt, st.r + 8, W - st.r - 8);

    if (st.slowT > 0) st.slowT -= dt;
    var slowFactor = st.slowT > 0 ? 0.55 : 1;
    var scroll = (190 + Math.min(st.score * 0.45, 250)) * st.scoreMul * slowFactor;
    st.spawnTimer -= dt;
    if (st.spawnTimer <= 0) { spawnRow(); st.spawnTimer = st.spawnT = U.clamp(1.05 - st.score * 0.0011, 0.55, 1.05); }

    // 道具刷新（热身过后才出现，避免开局杂乱）
    st.spawnPT -= dt;
    if (st.spawnPT <= 0 && st.score > 30) { spawnPickup(); st.spawnPT = 6 + Math.random() * 6; }

    for (var i = st.obstacles.length - 1; i >= 0; i--) {
      var o = st.obstacles[i];
      o.y += scroll * dt;
      if (o.y > H + 50) { if (o.row) st.coins++; st.obstacles.splice(i, 1); continue; }
      // 圆-矩形碰撞（仅在非无敌时判定）
      if (st.invuln <= 0) {
        var cx = U.clamp(st.x, o.x, o.x + o.w);
        var cy = U.clamp(st.y, o.y, o.y + o.h);
        var dx = st.x - cx, dy = st.y - cy;
        if (dx * dx + dy * dy < st.r * st.r) { hit(); if (st.dead) return; }
      }
    }

    // 道具：下落 + 与小球碰撞拾取
    for (var j = st.pickups.length - 1; j >= 0; j--) {
      var p = st.pickups[j];
      p.y += scroll * dt; p.t += dt;
      if (p.y > H + 40) { st.pickups.splice(j, 1); continue; }
      var ddx = st.x - p.x, ddy = st.y - p.y, rr = st.r + p.r;
      if (ddx * ddx + ddy * ddy < rr * rr) { applyPickup(p.kind); st.pickups.splice(j, 1); }
    }

    st.score += dt * 11;
  }

  function die() {
    st.dead = true;
    var s = Math.floor(st.score);
    if (s > st.best) { st.best = s; saveBest(s); }
    B.U.addCoins(st.coins);   // 本局金币存进合集金库（与弹珠模式共用）
  }

  // ---------- 绘制（世界坐标，主循环已设好变换）----------
  function heart(ctx, x, y, s, fill) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, 0.3);
    ctx.bezierCurveTo(0, -0.35, -1, -0.3, -1, 0.25);
    ctx.bezierCurveTo(-1, 0.85, 0, 1.15, 0, 1.5);
    ctx.bezierCurveTo(0, 1.15, 1, 0.85, 1, 0.25);
    ctx.bezierCurveTo(1, -0.3, 0, -0.35, 0, 0.3);
    ctx.fill(); ctx.restore();
  }

  function draw(ctx, t) {
    if (!st) return;
    syncWH();
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f1e'); g.addColorStop(1, '#05060c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < st.obstacles.length; i++) {
      var o = st.obstacles[i];
      ctx.fillStyle = (o.h > 24) ? '#5a86ff' : '#8e97ad';
      U.roundRect(ctx, o.x, o.y, o.w, o.h, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // 道具：发光圆 + emoji 标识
    for (var pi = 0; pi < st.pickups.length; pi++) {
      var p = st.pickups[pi];
      var col = p.kind === 'shield' ? '#46e08a' : p.kind === 'slow' ? '#7ad7ff' : '#ffd04a';
      var glyph = p.kind === 'shield' ? '🛡' : p.kind === 'slow' ? '🐢' : '◈';
      var pulse = 1 + 0.08 * Math.sin(p.t * 6);
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(10,14,30,.7)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = '20px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(glyph, p.x, p.y + 1);
    }

    // 受击/无敌闪烁
    var blink = st.invuln > 0 ? (0.35 + 0.65 * Math.abs(Math.sin(st.t * 22))) : 1;
    var sx = st.shake > 0 ? (Math.random() - 0.5) * 8 : 0;
    ctx.save();
    ctx.globalAlpha = blink;
    if (st.shield > 0) { ctx.strokeStyle = 'rgba(70,224,138,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(st.x + sx, st.y, st.r + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.shadowColor = 'rgba(255,176,46,.85)'; ctx.shadowBlur = 18;
    var bg = ctx.createRadialGradient(st.x + sx, st.y, 2, st.x + sx, st.y, st.r);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#ffb02e');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(st.x + sx, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // HUD：分数（左上）、本局金币（右上）、命（中上，爱心）、护盾提示
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffb02e'; ctx.font = '900 34px "PingFang SC",sans-serif';
    ctx.textAlign = 'left'; ctx.fillText(Math.floor(st.score), 18, 14);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '700 15px "PingFang SC",sans-serif';
    ctx.fillText('最高 ' + st.best, 18, 54);

    ctx.fillStyle = '#ffd04a'; ctx.font = '900 22px "PingFang SC",sans-serif';
    ctx.textAlign = 'right'; ctx.fillText('◈ ' + st.coins, W - 18, 16);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '700 12px "PingFang SC",sans-serif';
    ctx.fillText('本局金币', W - 18, 42);

    // 命：maxLives 个槽，活的红心、没的暗心
    var hw = 22, total = st.maxLives * hw, hx0 = W / 2 - total / 2 + hw / 2;
    for (var k = 0; k < st.maxLives; k++) {
      heart(ctx, hx0 + k * hw, 26, 8, k < st.lives ? '#ff5a6e' : 'rgba(255,90,110,.22)');
    }
    if (st.shield > 0) { ctx.fillStyle = '#46e08a'; ctx.font = '700 12px "PingFang SC",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🛡 ×' + st.shield, W / 2, 44); }
    if (st.slowT > 0) { ctx.fillStyle = '#7ad7ff'; ctx.font = '700 13px "PingFang SC",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🐢 缓速 ' + st.slowT.toFixed(1) + 's', W / 2, 60); }

    if (st.dead) {
      ctx.fillStyle = 'rgba(5,6,12,.82)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff5a5a'; ctx.font = '900 54px "PingFang SC",sans-serif';
      ctx.fillText('游戏结束', W / 2, H / 2 - 86);
      ctx.fillStyle = '#fff'; ctx.font = '900 36px "PingFang SC",sans-serif';
      ctx.fillText('得分 ' + Math.floor(st.score), W / 2, H / 2 - 22);
      ctx.fillStyle = '#ffb02e'; ctx.font = '700 19px "PingFang SC",sans-serif';
      ctx.fillText('最高 ' + st.best, W / 2, H / 2 + 16);
      ctx.fillStyle = '#ffd04a'; ctx.font = '700 16px "PingFang SC",sans-serif';
      ctx.fillText('本局金币 +' + st.coins + '  ·  合集金库 ' + B.U.coins(), W / 2, H / 2 + 44);
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '700 18px "PingFang SC",sans-serif';
      ctx.fillText('点击 / 空格 重来', W / 2, H / 2 + 86);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = '700 13px "PingFang SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('← → 或拖动屏幕 躲避下落方块', W / 2, H - 22);
    }
  }

  return {
    init: init, update: update, draw: draw,
    setTarget: setTarget, nudge: nudge, setDir: setDir, restart: restart,
    state: function () { return st; },
    best: loadBest,
    // 经济 / 强化接口（给 UI 的商店与大厅进度用）
    shopData: function () { return { wallet: B.U.coins(), up: loadUp(), defs: UP }; },
    wallet: function () { return B.U.coins(); }, upgrades: loadUp, shopDefs: function () { return UP; },
    costOf: costOf, canBuy: canBuy, buy: buy
  };
})();

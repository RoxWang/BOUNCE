// rail.js —— 轨道狂奔：三轨道伪 3D 无尽跑酷（第四个独立游戏）
//
// 跟另外三个的边界：弹珠解谜 = 确定性解谜；无尽冲刺 = 俯视躲方块；跳跃拾金 = 30 关有终点；
// 轨道狂奔 = 没有终点的三轨跑酷，靠「换道 / 跳 / 下滑」三种离散动作活下去，越跑越快。
//
// 公平性红线：每一排障碍至少留一条空道，且相邻两排的安全道只差 0 或 1 —— 永远来得及换过去，
// 不存在必须瞬间横穿两条道的死局。记在 st.genBad，测试断言长跑恒为 0。
// 无尽刷分允许 Math.random 决定布局（弹珠那种「一发结果」才必须确定性）。
//
// 生命与成长：开局默认 3 条命，撞障碍扣 1 条（先扣护盾），扣完 GAME OVER；
// 本局金币 + 距离奖励进合集统一金库，金币可买跨局永久强化，
// 局内还能捡到磁石 / 护盾 / 双倍分三种限时 buff。
var B = window.B = window.B || {};

B.Rail = (function () {
  var U = B.U;

  // 世界尺寸跟随 B.C：Game.startRail() 会把 C.W/C.H 换成横屏视野再调 resize()。
  var W = 1100, H = 620;
  function syncWH() { W = B.C.W; H = B.C.H; }

  // ---------- 伪 3D 投影 ----------
  var HORIZON = 0.30, GROUND = 0.80;      // 地平线 / 角色脚下在画布高度里的比例
  var PERSP = 780, DEPTH = 1650;           // 透视常数 / 可见最远距离
  var LANE_SP = 172;                       // dz=0 时相邻轨道中心间距
  function proj(dz) {
    var t = PERSP / (PERSP + Math.max(0, dz));
    var hy = H * HORIZON, gy = H * GROUND;
    return { t: t, y: hy + (gy - hy) * t };
  }
  function laneX(lf, t) { return W / 2 + lf * LANE_SP * t; }

  // ---------- 速度 / 动作常量 ----------
  var SPEED0 = 460, SPEED_MAX = 1000, SPEED_ACC = 9;
  var GRAV = 2700, JUMP_V = 940, SLIDE_T = 0.62;
  var LANE_LERP = 13;
  var CHAR_H = 78, CHAR_SLIDE_H = 34;
  var HIT_FAR = 28, HIT_NEAR = -34, PICK_R = 36;
  var MAGNET_T = 8, DOUBLE_T = 8;
  var INVULN_T = 1.25;

  // ---------- 永久强化 + 最高分存档（金币来自合集统一金库）----------
  var UP = [
    { id: 'heart', name: '生命', icon: '♥', max: 2, desc: '每级开局 +1 条命（默认 3 条）', cost: [140, 360] },
    { id: 'shield', name: '护盾', icon: '⬡', max: 3, desc: '每级开局带一层护盾，挡一次伤害', cost: [150, 380, 880] },
    { id: 'magnet', name: '磁石', icon: '◎', max: 3, desc: '每级扩大金币吸附范围，满级能吸旁边两条道', cost: [90, 230, 580] },
    { id: 'boost', name: '加速', icon: '⚡', max: 3, desc: '每级得分 +8%，跑同样的距离拿更多金币', cost: [120, 300, 720] }
  ];
  var UPKEY = 'bounce.railup', BESTKEY = 'bounce.railbest';

  function upDef(id) { for (var i = 0; i < UP.length; i++) if (UP[i].id === id) return UP[i]; return null; }
  function loadUp() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(UPKEY) || '{}') || {}; } catch (e) { o = {}; }
    var r = {}; for (var i = 0; i < UP.length; i++) r[UP[i].id] = o[UP[i].id] || 0; return r;
  }
  function saveUp(u) { try { localStorage.setItem(UPKEY, JSON.stringify(u)); } catch (e) { } }
  function best() { try { return Math.max(0, parseInt(localStorage.getItem(BESTKEY) || '0', 10) || 0); } catch (e) { return 0; } }
  function saveBest(v) { try { if (v > best()) localStorage.setItem(BESTKEY, String(Math.floor(v))); } catch (e) { } }
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

  var st = null, endHook = null;
  function sfx(n) { if (B.A && B.A.play) B.A.play(n); }
  function px(ctx, x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  }

  // ---------- 关卡（无尽排）生成 ----------
  function spawnRow() {
    var z = st.nextRowZ;
    var prev = st.safeLane;
    // 安全道只能原地或挪一格，保证下一排永远能换到
    var delta = Math.random() < 0.34 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    var safe = U.clamp(prev + delta, 0, 2);
    st.safeLane = safe;

    var cells = [null, null, null];
    var others = [0, 1, 2].filter(function (i) { return i !== safe; });
    // 开局只堵一条，跑久了才出现堵两条
    var busy = st.t < 7 ? 1 : (Math.random() < 0.55 ? 2 : 1);
    if (busy === 2 && Math.random() < 0.5) others.reverse();
    for (var i = 0; i < busy; i++) {
      var r = Math.random();
      if (st.t < 5) cells[others[i]] = 'barrier';
      else if (r < 0.36) cells[others[i]] = 'barrier';       // 跳过去
      else if (r < 0.66) cells[others[i]] = 'beam';          // 下滑钻过去
      else cells[others[i]] = st.t < 14 ? 'barrier' : 'block'; // 只能换道
    }
    var empty = 0;
    for (var e = 0; e < 3; e++) if (!cells[e]) empty++;
    if (empty === 0 || Math.abs(safe - prev) > 1) st.genBad++;

    st.rows.push({ z: z, cells: cells, hit: false });

    // 安全道上一串金币；偶尔把中间那枚换成 buff 道具
    var powerAt = (st.rowCount % 7 === 4) ? 2 : -1;
    var kinds = ['magnet', 'shield', 'double'];
    var power = kinds[Math.floor(Math.random() * kinds.length)];
    for (var k = 0; k < 5; k++) {
      var pz = z - 150 + k * 60;
      if (k === powerAt) st.picks.push({ z: pz, lane: safe, kind: power, got: false, ph: k * 0.7 });
      else st.picks.push({ z: pz, lane: safe, kind: 'coin', got: false, ph: (z + k) * 0.013 });
    }
    st.rowCount++;
    st.nextRowZ += U.clamp(st.speed * 0.80, 320, 640);
  }
  function ensureRows() {
    var guard = 0;
    while (st.nextRowZ < st.dist + DEPTH + 300 && guard++ < 40) spawnRow();
  }

  // ---------- 开始 / 重来 / 结算 ----------
  function start() {
    syncWH();
    var up = loadUp();
    st = {
      t: 0, dist: 0, speed: SPEED0, score: 0, best: best(),
      lane: 0, laneX: 0, jumpY: 0, jumpVy: 0, onGround: true, slideT: 0,
      lives: 3 + (up.heart || 0), maxLives: 3 + (up.heart || 0),
      shield: up.shield || 0, invuln: 0, shake: 0,
      magnetLv: up.magnet || 0, scoreMul: 1 + 0.08 * (up.boost || 0),
      magnetT: 0, doubleT: 0,
      coinsGot: 0, banked: false, bankedTotal: 0, bonus: 0,
      rows: [], picks: [], pops: [],
      nextRowZ: 720, rowCount: 0, safeLane: 1,
      dead: false, paused: false, genBad: 0, hits: 0, picked: 0, powers: 0, passed: 0
    };
    ensureRows();
    return st;
  }
  function init() { return start(); }
  function restart() { cashOut(); return start(); }

  // 本局结算只记一次：阵亡 / 按 R 重来 / 直接退大厅三条路都走这里，绝不吞金币。
  function cashOut() {
    if (!st || st.banked) return 0;
    st.banked = true;
    st.bonus = Math.floor(st.score / 120);
    var total = st.coinsGot + st.bonus;
    if (total > 0) B.U.addCoins(total);
    st.bankedTotal = total;
    return total;
  }
  function finish() {
    if (!st || st.dead) return;
    st.dead = true;
    saveBest(st.score);
    cashOut();
    sfx('lose');
    if (endHook) endHook({
      score: st.score, best: best(), distance: Math.floor(st.dist),
      coins: st.coinsGot, bonus: st.bonus, total: st.bankedTotal,
      powers: st.powers, lives: st.lives
    });
  }
  function setEndHook(fn) { endHook = fn; }

  // ---------- 输入：全是离散动作（按住不会连发）----------
  function move(d) {
    if (!st || st.dead) return;
    st.lane = U.clamp(st.lane + (d < 0 ? -1 : 1), -1, 1);
  }
  function jump() {
    if (!st || st.dead || !st.onGround || st.slideT > 0) return;
    st.jumpVy = JUMP_V; st.onGround = false; sfx('bumper');
  }
  function slide() {
    if (!st || st.dead || st.slideT > 0 || !st.onGround) return;
    st.slideT = SLIDE_T;
  }

  // ---------- 伤害 ----------
  function hit() {
    if (!st || st.dead || st.invuln > 0) return;
    st.hits++;
    if (st.shield > 0) { st.shield--; st.invuln = INVULN_T; st.shake = 0.18; sfx('brk'); return; }
    st.lives--; st.invuln = INVULN_T; st.shake = 0.34; sfx('lose');
    if (st.lives <= 0) finish();
  }
  function pop(txt, col) { st.pops.push({ txt: txt, col: col, life: 0.9 }); }

  // ---------- 每帧 ----------
  // 打开玩法页时冻结世界：不丢本局、也不会在看规则的时候被撞死。
  function setPaused(v) { if (st) st.paused = !!v; }

  function update(dt) {
    if (!st || st.paused) return;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    st.t += dt;
    for (var pi = st.pops.length - 1; pi >= 0; pi--) {
      st.pops[pi].life -= dt;
      if (st.pops[pi].life <= 0) st.pops.splice(pi, 1);
    }
    if (st.dead) return;
    syncWH();

    if (st.invuln > 0) st.invuln = Math.max(0, st.invuln - dt);
    if (st.shake > 0) st.shake = Math.max(0, st.shake - dt);
    if (st.magnetT > 0) st.magnetT = Math.max(0, st.magnetT - dt);
    if (st.doubleT > 0) st.doubleT = Math.max(0, st.doubleT - dt);
    if (st.slideT > 0) st.slideT = Math.max(0, st.slideT - dt);

    st.speed = Math.min(SPEED_MAX, SPEED0 + SPEED_ACC * st.t);
    st.dist += st.speed * dt;
    st.score += st.speed * dt / 10 * st.scoreMul * (st.doubleT > 0 ? 2 : 1);

    // 换道插值（视觉平滑，判定用当前 laneX）
    st.laneX += (st.lane - st.laneX) * Math.min(1, LANE_LERP * dt);
    if (Math.abs(st.lane - st.laneX) < 0.002) st.laneX = st.lane;

    if (!st.onGround) {
      st.jumpVy -= GRAV * dt;
      st.jumpY += st.jumpVy * dt;
      if (st.jumpY <= 0) { st.jumpY = 0; st.jumpVy = 0; st.onGround = true; }
    }

    ensureRows();

    // 旧排 / 旧拾取物回收
    for (var ri = st.rows.length - 1; ri >= 0; ri--) if (st.rows[ri].z - st.dist < -220) st.rows.splice(ri, 1);
    for (var ci = st.picks.length - 1; ci >= 0; ci--) if (st.picks[ci].z - st.dist < -220) st.picks.splice(ci, 1);

    // 碰撞：每排只判一次；跳过 / 钻过按动作高度判定，高墙只能换道。
    // 判定用离散目标道 st.lane，不用视觉插值 laneX —— 按下方向键就该立刻生效，
    // 否则角色明明已经「切道」，还要按旧道挨 0.1 秒的冤枉撞。插值只管画面。
    var li = st.lane + 1;
    for (var i = 0; i < st.rows.length; i++) {
      var row = st.rows[i], dz = row.z - st.dist;
      if (row.hit || dz > HIT_FAR || dz < HIT_NEAR) continue;
      row.hit = true; st.passed++;
      if (li < 0 || li > 2) continue;
      var cell = row.cells[li];
      if (!cell) continue;
      if (cell === 'barrier' && st.jumpY > 56) continue;
      if (cell === 'beam' && st.slideT > 0) continue;
      hit();
      if (st.dead) return;
    }

    // 拾取：同轨（或磁石 buff / 磁石强化覆盖）即吃到
    var reach = st.magnetT > 0 ? 2 : (st.magnetLv >= 3 ? 1 : 0);
    for (var k = 0; k < st.picks.length; k++) {
      var p = st.picks[k];
      if (p.got) continue;
      var pdz = p.z - st.dist;
      if (pdz < -PICK_R || pdz > PICK_R) continue;
      if (Math.abs(st.laneX - (p.lane - 1)) > 0.5 + reach) continue;
      p.got = true; st.picked++;
      if (p.kind === 'coin') { st.coinsGot++; sfx('coin'); }
      else {
        st.powers++;
        if (p.kind === 'magnet') { st.magnetT = MAGNET_T; pop('◎ 磁石', '#8dffb0'); }
        else if (p.kind === 'shield') { st.shield++; pop('⬡ 护盾', '#8dffb0'); }
        else { st.doubleT = DOUBLE_T; pop('×2 双倍分', '#ffd04a'); }
        sfx('buy');
      }
    }
  }

  // ---------- 绘制 ----------
  function drawSky(ctx) {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#101a3a'); sky.addColorStop(0.42, '#3c4f88'); sky.addColorStop(0.75, '#8d7ba8');
    sky.addColorStop(1, '#1b2036');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    px(ctx, W * 0.72, H * 0.10, 54, 54, 'rgba(255,232,170,.72)');
    // 远处城市剪影随镜头轻微横移
    var off = -((st.dist * 0.012) % 150);
    ctx.save(); ctx.translate(off, 0);
    for (var i = -1; i < 10; i++) {
      var bw = 56 + ((i * 37) % 4) * 16, bh = 40 + ((i * 53) % 5) * 26;
      px(ctx, i * 150, H * HORIZON - bh, bw, bh, 'rgba(18,24,52,.72)');
      for (var wy = 0; wy < bh - 12; wy += 15)
        for (var wx = 0; wx < bw - 10; wx += 16)
          if ((wx + wy + i * 7) % 3 === 0) px(ctx, i * 150 + wx + 6, H * HORIZON - bh + wy + 6, 5, 6, 'rgba(255,214,120,.35)');
    }
    ctx.restore();
  }
  function drawTrack(ctx) {
    var hy = H * HORIZON, gy = H * GROUND;
    var far = proj(DEPTH);
    var halfNear = 1.5 * LANE_SP, halfFar = 1.5 * LANE_SP * far.t;

    // 路基梯形
    ctx.fillStyle = '#2b3048';
    ctx.beginPath();
    ctx.moveTo(W / 2 - halfNear, gy); ctx.lineTo(W / 2 + halfNear, gy);
    ctx.lineTo(W / 2 + halfFar, far.y); ctx.lineTo(W / 2 - halfFar, far.y);
    ctx.closePath(); ctx.fill();

    // 三条轨道各自一条深色带
    for (var l = -1; l <= 1; l++) {
      var a = laneX(l - 0.5, 1), b = laneX(l + 0.5, 1);
      var a2 = laneX(l - 0.5, far.t), b2 = laneX(l + 0.5, far.t);
      ctx.fillStyle = l === st.lane ? '#3c4566' : '#333b58';
      ctx.beginPath();
      ctx.moveTo(a, gy); ctx.lineTo(b, gy); ctx.lineTo(b2, far.y); ctx.lineTo(a2, far.y);
      ctx.closePath(); ctx.fill();
    }

    // 枕木：按世界距离取整，镜头前进时向脚下流动
    var step = 62, first = Math.floor(st.dist / step) * step;
    for (var z = first + step; z < st.dist + DEPTH; z += step) {
      var p = proj(z - st.dist);
      if (p.y < far.y + 2) continue;
      var hw = 1.5 * LANE_SP * p.t;
      px(ctx, W / 2 - hw, p.y, hw * 2, Math.max(1, 3 * p.t), 'rgba(12,16,32,.46)');
    }

    // 轨道分隔线 + 两侧护栏
    ctx.strokeStyle = 'rgba(255,214,120,.55)'; ctx.lineWidth = 2;
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(laneX(s * 0.5, 1), gy); ctx.lineTo(laneX(s * 0.5, far.t), far.y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(63,214,255,.55)'; ctx.lineWidth = 3;
    for (var e = -1; e <= 1; e += 2) {
      ctx.beginPath();
      ctx.moveTo(laneX(e * 1.5, 1), gy); ctx.lineTo(laneX(e * 1.5, far.t), far.y); ctx.stroke();
    }
    // 护栏立柱
    for (var q = first; q < st.dist + DEPTH; q += 186) {
      var pp = proj(q - st.dist), hw2 = 1.5 * LANE_SP * pp.t;
      for (var sd = -1; sd <= 1; sd += 2) {
        px(ctx, W / 2 + sd * hw2 - 2, pp.y - 34 * pp.t, 4, 34 * pp.t, 'rgba(90,190,230,.6)');
      }
    }
    // 地平线雾
    var fog = ctx.createLinearGradient(0, hy - 30, 0, hy + 60);
    fog.addColorStop(0, 'rgba(141,123,168,0)'); fog.addColorStop(0.5, 'rgba(141,123,168,.5)');
    fog.addColorStop(1, 'rgba(141,123,168,0)');
    ctx.fillStyle = fog; ctx.fillRect(0, hy - 30, W, 90);
  }
  function drawBarrier(ctx, x, y, s) {
    var w = LANE_SP * 0.80 * s, h = 50 * s;
    px(ctx, x - w / 2, y - h, w, h, '#e08a24');
    for (var i = 0; i < 5; i++) px(ctx, x - w / 2 + i * w / 5, y - h, w / 10, h, '#f7f0dc');
    px(ctx, x - w / 2, y - h, w, 5 * s, '#ffd06a');
  }
  function drawBeam(ctx, x, y, s) {
    var w = LANE_SP * 0.86 * s, top = y - 96 * s, bh = 18 * s;
    px(ctx, x - w / 2, y - 96 * s, 8 * s, 96 * s, '#6b7590');
    px(ctx, x + w / 2 - 8 * s, y - 96 * s, 8 * s, 96 * s, '#6b7590');
    px(ctx, x - w / 2, top, w, bh, '#ffcf3f');
    for (var i = 0; i < 6; i++) px(ctx, x - w / 2 + i * w / 6, top, w / 12, bh, '#3a3f52');
  }
  function drawBlock(ctx, x, y, s) {
    var w = LANE_SP * 0.86 * s, h = 132 * s;
    px(ctx, x - w / 2, y - h, w, h, '#a6383f');
    px(ctx, x - w / 2, y - h, w, 16 * s, '#d45a54');
    px(ctx, x - w / 2, y - h * 0.66, w, 34 * s, '#1e2942');
    px(ctx, x - w / 2 + 8 * s, y - h * 0.62, w - 16 * s, 26 * s, 'rgba(120,190,230,.5)');
    px(ctx, x - w / 2, y - 6 * s, w, 6 * s, '#5c1f28');
    px(ctx, x - 7 * s, y - h * 0.34, 14 * s, 14 * s, '#ffd470');
  }
  function drawPick(ctx, p) {
    var dz = p.z - st.dist;
    if (dz < -60 || dz > DEPTH) return;
    var pr = proj(dz), x = laneX(p.lane - 1, pr.t), s = pr.t;
    var bob = Math.sin(st.t * 4 + p.ph) * 4 * s;
    var y = pr.y - 46 * s + bob;
    if (p.kind === 'coin') {
      var w = 6 + 13 * Math.abs(Math.cos(st.t * 3.2 + p.ph));
      ctx.save();
      ctx.shadowColor = 'rgba(255,196,48,.8)'; ctx.shadowBlur = 12 * s;
      U.roundRect(ctx, x - w * s / 2, y - 11 * s, w * s, 22 * s, w * s / 2);
      ctx.fillStyle = '#ffcf3f'; ctx.fill();
      ctx.restore();
      px(ctx, x - 2 * s, y - 6 * s, 3 * s, 11 * s, '#fff2b0');
    } else {
      var col = p.kind === 'magnet' ? '#46e08a' : (p.kind === 'shield' ? '#3fd6ff' : '#ffb02e');
      var sz = 30 * s;
      U.roundRect(ctx, x - sz / 2, y - sz / 2, sz, sz, 7 * s);
      ctx.fillStyle = col; ctx.fill();
      ctx.fillStyle = '#08121e'; ctx.font = '900 ' + Math.max(8, 17 * s) + 'px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'magnet' ? '◎' : (p.kind === 'shield' ? '⬡' : '×2'), x, y);
    }
  }
  function drawPlayer(ctx) {
    var p = proj(0), x = laneX(st.laneX, 1), y = p.y - st.jumpY;
    var sliding = st.slideT > 0;
    var h = sliding ? CHAR_SLIDE_H : CHAR_H;
    var blink = st.invuln > 0 ? (0.35 + 0.65 * Math.abs(Math.sin(st.t * 24))) : 1;
    var run = Math.sin(st.t * 20), lean = (st.lane - st.laneX) * 7;
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(x, y); ctx.rotate(lean * Math.PI / 180);

    // 影子
    ctx.fillStyle = 'rgba(6,10,22,.38)';
    ctx.beginPath(); ctx.ellipse(0, st.jumpY + 3, 30 - st.jumpY * 0.05, 8, 0, 0, Math.PI * 2); ctx.fill();

    if (sliding) {
      px(ctx, -26, -h + 6, 52, h - 6, '#e33b3b');
      px(ctx, -28, -h + 2, 22, 12, '#f5c19b');
      px(ctx, -30, -4, 56, 5, '#20242e');
    } else {
      var sw = Math.round(run * 6);
      px(ctx, -13, -30, 11, 24 - sw, '#2b47a8');
      px(ctx, 3, -30, 11, 24 + sw, '#3457c4');
      px(ctx, -16, -8 - sw, 14, 6, '#20242e');
      px(ctx, 3, -8 + sw, 14, 6, '#20242e');
      px(ctx, -14, -64, 28, 36, '#e33b3b');
      px(ctx, -20, -60 + sw, 7, 22, '#f0b48c');
      px(ctx, 13, -60 - sw, 7, 22, '#f0b48c');
      px(ctx, -11, -78, 22, 17, '#f5c19b');
      px(ctx, -12, -82, 24, 8, '#5b3524');
      px(ctx, -13, -80, 26, 3, '#35201a');
    }
    if (st.shield > 0) {
      ctx.strokeStyle = 'rgba(63,214,255,.75)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -h / 2, 44, 0, Math.PI * 2); ctx.stroke();
    }
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
  function hud(ctx) {
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff'; ctx.font = '900 30px "PingFang SC",sans-serif';
    ctx.fillText(String(Math.floor(st.score)), 20, 16);
    ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.font = '700 12px "PingFang SC",sans-serif';
    ctx.fillText(Math.floor(st.dist) + ' m', 21, 50);

    ctx.textAlign = 'right'; ctx.fillStyle = '#ffd04a'; ctx.font = '900 22px "PingFang SC",sans-serif';
    ctx.fillText('◈ ' + st.coinsGot, W - 20, 18);

    var hw = 24, total = st.maxLives * hw, hx0 = W / 2 - total / 2 + hw / 2;
    for (var k = 0; k < st.maxLives; k++) heart(ctx, hx0 + k * hw, 24, 9, k < st.lives ? '#ff4f66' : 'rgba(255,79,102,.22)');

    // 限时 buff：只显示图标 + 剩余时间条，不堆说明小字
    var bx = 20, by = 76;
    function buff(txt, left, max, col) {
      if (left <= 0) return;
      px(ctx, bx, by, 30, 22, 'rgba(8,14,28,.72)');
      ctx.fillStyle = col; ctx.font = '900 14px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(txt, bx + 15, by + 4);
      px(ctx, bx + 34, by + 9, 46, 4, 'rgba(255,255,255,.2)');
      px(ctx, bx + 34, by + 9, 46 * U.clamp(left / max, 0, 1), 4, col);
      bx += 92;
    }
    ctx.textAlign = 'left';
    buff('◎', st.magnetT, MAGNET_T, '#46e08a');
    buff('×2', st.doubleT, DOUBLE_T, '#ffb02e');
    if (st.shield > 0) {
      px(ctx, bx, by, 30, 22, 'rgba(8,14,28,.72)');
      ctx.fillStyle = '#3fd6ff'; ctx.font = '900 14px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.fillText('⬡×' + st.shield, bx + 15, by + 4);
    }

    for (var i = 0; i < st.pops.length; i++) {
      var o = st.pops[i];
      ctx.save(); ctx.globalAlpha = Math.min(1, o.life * 1.6);
      ctx.fillStyle = o.col; ctx.font = '900 22px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(o.txt, W / 2, H * 0.52 - (0.9 - o.life) * 50);
      ctx.restore();
    }
  }

  function draw(ctx, t) {
    if (!st) return;
    syncWH();
    ctx.imageSmoothingEnabled = true;
    drawSky(ctx);
    ctx.save();
    if (st.shake > 0) ctx.translate((Math.random() - 0.5) * 6, 0);
    drawTrack(ctx);

    // 从远到近：先画每排障碍，再画同排前后的金币，最后画角色
    var objs = [];
    for (var i = 0; i < st.rows.length; i++) objs.push({ z: st.rows[i].z, kind: 'row', o: st.rows[i] });
    for (var k = 0; k < st.picks.length; k++) if (!st.picks[k].got) objs.push({ z: st.picks[k].z, kind: 'pick', o: st.picks[k] });
    objs.push({ z: -1, kind: 'player', o: null });
    objs.sort(function (a, b) { return b.z - a.z; });

    for (var j = 0; j < objs.length; j++) {
      var item = objs[j], dz = item.z - st.dist;
      if (item.kind === 'player') { drawPlayer(ctx); continue; }
      if (dz > DEPTH || dz < -80) continue;
      var pr = proj(dz), s = pr.t;
      if (item.kind === 'pick') { drawPick(ctx, item.o); continue; }
      for (var c = 0; c < 3; c++) {
        var cell = item.o.cells[c];
        if (!cell) continue;
        var cx = laneX(c - 1, s);
        if (cell === 'barrier') drawBarrier(ctx, cx, pr.y, s);
        else if (cell === 'beam') drawBeam(ctx, cx, pr.y, s);
        else drawBlock(ctx, cx, pr.y, s);
      }
    }
    ctx.restore();
    hud(ctx);
  }

  // ---------- 对外接口 ----------
  return {
    bgColor: '#252a45',
    init: init, start: start, restart: restart, update: update, draw: draw,
    cashOut: cashOut, finish: finish, setEndHook: setEndHook,
    move: move, jump: jump, slide: slide, setPaused: setPaused,
    state: function () { return st; }, best: best,
    shopData: function () { return { wallet: B.U.coins(), up: loadUp(), defs: UP }; },
    wallet: function () { return B.U.coins(); }, upgrades: loadUp, shopDefs: function () { return UP; },
    costOf: costOf, canBuy: canBuy, buy: buy,
    cfg: function () {
      return { SPEED0: SPEED0, SPEED_MAX: SPEED_MAX, JUMP_V: JUMP_V, GRAV: GRAV,
        SLIDE_T: SLIDE_T, LANE_SP: LANE_SP, HIT_FAR: HIT_FAR, HIT_NEAR: HIT_NEAR, PERSP: PERSP };
    }
  };
})();

// 注册到合集：大厅只认 B.Games 这张表，不用改任何 UI 代码就自动多一张卡。
if (B.Games && B.Games.add) {
  B.Games.add({
    id: 'rail', name: '轨道狂奔', category: '动作', icon: '▰',
    desc: '三条轨道往前跑，换道跳滑躲障碍。',
    resume: function () { B.UI.startRail(); },
    enter: function () { B.UI.startRail(); },
    shop: function () { B.UI.show('screenRailShop'); }
  });
}

// rail.js —— 轨道狂奔：三轨透视无尽跑酷（第四个独立游戏）
//
// v34 重做：
// 视觉 —— 障碍 / 角色 / 灯柱不再是贴在地上的平面矩形，而是按同一套透视公式算出
//   近面 + 远面 + 顶面 + 侧面，有体积、有厚度、有受光明暗；镜头随换道横移与侧倾，
//   掠过的灯柱和跨轨拱门给纵深参照，速度线给速度感。
// 机制 —— 不再「每排留空道 + 金币全放安全道」那种躺平就能零伤的屏保：
//   金币串放在有障碍的道上（要跳 / 要滑才吃得到），安全道只留一枚引导币；
//   跳过 / 钻过 / 贴着车厢擦过去都攒连击，连击抬高得分与金币价值，撞一次清零；
//   障碍按 2–4 排一组的小节生成（之字换道 / 连跳 / 跳接滑 / 双道封堵 / 冲刺段），有读谱与节奏。
// 保留 —— 公平性硬约束（每排至少一条空道、相邻安全道只差 0 或 1）、默认 3 条命、
//   三种局内 buff、四项永久强化、统一金库、无尽模式。
var B = window.B = window.B || {};

B.Rail = (function () {
  var U = B.U;

  var W = 1100, H = 620;
  function syncWH() { W = B.C.W; H = B.C.H; }

  // ---------- 透视：所有立体几何共用 ----------
  // t 是这一深度的缩放，y 是这一深度的地面屏幕坐标。盒子的近面 / 远面各取一次
  // 投影，顶面与侧面就能自然收敛到灭点，而不是贴一张矩形。
  var HORIZON = 0.30, GROUND = 0.84;
  var PERSP = 620, DEPTH = 1900;
  var LANE_SP = 176;
  function proj(dz) {
    var t = PERSP / (PERSP + Math.max(0, dz));
    return { t: t, y: H * HORIZON + (H * GROUND - H * HORIZON) * t };
  }
  function laneX(lf, t) { return W / 2 + lf * LANE_SP * t + (st ? st.camShift * t : 0); }

  // ---------- 速度 / 物理 ----------
  var SPEED0 = 470, SPEED_MAX = 1040, SPEED_ACC = 9;
  var GRAV = 2700, JUMP_V = 940, SLIDE_T = 0.62;
  var LANE_LERP = 13;
  var CHAR_H = 78, CHAR_SLIDE_H = 34;
  var HIT_FAR = 28, HIT_NEAR = -34, PICK_R = 36;
  var MAGNET_T = 8, DOUBLE_T = 8, INVULN_T = 1.25;
  var COMBO_STEP = 6, COMBO_CAP = 20;

  // ---------- 配色：深色夜景 + 克制霓虹 ----------
  var C = {
    sky0: '#050812', sky1: '#0d1730', sky2: '#1c2b4c', sky3: '#050812',
    cityFar: 'rgba(14,24,48,.86)', cityNear: 'rgba(9,16,34,.94)',
    win: 'rgba(120,205,255,.42)',
    track: '#111a2d', lane: '#16203a', laneOn: '#1d2c4c',
    rail: 'rgba(77,226,255,.55)', sleeper: 'rgba(4,9,18,.62)', fog: 'rgba(48,74,116,.42)',
    amber: '#ff9f43', amberLit: '#ffd08a', amberDark: '#a8581c',
    lemon: '#ffd84a', lemonLit: '#fff0a8', lemonDark: '#a67c12',
    crimson: '#e8445c', crimsonLit: '#ff8290', crimsonDark: '#7d1d2e',
    gold: '#ffc44d', goldLit: '#fff0b8', goldDark: '#a9700d',
    body: '#c3d9f2', bodyLit: '#e6f2ff', bodyShade: '#3c5b85', visor: '#4de2ff',
    scarf: '#ff9f43',
    shield: '#4de2ff', magnet: '#7af7c0', dbl: '#ffc44d',
    text: '#eaf3ff', dim: 'rgba(234,243,255,.42)'
  };

  // ---------- 小节模式：读谱 → 执行 ----------
  // busy = 堵几条道（0 = 冲刺段无障碍）；delta = 安全道相对上一排挪几格；
  // types = 障碍类型模板，'mix' 当场抽；min = 多少秒后才可能出现。
  var PATTERNS = [
    { id: 'breath', len: 2, busy: [1, 1], delta: [0, 0], types: ['bar', 'bar'], w: 3, min: 0 },
    { id: 'dash', len: 3, busy: [0, 0, 0], delta: [0, 0, 0], types: [null, null, null], w: 2, min: 0 },
    { id: 'zig', len: 3, busy: [2, 2, 2], delta: [1, 1, -1], types: ['mix', 'mix', 'mix'], w: 3, min: 12 },
    { id: 'jump2', len: 2, busy: [1, 1], delta: [0, 0], types: ['bar', 'bar'], w: 3, min: 10 },
    { id: 'jumpslide', len: 2, busy: [1, 1], delta: [0, 0], types: ['bar', 'beam'], w: 3, min: 14 },
    { id: 'pinch', len: 2, busy: [2, 1], delta: [0, 1], types: ['block', 'mix'], w: 2, min: 22 }
  ];

  // ---------- 永久强化 + 存档 ----------
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
  function poly(ctx, pts, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function line(ctx, x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  function glowDot(ctx, x, y, r, color) {
    if (r < 0.5) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // 一个有体积的透视盒子：近面 / 远面各取一次投影，顶面连两条上边、侧面连两条侧边。
  function box3d(ctx, lf, dz, w, h, d, col, opt) {
    opt = opt || {};
    var near = proj(Math.max(0, dz - d / 2));
    var far = proj(dz + d / 2);
    var nx = laneX(lf, near.t), fx = laneX(lf, far.t);
    var nw = w * near.t / 2, fw = w * far.t / 2;
    // opt.lift = 盒子底部离地高度（拱门横梁这类悬空物用）
    var ny = near.y - (opt.lift || 0) * near.t;
    var fy = far.y - (opt.lift || 0) * far.t;
    var nh = h * near.t, fh = h * far.t;
    if (nw < 0.4) return null;
    var sideCol = col.side || col.front;
    if (lf >= 0) poly(ctx, [[nx - nw, ny - nh], [fx - fw, fy - fh], [fx - fw, fy], [nx - nw, ny]], sideCol);
    if (lf <= 0) poly(ctx, [[nx + nw, ny - nh], [fx + fw, fy - fh], [fx + fw, fy], [nx + nw, ny]], sideCol);
    poly(ctx, [[nx - nw, ny - nh], [nx + nw, ny - nh], [fx + fw, fy - fh], [fx - fw, fy - fh]], col.top || col.front);
    poly(ctx, [[nx - nw, ny - nh], [nx + nw, ny - nh], [nx + nw, ny], [nx - nw, ny]], col.front);
    if (opt.edge) {
      ctx.strokeStyle = opt.edge; ctx.lineWidth = Math.max(0.6, 1.6 * near.t);
      ctx.beginPath();
      ctx.moveTo(nx - nw, ny - nh); ctx.lineTo(nx + nw, ny - nh);
      ctx.moveTo(fx - fw, fy - fh); ctx.lineTo(fx + fw, fy - fh);
      ctx.moveTo(nx - nw, ny - nh); ctx.lineTo(fx - fw, fy - fh);
      ctx.moveTo(nx + nw, ny - nh); ctx.lineTo(fx + fw, fy - fh);
      ctx.stroke();
    }
    return { nx: nx, ny: ny, nw: nw, nh: nh, t: near.t, fx: fx, fy: fy, fw: fw, fh: fh };
  }

  // ---------- 生成 ----------
  function randomType() {
    var r = Math.random();
    if (r < 0.38) return 'barrier';
    if (r < 0.68) return 'beam';
    return st.t < 14 ? 'barrier' : 'block';
  }
  function pickPattern() {
    var pool = [], total = 0, i;
    for (i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      if (st.t < p.min || p.id === st.lastPatternId) continue;
      pool.push(p); total += p.w;
    }
    if (!pool.length) { pool = [PATTERNS[0]]; total = PATTERNS[0].w; }
    var r = Math.random() * total;
    for (i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) break; }
    var chosen = pool[Math.min(i, pool.length - 1)];
    st.lastPatternId = chosen.id;
    st.patternCount++;
    return { def: chosen, idx: 0 };
  }
  function spawnRow() {
    if (!st.pat || st.pat.idx >= st.pat.def.len) st.pat = pickPattern();
    var def = st.pat.def, i = st.pat.idx++;
    var z = st.nextRowZ;
    var prev = st.safeLane;
    var safe = U.clamp(prev + (def.delta[i] || 0), 0, 2);
    st.safeLane = safe;

    var cells = [null, null, null];
    var others = [0, 1, 2].filter(function (n) { return n !== safe; });
    var busy = def.busy[i];
    for (var k = 0; k < busy; k++) {
      var ty = def.types[i];
      if (ty === 'mix') ty = randomType();
      else if (ty === 'bar') ty = 'barrier';
      else if (ty === 'beam') ty = 'beam';
      else if (ty === 'block') ty = st.t < 14 ? 'barrier' : 'block';
      if (!ty) ty = randomType();
      cells[others[k]] = ty;
    }
    var empty = 0;
    for (var e = 0; e < 3; e++) if (!cells[e]) empty++;
    if (empty === 0 || Math.abs(safe - prev) > 1) st.genBad++;
    st.rows.push({ z: z, cells: cells, hit: false, safe: safe });

    // 金币串放在「有障碍的道」上：想吃满就得跳 / 滑着穿过去，不能一路躺平换到空道。
    var riskLanes = [];
    for (var c = 0; c < 3; c++) if (cells[c] && cells[c] !== 'block') riskLanes.push(c);
    if (!riskLanes.length) for (c = 0; c < 3; c++) if (cells[c]) riskLanes.push(c);
    var coinLane = riskLanes.length ? riskLanes[Math.floor(Math.random() * riskLanes.length)]
      : Math.floor(Math.random() * 3);
    var dash = busy === 0;
    var powerAt = (!dash && st.rowCount % 7 === 4) ? 2 : -1;
    var kinds = ['magnet', 'shield', 'double'];
    var power = kinds[Math.floor(Math.random() * kinds.length)];
    var lanes = dash ? [0, 1, 2, 0, 1, 2] : [coinLane, coinLane, coinLane, coinLane, coinLane, safe];
    for (var q = 0; q < lanes.length; q++) {
      var pz = z - 170 + q * (dash ? 62 : 56);
      if (q === powerAt) st.picks.push({ z: pz, lane: coinLane, kind: power, got: false, ph: q * 0.7 });
      else st.picks.push({ z: pz, lane: lanes[q], kind: 'coin', got: false, ph: (z + q) * 0.013 });
    }
    st.rowCount++;
    if (dash) st.dashT = 1.1;
    st.nextRowZ += U.clamp(st.speed * 0.80, 320, 640) * (dash ? 0.86 : 1);
  }
  function ensureRows() {
    var guard = 0;
    while (st.nextRowZ < st.dist + DEPTH + 300 && guard++ < 40) spawnRow();
  }

  // ---------- 生命周期 ----------
  function start() {
    syncWH();
    var up = loadUp();
    st = {
      t: 0, dist: 0, speed: SPEED0, score: 0, best: best(),
      lane: 0, laneX: 0, jumpY: 0, jumpVy: 0, onGround: true, slideT: 0,
      camShift: 0, roll: 0,
      lives: 3 + (up.heart || 0), maxLives: 3 + (up.heart || 0),
      shield: up.shield || 0, invuln: 0, shake: 0,
      magnetLv: up.magnet || 0, scoreMul: 1 + 0.08 * (up.boost || 0),
      magnetT: 0, doubleT: 0, dashT: 0,
      combo: 0, comboBest: 0, grazes: 0, coinMul: 1,
      coinsGot: 0, banked: false, bankedTotal: 0, bonus: 0,
      rows: [], picks: [], pops: [],
      nextRowZ: 720, rowCount: 0, safeLane: 1,
      pat: null, lastPatternId: '', patternCount: 0,
      dead: false, paused: false, genBad: 0, hits: 0, picked: 0, powers: 0, passed: 0
    };
    ensureRows();
    return st;
  }
  function init() { return start(); }
  function restart() { cashOut(); return start(); }

  // 阵亡 / 按 R 重来 / 退大厅三条路都走这里，只记一次，绝不吞金币。
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
      powers: st.powers, lives: st.lives, combo: st.comboBest
    });
  }
  function setEndHook(fn) { endHook = fn; }
  function setPaused(v) { if (st) st.paused = !!v; }

  // ---------- 输入：全是离散动作 ----------
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

  // ---------- 连击 / 伤害 ----------
  function graze() {
    st.combo++;
    st.grazes++;
    if (st.combo > st.comboBest) st.comboBest = st.combo;
    st.coinMul = 1 + Math.floor(st.combo / COMBO_STEP);
    if (st.combo % 5 === 0) pop('连击 ×' + comboMul().toFixed(2), C.visor);
  }
  function comboMul() { return 1 + Math.min(st.combo, COMBO_CAP) * 0.05; }
  function hit() {
    if (!st || st.dead || st.invuln > 0) return;
    st.hits++;
    st.combo = 0; st.coinMul = 1;
    if (st.shield > 0) { st.shield--; st.invuln = INVULN_T; st.shake = 0.24; sfx('brk'); return; }
    st.lives--; st.invuln = INVULN_T; st.shake = 0.42; sfx('lose');
    if (st.lives <= 0) finish();
  }
  function pop(txt, col) { st.pops.push({ txt: txt, col: col, life: 0.9 }); }

  // ---------- 每帧 ----------
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
    if (st.dashT > 0) st.dashT = Math.max(0, st.dashT - dt);
    if (st.slideT > 0) st.slideT = Math.max(0, st.slideT - dt);

    st.speed = Math.min(SPEED_MAX, (SPEED0 + SPEED_ACC * st.t) * (st.dashT > 0 ? 1.12 : 1));
    st.dist += st.speed * dt;
    st.score += st.speed * dt / 10 * st.scoreMul * comboMul() * (st.doubleT > 0 ? 2 : 1);

    // 换道插值只管画面，判定用离散 st.lane（按了方向键就该立刻生效）。
    st.laneX += (st.lane - st.laneX) * Math.min(1, LANE_LERP * dt);
    if (Math.abs(st.lane - st.laneX) < 0.002) st.laneX = st.lane;
    st.camShift += (-st.laneX * 20 - st.camShift) * Math.min(1, 6 * dt);
    st.roll += ((st.lane - st.laneX) * 0.035 - st.roll) * Math.min(1, 7 * dt);

    if (!st.onGround) {
      st.jumpVy -= GRAV * dt;
      st.jumpY += st.jumpVy * dt;
      if (st.jumpY <= 0) { st.jumpY = 0; st.jumpVy = 0; st.onGround = true; }
    }

    ensureRows();
    for (var ri = st.rows.length - 1; ri >= 0; ri--) if (st.rows[ri].z - st.dist < -220) st.rows.splice(ri, 1);
    for (var ci = st.picks.length - 1; ci >= 0; ci--) if (st.picks[ci].z - st.dist < -220) st.picks.splice(ci, 1);

    // 障碍：每排只判一次。空道贴着车厢过、跳过低栏、钻过横杆都算擦身连击。
    var li = st.lane + 1;
    for (var i = 0; i < st.rows.length; i++) {
      var row = st.rows[i], dz = row.z - st.dist;
      if (row.hit || dz > HIT_FAR || dz < HIT_NEAR) continue;
      row.hit = true; st.passed++;
      if (li < 0 || li > 2) continue;
      var cell = row.cells[li];
      if (!cell) {
        if ((li > 0 && row.cells[li - 1] === 'block') || (li < 2 && row.cells[li + 1] === 'block')) graze();
        continue;
      }
      if (cell === 'barrier' && st.jumpY > 56) { graze(); continue; }
      if (cell === 'beam' && st.slideT > 0) { graze(); continue; }
      hit();
      if (st.dead) return;
    }

    // 拾取：同轨（或磁石覆盖）。金币价值随连击涨。
    var reach = st.magnetT > 0 ? 2 : (st.magnetLv >= 3 ? 1 : 0);
    for (var k = 0; k < st.picks.length; k++) {
      var p = st.picks[k];
      if (p.got) continue;
      var pdz = p.z - st.dist;
      if (pdz < -PICK_R || pdz > PICK_R) continue;
      if (Math.abs(p.lane - li) > reach) continue;
      p.got = true; st.picked++;
      if (p.kind === 'coin') { st.coinsGot += st.coinMul; sfx('coin'); }
      else {
        st.powers++;
        if (p.kind === 'magnet') { st.magnetT = MAGNET_T; pop('◎ 磁石', C.magnet); }
        else if (p.kind === 'shield') { st.shield++; pop('⬡ 护盾', C.shield); }
        else { st.doubleT = DOUBLE_T; pop('×2 双倍分', C.dbl); }
        sfx('buy');
      }
    }
  }

  // ---------- 天空 ----------
  function drawSky(ctx) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.sky0); g.addColorStop(0.42, C.sky1);
    g.addColorStop(0.72, C.sky2); g.addColorStop(1, C.sky3);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    glowDot(ctx, W * 0.72, H * 0.285, 150, 'rgba(255,186,120,.14)');
    glowDot(ctx, W * 0.72, H * 0.285, 46, 'rgba(255,214,160,.22)');
    for (var layer = 0; layer < 2; layer++) {
      var sp = layer ? 0.045 : 0.018;
      var off = -((st.dist * sp) % 180);
      var col = layer ? C.cityNear : C.cityFar;
      ctx.save(); ctx.translate(off, 0);
      for (var i = -1; i < 11; i++) {
        var bw = 46 + ((i * 37 + layer * 13) % 4) * 15;
        var bh = (layer ? 34 : 56) + ((i * 53 + layer * 29) % 6) * 24;
        var bx = i * 180 - (layer ? 40 : 0), by = H * HORIZON - bh;
        px(ctx, bx, by, bw, bh, col);
        if (i % 3 === 0) px(ctx, bx + bw / 2, by - 16, 2, 16, col);
        for (var wy = 8; wy < bh - 10; wy += 17)
          for (var wx = 7; wx < bw - 7; wx += 19)
            if ((wx + wy * 2 + i * 7 + layer * 5) % 5 < 2)
              px(ctx, bx + wx, by + wy, 3, 5, C.win);
      }
      ctx.restore();
    }
  }

  // ---------- 轨道 ----------
  function drawTrack(ctx) {
    var hy = H * HORIZON, gy = H * GROUND;
    var far = proj(DEPTH);
    var hw = 1.5 * LANE_SP;
    poly(ctx, [[W / 2 - hw, gy], [W / 2 + hw, gy],
      [laneX(1.5, far.t), far.y], [laneX(-1.5, far.t), far.y]], C.track);
    for (var l = -1; l <= 1; l++) {
      poly(ctx, [[laneX(l - 0.5, 1), gy], [laneX(l + 0.5, 1), gy],
        [laneX(l + 0.5, far.t), far.y], [laneX(l - 0.5, far.t), far.y]],
        l === st.lane ? C.laneOn : C.lane);
    }
    var step = 48, first = Math.floor(st.dist / step) * step;
    for (var z = first + step; z < st.dist + DEPTH; z += step) {
      var p = proj(z - st.dist), p2 = proj(z - st.dist + 14);
      if (p.y < far.y + 2) continue;
      poly(ctx, [[laneX(-1.5, p.t), p.y], [laneX(1.5, p.t), p.y],
        [laneX(1.5, p2.t), p2.y], [laneX(-1.5, p2.t), p2.y]], C.sleeper);
    }
    for (var s = -1; s <= 1; s += 2) {
      line(ctx, laneX(s * 0.5, 1), gy, laneX(s * 0.5, far.t), far.y, 'rgba(77,226,255,.18)', 1.5);
      line(ctx, laneX(s * 1.5, 1), gy, laneX(s * 1.5, far.t), far.y, C.rail, 2.5);
    }
    var fog = ctx.createLinearGradient(0, hy - 36, 0, hy + 74);
    fog.addColorStop(0, 'rgba(48,74,116,0)'); fog.addColorStop(0.5, C.fog);
    fog.addColorStop(1, 'rgba(48,74,116,0)');
    ctx.fillStyle = fog; ctx.fillRect(0, hy - 36, W, 110);

    // 地面预告：下一排安全道在远处就亮起来，高速下也读得懂
    for (var r = 0; r < st.rows.length; r++) {
      var row = st.rows[r], dz = row.z - st.dist;
      if (row.hit || dz < 120 || dz > 900) continue;
      var pr = proj(dz), lf = row.safe - 1;
      var cw = LANE_SP * 0.52 * pr.t;
      var cx = laneX(lf, pr.t);
      poly(ctx, [[cx - cw, pr.y - 2], [cx + cw, pr.y - 2],
        [cx + cw * 0.72, pr.y - 26 * pr.t], [cx - cw * 0.72, pr.y - 26 * pr.t]],
        'rgba(77,226,255,.10)');
      line(ctx, cx - cw, pr.y - 2, cx + cw, pr.y - 2, 'rgba(77,226,255,.34)', Math.max(1, 2 * pr.t));
      break;
    }
  }

  // ---------- 障碍：全部立体 ----------
  function drawBarrier(ctx, lf, dz) {
    // 厚度给到 96，顶面才真的看得出是一块实体，而不是贴在地上的一张条纹纸
    var f = box3d(ctx, lf, dz, LANE_SP * 0.84, 62, 96,
      { front: C.amber, top: C.amberLit, side: C.amberDark });
    if (!f) return;
    // 顶面顺深度方向的条纹
    for (var t = 0; t < 6; t++) {
      var a = f.nx - f.nw + (t + 0.22) * f.nw * 2 / 6;
      var a2 = f.fx - f.fw + (t + 0.22) * f.fw * 2 / 6;
      var bw = f.nw * 2 / 12, bw2 = f.fw * 2 / 12;
      poly(ctx, [[a, f.ny - f.nh], [a + bw, f.ny - f.nh],
        [a2 + bw2, f.fy - f.fh], [a2, f.fy - f.fh]], 'rgba(255,246,222,.72)');
    }
    // 正面斜条纹
    ctx.save();
    ctx.beginPath(); ctx.rect(f.nx - f.nw, f.ny - f.nh, f.nw * 2, f.nh); ctx.clip();
    for (var i = -2; i < 9; i++) {
      var x = f.nx - f.nw + i * f.nw * 0.42;
      poly(ctx, [[x, f.ny], [x + f.nw * 0.2, f.ny],
        [x + f.nw * 0.2 + f.nh * 0.5, f.ny - f.nh], [x + f.nh * 0.5, f.ny - f.nh]],
        'rgba(255,248,225,.88)');
    }
    ctx.restore();
    line(ctx, f.nx - f.nw, f.ny - f.nh, f.nx + f.nw, f.ny - f.nh, '#fff3d6', 2 * f.t);
    // 两侧端面立柱，强调这是一道有厚度的护栏
    px(ctx, f.nx - f.nw - 4 * f.t, f.ny - f.nh - 12 * f.t, 8 * f.t, 12 * f.t, C.amberLit);
    px(ctx, f.nx + f.nw - 4 * f.t, f.ny - f.nh - 12 * f.t, 8 * f.t, 12 * f.t, C.amberLit);
  }
  function drawBeam(ctx, lf, dz) {
    // 两根立柱撑起一根浮空的横梁，中间留出能钻过去的洞
    box3d(ctx, lf - 0.36, dz, 24, 112, 34,
      { front: '#5b6a88', top: '#8496b6', side: '#333f58' });
    box3d(ctx, lf + 0.36, dz, 24, 112, 34,
      { front: '#5b6a88', top: '#8496b6', side: '#333f58' });
    var near = proj(Math.max(0, dz - 13)), far = proj(dz + 13);
    var nx = laneX(lf, near.t), fx = laneX(lf, far.t);
    var nw = LANE_SP * 0.46 * near.t, fw = LANE_SP * 0.46 * far.t;
    var botN = near.y - 112 * near.t, botF = far.y - 112 * far.t;
    var topN = botN - 24 * near.t, topF = botF - 24 * far.t;
    poly(ctx, [[nx - nw, topN], [nx + nw, topN], [fx + fw, topF], [fx - fw, topF]], C.lemonLit);
    poly(ctx, [[nx - nw, topN], [fx - fw, topF], [fx - fw, botF], [nx - nw, botN]], C.lemonDark);
    poly(ctx, [[nx + nw, topN], [fx + fw, topF], [fx + fw, botF], [nx + nw, botN]], C.lemonDark);
    poly(ctx, [[nx - nw, topN], [nx + nw, topN], [nx + nw, botN], [nx - nw, botN]], C.lemon);
    for (var i = 0; i < 7; i++) {
      var x = nx - nw + (i + 0.5) * nw * 2 / 7;
      px(ctx, x - 3 * near.t, topN + 3 * near.t, Math.max(1, 6 * near.t),
        Math.max(1, 18 * near.t), C.lemonDark);
    }
    line(ctx, nx - nw, topN, nx + nw, topN, 'rgba(255,255,255,.35)', Math.max(0.6, 1.6 * near.t));
  }
  function drawBlock(ctx, lf, dz) {
    var f = box3d(ctx, lf, dz, LANE_SP * 0.9, 154, 190,
      { front: C.crimson, top: C.crimsonLit, side: C.crimsonDark },
      { edge: 'rgba(255,150,165,.45)' });
    if (!f) return;
    var wy = f.ny - f.nh * 0.82, wh = f.nh * 0.34;
    px(ctx, f.nx - f.nw * 0.78, wy, f.nw * 1.56, wh, '#101c34');
    px(ctx, f.nx - f.nw * 0.72, wy + wh * 0.12, f.nw * 1.44, wh * 0.6, 'rgba(110,190,235,.34)');
    px(ctx, f.nx - f.nw * 0.78, f.ny - f.nh * 0.34, f.nw * 1.56, 3 * f.t, 'rgba(0,0,0,.32)');
    glowDot(ctx, f.nx - f.nw * 0.6, f.ny - f.nh * 0.22, 14 * f.t, 'rgba(255,214,130,.42)');
    glowDot(ctx, f.nx + f.nw * 0.6, f.ny - f.nh * 0.22, 14 * f.t, 'rgba(255,214,130,.42)');
    px(ctx, f.nx - f.nw, f.ny - 5 * f.t, f.nw * 2, 6 * f.t, '#2a0e16');
  }

  // ---------- 掠过的灯柱与跨轨拱门 ----------
  function drawPost(ctx, dz, side) {
    var p = proj(dz), x = laneX(side * 1.82, p.t);
    var h = 132 * p.t, w = Math.max(1, 9 * p.t);
    px(ctx, x - w / 2, p.y - h, w, h, 'rgba(38,58,86,.92)');
    px(ctx, x - w / 2, p.y - h, w, Math.max(1, 5 * p.t), C.rail);
    glowDot(ctx, x, p.y - h, 26 * p.t, 'rgba(77,226,255,.30)');
    px(ctx, x - 2 * p.t, p.y - h - 2, Math.max(1, 4 * p.t), Math.max(1, 4 * p.t), '#dff7ff');
  }
  function drawArch(ctx, dz) {
    var t = proj(dz).t;
    ctx.save();
    ctx.globalAlpha = U.clamp(t * 2.6, 0.22, 1);
    box3d(ctx, -1.72, dz, 24, 210, 34,
      { front: '#23395c', top: '#33507a', side: '#111d33' });
    box3d(ctx, 1.72, dz, 24, 210, 34,
      { front: '#23395c', top: '#33507a', side: '#111d33' });
    var f = box3d(ctx, 0, dz, LANE_SP * 3.5, 22, 40,
      { front: '#2b466e', top: '#3d5f8f', side: '#16253e' },
      { lift: 210, edge: 'rgba(77,226,255,.42)' });
    if (f) {
      line(ctx, f.nx - f.nw, f.ny, f.nx + f.nw, f.ny, 'rgba(77,226,255,.45)', Math.max(1, 2 * t));
      px(ctx, f.nx - f.nw * 0.8, f.ny, f.nw * 1.6, Math.max(1, 3 * t), 'rgba(140,225,255,.20)');
    }
    ctx.restore();
  }

  // ---------- 拾取物：有厚度的金币 / buff 晶体 ----------
  function drawPick(ctx, p) {
    var dz = p.z - st.dist;
    if (dz < -60 || dz > DEPTH) return;
    var pr = proj(dz), x = laneX(p.lane - 1, pr.t), s = pr.t;
    var y = pr.y - 52 * s + Math.sin(st.t * 4 + p.ph) * 5 * s;
    if (p.kind === 'coin') {
      var w = 10 + 13 * Math.abs(Math.cos(st.t * 3.2 + p.ph));
      ctx.save();
      ctx.shadowColor = 'rgba(255,196,77,.75)'; ctx.shadowBlur = 14 * s;
      ctx.fillStyle = C.goldDark;
      ctx.beginPath(); ctx.ellipse(x, y + 4 * s, w * s / 2, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.ellipse(x, y, w * s / 2, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      px(ctx, x - 2 * s, y - 7 * s, Math.max(1, 3 * s), 14 * s, C.goldLit);
    } else {
      var col = p.kind === 'magnet' ? C.magnet : (p.kind === 'shield' ? C.shield : C.dbl);
      var sz = 32 * s;
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 16 * s;
      poly(ctx, [[x, y - sz / 2], [x + sz / 2, y], [x, y + sz / 2], [x - sz / 2, y]], col);
      ctx.restore();
      poly(ctx, [[x, y - sz / 2], [x + sz / 2, y], [x, y]], 'rgba(255,255,255,.28)');
      ctx.fillStyle = '#07121e'; ctx.font = '900 ' + Math.max(8, 15 * s) + 'px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'magnet' ? '◎' : (p.kind === 'shield' ? '⬡' : '×2'), x, y);
    }
  }

  // ---------- 角色 ----------
  function drawPlayer(ctx) {
    var p = proj(0), x = laneX(st.laneX, 1), y = p.y - st.jumpY;
    var sliding = st.slideT > 0;
    var h = sliding ? CHAR_SLIDE_H : CHAR_H;
    var run = st.t * 19, swing = Math.sin(run), swing2 = Math.cos(run);
    var alpha = st.invuln > 0 ? (0.38 + 0.62 * Math.abs(Math.sin(st.t * 24))) : 1;

    ctx.fillStyle = 'rgba(2,6,16,' + (0.55 - Math.min(0.34, st.jumpY * 0.003)) + ')';
    ctx.beginPath();
    ctx.ellipse(x, p.y + 4, 33 - st.jumpY * 0.06, 9, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(1.22, 1.22);
    ctx.rotate(st.roll * 0.35);
    ctx.lineCap = 'round';
    var outline = 'rgba(6,12,24,.62)';

    if (sliding) {
      ctx.fillStyle = C.bodyShade;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.36, 33, h * 0.36, -0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.body;
      ctx.beginPath(); ctx.ellipse(-4, -h * 0.5, 26, h * 0.28, -0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.bodyLit;
      ctx.beginPath(); ctx.ellipse(2, -h * 0.58, 18, h * 0.16, -0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.scarf;
      poly(ctx, [[-14, -h * 0.62], [-26, -h * 0.5], [-38 - swing * 5, -h * 0.78], [-18, -h * 0.74]], C.scarf);
      ctx.fillStyle = C.bodyLit;
      ctx.beginPath(); ctx.ellipse(18, -h * 0.66, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.visor;
      ctx.beginPath(); ctx.ellipse(21, -h * 0.68, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
      line(ctx, -28, -3, 26, -3, 'rgba(77,226,255,.55)', 2);
    } else {
      var lift = st.jumpY > 0 ? 1 : 0;
      // 腿：深蓝、带脚掌，跑动时前后摆
      line(ctx, -5, -30, -9 - swing * 10, -6 - (lift ? 9 : 0) + Math.max(0, swing) * 6, C.bodyShade, 11);
      line(ctx, 5, -30, 9 + swing * 10, -6 - (lift ? 9 : 0) + Math.max(0, -swing) * 6, C.bodyShade, 11);
      px(ctx, -17 - swing * 10, -8 - (lift ? 9 : 0), 15, 5, '#1b2c48');
      px(ctx, 3 + swing * 10, -8 - (lift ? 9 : 0), 15, 5, '#1b2c48');
      // 躯干：主面 + 暗面 + 亮面，加一圈深色描边从背景里扣出来
      ctx.strokeStyle = outline; ctx.lineWidth = 2;
      poly(ctx, [[-15, -66], [15, -66], [12, -29], [-12, -29]], C.body);
      ctx.beginPath(); ctx.moveTo(-15, -66); ctx.lineTo(15, -66);
      ctx.lineTo(12, -29); ctx.lineTo(-12, -29); ctx.closePath(); ctx.stroke();
      poly(ctx, [[-15, -66], [-3, -66], [-3, -29], [-12, -29]], 'rgba(60,91,133,.55)');
      poly(ctx, [[6, -64], [14, -64], [11, -31], [5, -31]], C.bodyLit);
      // 胸口能量条
      px(ctx, -6, -55, 12, 3, C.visor);
      // 手臂
      line(ctx, -13, -60, -23 - swing2 * 9, -40 + swing2 * 9, '#a9c6e8', 8);
      line(ctx, 13, -60, 23 + swing2 * 9, -40 - swing2 * 9, '#caddf3', 8);
      // 围巾：从脖子往身后飘，随步伐摆动
      poly(ctx, [[-9, -68], [9, -68], [8, -62], [-9, -62]], C.scarf);
      poly(ctx, [[-7, -67], [-22, -64], [-34 - swing * 6, -70 + swing2 * 4], [-9, -62]], C.scarf);
      // 头 + 面罩
      ctx.fillStyle = C.bodyLit; ctx.strokeStyle = outline; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -76, 12.5, 13.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.visor;
      ctx.beginPath(); ctx.ellipse(3, -77, 8.5, 6, -0.12, 0, Math.PI * 2); ctx.fill();
      glowDot(ctx, 3, -77, 17, 'rgba(77,226,255,.30)');
      if (st.speed > SPEED0 * 1.3) {
        line(ctx, -32, -52, -50 - (st.speed - SPEED0) * 0.02, -52, 'rgba(77,226,255,.32)', 2);
        line(ctx, -30, -43, -42, -43, 'rgba(77,226,255,.20)', 1.5);
      }
    }
    if (st.shield > 0) {
      ctx.strokeStyle = 'rgba(77,226,255,.72)'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.ellipse(0, -h / 2, 38, h * 0.72, 0, 0, Math.PI * 2); ctx.stroke();
      glowDot(ctx, 0, -h / 2, 46, 'rgba(77,226,255,.10)');
    }
    ctx.restore();
  }

  // ---------- 近景地面：把轨道下沿接到画布底，消除和留白之间的硬色带 ----------
  function drawFore(ctx) {
    var gy = H * GROUND;
    var g = ctx.createLinearGradient(0, gy - 28, 0, H);
    g.addColorStop(0, 'rgba(10,18,34,0)');
    g.addColorStop(0.34, 'rgba(9,15,30,.88)');
    g.addColorStop(1, '#050812');
    ctx.fillStyle = g; ctx.fillRect(0, gy - 28, W, H - gy + 28);
    var step = 120, first = Math.floor(st.dist / step) * step;
    for (var z = first + step; z < st.dist + 520; z += step) {
      var q = (z - st.dist) / 520;
      var y = gy + (H - gy) * (1 - q) * (1 - q);
      line(ctx, 0, y, W, y, 'rgba(77,226,255,' + (0.03 * (1 - q)) + ')', 1);
    }
  }

  // ---------- 速度线 ----------
  function drawSpeedLines(ctx) {
    var ratio = (st.speed - SPEED0) / (SPEED_MAX - SPEED0);
    if (ratio < 0.12) return;
    var n = Math.floor(6 + ratio * 16);
    for (var i = 0; i < n; i++) {
      var seed = (i * 97 + Math.floor(st.dist / 34) * 13) % 1000 / 1000;
      var y = H * 0.16 + seed * H * 0.68;
      var side = i % 2 ? 1 : -1;
      var x0 = W / 2 + side * (W * 0.24 + seed * W * 0.2);
      var len = (26 + ratio * 90) * (0.5 + seed);
      ctx.strokeStyle = 'rgba(150,205,255,' + (0.03 + ratio * 0.09) + ')';
      ctx.lineWidth = 1 + ratio;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + side * len, y + side * 3); ctx.stroke();
    }
  }

  // ---------- HUD：细字重 + 玻璃片 ----------
  function hud(ctx) {
    var pad = 26, i;
    // 极淡的上下遮罩：城市楼块 / 亮障碍滚到 HUD 后面时字也读得清
    var tg = ctx.createLinearGradient(0, 0, 0, 132);
    tg.addColorStop(0, 'rgba(5,8,18,.58)'); tg.addColorStop(1, 'rgba(5,8,18,0)');
    ctx.fillStyle = tg; ctx.fillRect(0, 0, W, 132);
    var bg = ctx.createLinearGradient(0, H - 86, 0, H);
    bg.addColorStop(0, 'rgba(5,8,18,0)'); bg.addColorStop(1, 'rgba(5,8,18,.55)');
    ctx.fillStyle = bg; ctx.fillRect(0, H - 86, W, 86);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim; ctx.font = '600 10px "SFMono-Regular",Menlo,monospace';
    ctx.fillText('S C O R E', pad, 20);
    ctx.fillStyle = C.text; ctx.font = '300 32px "SFMono-Regular",Menlo,monospace';
    ctx.fillText(String(Math.floor(st.score)), pad, 34);
    ctx.fillStyle = C.dim; ctx.font = '500 11px "SFMono-Regular",Menlo,monospace';
    ctx.fillText(Math.floor(st.dist) + ' m', pad + 1, 72);

    if (st.combo > 0) {
      var cw = 132;
      px(ctx, pad, 94, cw, 3, 'rgba(77,226,255,.18)');
      px(ctx, pad, 94, cw * Math.min(1, st.combo / COMBO_CAP), 3, C.visor);
      ctx.fillStyle = C.visor; ctx.font = '600 11px "SFMono-Regular",Menlo,monospace';
      ctx.fillText('COMBO ' + st.combo + '  ×' + comboMul().toFixed(2), pad, 102);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = C.dim; ctx.font = '600 10px "SFMono-Regular",Menlo,monospace';
    ctx.fillText('C O I N S', W - pad, 20);
    ctx.fillStyle = C.gold; ctx.font = '300 24px "SFMono-Regular",Menlo,monospace';
    ctx.fillText('◈ ' + st.coinsGot, W - pad, 34);
    if (st.coinMul > 1) {
      ctx.fillStyle = C.visor; ctx.font = '600 11px "SFMono-Regular",Menlo,monospace';
      ctx.fillText('每枚 ×' + st.coinMul, W - pad, 66);
    }

    var bw = 22, gap = 7, total = st.maxLives * bw + (st.maxLives - 1) * gap;
    for (i = 0; i < st.maxLives; i++) {
      var bx = W / 2 - total / 2 + i * (bw + gap);
      px(ctx, bx, 22, bw, 4, i < st.lives ? C.crimsonLit : 'rgba(255,255,255,.13)');
    }

    var by = H - 42, bx0 = pad;
    function buff(label, left, max, col) {
      if (left <= 0) return;
      var wid = 108;
      px(ctx, bx0, by, wid, 22, 'rgba(8,16,32,.62)');
      px(ctx, bx0, by, 3, 22, col);
      ctx.fillStyle = col; ctx.font = '600 11px "PingFang SC",sans-serif';
      ctx.textAlign = 'left'; ctx.fillText(label, bx0 + 10, by + 5);
      px(ctx, bx0 + 44, by + 15, wid - 52, 2, 'rgba(255,255,255,.16)');
      px(ctx, bx0 + 44, by + 15, (wid - 52) * U.clamp(left / max, 0, 1), 2, col);
      bx0 += wid + 8;
    }
    buff('◎ 磁石', st.magnetT, MAGNET_T, C.magnet);
    buff('×2 双倍', st.doubleT, DOUBLE_T, C.dbl);
    if (st.shield > 0) {
      px(ctx, bx0, by, 76, 22, 'rgba(8,16,32,.62)');
      px(ctx, bx0, by, 3, 22, C.shield);
      ctx.fillStyle = C.shield; ctx.font = '600 11px "PingFang SC",sans-serif';
      ctx.textAlign = 'left'; ctx.fillText('⬡ ×' + st.shield, bx0 + 10, by + 5);
      bx0 += 84;
    }
    buff('冲 刺', st.dashT, 1.1, C.visor);

    var sp = U.clamp((st.speed - SPEED0) / (SPEED_MAX - SPEED0), 0, 1);
    ctx.textAlign = 'right'; ctx.fillStyle = C.dim;
    ctx.font = '600 10px "SFMono-Regular",Menlo,monospace';
    ctx.fillText('S P E E D', W - pad, H - 56);
    px(ctx, W - pad - 110, H - 40, 110, 3, 'rgba(255,255,255,.12)');
    px(ctx, W - pad - 110, H - 40, 110 * sp, 3, C.visor);

    for (i = 0; i < st.pops.length; i++) {
      var o = st.pops[i];
      ctx.save(); ctx.globalAlpha = Math.min(1, o.life * 1.6);
      ctx.fillStyle = o.col; ctx.font = '600 20px "PingFang SC",sans-serif';
      ctx.textAlign = 'center'; ctx.fillText(o.txt, W / 2, H * 0.5 - (0.9 - o.life) * 52);
      ctx.restore();
    }
  }

  // ---------- 主绘制：从远到近 ----------
  function draw(ctx, t) {
    if (!st) return;
    syncWH();
    ctx.imageSmoothingEnabled = true;
    drawSky(ctx);
    drawFore(ctx);
    drawSpeedLines(ctx);

    ctx.save();
    if (st.shake > 0) ctx.translate((Math.random() - 0.5) * 9 * (st.shake / 0.42), (Math.random() - 0.5) * 6);
    if (st.roll) {
      ctx.translate(W / 2, H * 0.55); ctx.rotate(st.roll * 0.5);
      ctx.translate(-W / 2, -H * 0.55);
    }
    drawTrack(ctx);

    var objs = [], i;
    for (i = 0; i < st.rows.length; i++) objs.push({ z: st.rows[i].z, kind: 'row', o: st.rows[i] });
    for (i = 0; i < st.picks.length; i++) if (!st.picks[i].got)
      objs.push({ z: st.picks[i].z, kind: 'pick', o: st.picks[i] });
    var first = Math.floor(st.dist / 240) * 240;
    for (var z = first + 240; z < st.dist + DEPTH; z += 240) {
      objs.push({ z: z, kind: 'post', o: -1 });
      objs.push({ z: z, kind: 'post', o: 1 });
    }
    var af = Math.floor(st.dist / 1080) * 1080;
    for (var az = af + 1080; az < st.dist + DEPTH; az += 1080) objs.push({ z: az, kind: 'arch', o: null });
    objs.push({ z: -1, kind: 'player', o: null });
    objs.sort(function (a, b) { return b.z - a.z; });

    for (var j = 0; j < objs.length; j++) {
      var it = objs[j], dz = it.z - st.dist;
      if (it.kind === 'player') { drawPlayer(ctx); continue; }
      if (dz > DEPTH || dz < -80) continue;
      if (it.kind === 'pick') { drawPick(ctx, it.o); continue; }
      if (it.kind === 'post') { drawPost(ctx, dz, it.o); continue; }
      if (it.kind === 'arch') { drawArch(ctx, dz); continue; }
      for (var c = 0; c < 3; c++) {
        var cell = it.o.cells[c];
        if (!cell) continue;
        var lf = c - 1;
        if (cell === 'barrier') drawBarrier(ctx, lf, dz);
        else if (cell === 'beam') drawBeam(ctx, lf, dz);
        else drawBlock(ctx, lf, dz);
      }
    }
    ctx.restore();
    hud(ctx);
  }

  // ---------- 对外接口 ----------
  return {
    bgColor: '#050812',
    init: init, start: start, restart: restart, update: update, draw: draw,
    cashOut: cashOut, finish: finish, setEndHook: setEndHook,
    move: move, jump: jump, slide: slide, setPaused: setPaused,
    state: function () { return st; }, best: best,
    graze: graze, comboMul: comboMul,
    shopData: function () { return { wallet: B.U.coins(), up: loadUp(), defs: UP }; },
    wallet: function () { return B.U.coins(); }, upgrades: loadUp, shopDefs: function () { return UP; },
    costOf: costOf, canBuy: canBuy, buy: buy,
    patterns: function () { return PATTERNS; },
    cfg: function () {
      return { SPEED0: SPEED0, SPEED_MAX: SPEED_MAX, JUMP_V: JUMP_V, GRAV: GRAV,
        SLIDE_T: SLIDE_T, LANE_SP: LANE_SP, HIT_FAR: HIT_FAR, HIT_NEAR: HIT_NEAR,
        PERSP: PERSP, COMBO_STEP: COMBO_STEP, COMBO_CAP: COMBO_CAP };
    }
  };
})();

if (B.Games && B.Games.add) {
  B.Games.add({
    id: 'rail', name: '轨道狂奔', category: '动作', icon: '▰',
    desc: '三条轨道往前跑，换道跳滑躲障碍。',
    resume: function () { B.UI.startRail(); },
    enter: function () { B.UI.startRail(); },
    shop: function () { B.UI.show('screenRailShop'); }
  });
}

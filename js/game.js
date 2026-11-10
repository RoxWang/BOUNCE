// game.js —— 一局的全部逻辑：瞄准 → 发射 → 结算
var B = window.B = window.B || {};

B.Game = (function () {
  var C = B.C, Bd = B.Board, P = B.Phys, U = B.U, FX = B.FX, A = B.A, Gen = B.Gen, Meta = B.Meta;

  var g = {
    n: 1, level: null, board: null,
    balls: 0, totalBalls: 0,
    segs: 2,
    state: 'idle',        // idle 只有菜单；aim 可以瞄；fly 球在飞；over 已结束
    mode: 'marble',       // marble 弹珠解谜 / runner 无尽冲刺 / hop 跳跃拾金（三个独立游戏，互不耦合）
    aiming: false, mx: 0, my: 0, aimAngle: -Math.PI / 2, power: 1,
    marker: null,            // 发射点：恒在边框上，球从框外沿玩家定的方向打进来
    aimAnchor: null,         // 瞄准锚点：玩家按下的位置，只决定"球要穿过哪"，不是出生点
    preview: null,
    shots: [], evIdx: 0,
    combo: 0, bestCombo: 0,
    result: null,
    snap: null,           // 发射前的快照（撤回用）
    shotsUsed: 0,
    t: 0,
    overT: 0
  };

  var lvcache = {};
  // 关卡缓存带版本戳：棋盘几何或生成规则一变就换前缀，旧缓存自然失效（不删玩家数据）。
  // 不换前缀会读到旧尺寸的关卡，墙按新几何算、格子按旧关卡算 → 预测线与实际弹道错位。
  var LVKEY = 'bounce.lv.v27.';

  // 取第 n 关：先内存 → 再本地缓存 → 最后现场生成（生成结果存起来，第二次秒开）
  function getLevel(n) {
    if (lvcache[n]) return lvcache[n];
    var lv = null;
    try {
      var raw = localStorage.getItem(LVKEY + n);
      if (raw) lv = Bd.deserialize(raw);
    } catch (e) { lv = null; }
    if (!lv) {
      var st = Meta.stats();
      lv = Gen.level(n, { segs: st.segs, dmg: st.dmg, boomR: st.boomR, boomDmg: st.boomDmg });
      try { localStorage.setItem(LVKEY + n, Bd.serialize(lv)); } catch (e) { /* 存不下就算了，下次重算 */ }
    }
    lvcache[n] = lv;
    return lv;
  }

  function load(n) {
    if (n > 200) n = 200;                          // 弹珠解谜 1–200 关（100+ 用更大的动态地图）
    g.mode = 'marble';                            // 必须显式复位，否则从其他游戏退回后仍跑错主循环
    if (B.Music) B.Music.stop();                  // 离开无尽冲刺 → 停背景音乐
    var st = Meta.stats();
    g.n = n;
    g.level = getLevel(n);
    // 几何跟着「这一关实际的棋盘」走，而不是跟着 geoFor(n) 走：
    // 缓存里的关卡可能来自旧版本，先 applyGeo 会造成墙与格子错位（真 bug）。
    var lv = g.level;
    B.Board.applyGeo(lv.cols || B.Gen.geoFor(n).cols, (lv.rows && lv.rows.length) || B.Gen.geoFor(n).rows);
    if (B.Render && B.Render.setInsets) B.Render.setInsets(54, 124);  // 恢复弹珠的下边距
    if (B.Render) B.Render.resize();               // 重新算缩放，适配新尺寸
    g.board = Bd.fromLevel(lv);
    g.segs = st.segs;
    var mercy = Meta.mercyBalls(n);
    g.totalBalls = (g.level.balls || 4) + st.extraBalls + mercy;
    g.balls = g.totalBalls;
    g.state = 'aim';
    g.aiming = false; g.preview = null;
    g.aimAngle = -Math.PI / 2; g.power = 1;   // 默认朝上、满力度；键盘/触屏从此处微调
    // 默认锚点 = 棋盘中心：朝上时反向射线打到"底边正中"，正好回到老版从底部打进来的手感；
    // 转角度时入口会沿边框移动，四面都能进，但出生点永远在边框上。
    g.aimAnchor = { x: g.board.launchX, y: C.BY + C.BH / 2 };
    g.marker = spawnPoint();
    reshufflePortals(g.board, n);                  // 100+ 每发重新洗牌出口方向 = 动态感（预测线在门口截断，甩锅给运气）
    updatePreview();
    g.shots = []; g.evIdx = 0;
    g.combo = 0; g.bestCombo = 0;
    g.result = null; g.snap = null; g.shotsUsed = 0; g.lastBall = false; g.coinRun = 0;
    g.overT = 0;
    FX.reset();
    return g;
  }

  // 100+ 关：每发（回到瞄准时）把每个传送门的"出口方向"重新洗一遍。
  // 配合 live 随机出口，玩家每发面对的都是"刚变过的门"——这就是"在动态中计算"的男生女生向前冲感。
  // 100 以前：门方向固定（静态模块 + 随机出口目标），保持可推理性。
  // 旋转门（spin≠0）：保留它在转，只重洗"起始相位"baseDir，让它每发从一个新角度开始转。
  function reshufflePortals(b, n) {
    if (n <= 100) return;
    var r = U.rng((n * 2654435761 + (Date.now() >>> 0)) >>> 0);
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      if (v && v.t === 'portal') {
        if (v.spin) v.baseDir = r() * Math.PI * 2;   // 旋转门：重洗起始相位（仍持续转）
        else v.dir = r() * Math.PI * 2;               // 普通门：任意 360°，每次不同
      }
    }
  }

  // 旋转门：把每个 spin≠0 的门的方向按"起始相位 + 角速度×时间"实时算出来，写回 v.dir。
  // 渲染的指针和物理出口都读 v.dir，所以"球从指针当前指向出"天然成立。
  function spinPortals() {
    var b = g.board; if (!b) return;
    var t = g.t;
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      if (v && v.t === 'portal' && v.spin) v.dir = (v.baseDir || 0) + v.spin * t;
    }
  }

  // 动体方块：两发之间把每个动块沿 path 前进一格（乒乓）。只在"继续瞄准"那一步调用，飞行途中不动棋盘，
  // 因此确定性物理（预测=真实）不受影响。移动时记一条"从旧格中心→新格中心"的补间（fromX→toX + animStart），
  // 渲染据此把方块平滑滑过去，让"在动"看得出来——但碰撞永远按网格格子算，补间只是画面上好看。
  function stepMovers() {
    var b = g.board; if (!b || !b.movers) return;
    for (var mi = 0; mi < b.movers.length; mi++) {
      var m = b.movers[mi];
      if (!m.path || m.path.length < 2) continue;
      // 被球击碎后格子变 null：这发不再挪动，也不生成"幽灵"方块（格子不在就是死了）
      if (!b.cells[m.r * b.cols + m.c]) continue;
      var ni = m.idx + m.dir;
      if (ni >= m.path.length || ni < 0) { m.dir = -m.dir; ni = m.idx + m.dir; }  // 到头反弹
      if (ni < 0 || ni >= m.path.length) continue;
      var nc = m.path[ni].c, nr = m.path[ni].r;
      if (!B.Board.inB(b, nc, nr)) { m.dir = -m.dir; continue; }
      if (b.cells[nr * b.cols + nc]) { m.dir = -m.dir; continue; }   // 目标格被占 → 这一步不挪
      var old = b.cells[m.r * b.cols + m.c];
      b.cells[m.r * b.cols + m.c] = null;
      b.cells[nr * b.cols + nc] = old;
      m.fromX = B.Board.ccx(m.c); m.fromY = B.Board.ccy(m.r);
      m.toX = B.Board.ccx(nc); m.toY = B.Board.ccy(nr);
      m.animStart = g.t;
      m.c = nc; m.r = nr; m.idx = ni;
    }
  }

  // 无尽冲刺入口：一个独立游戏，和弹珠解谜用完全不同的操作与物理。
  function startRunner() {
    var geo = B.Gen.geoFor(1);
    B.Board.applyGeo(geo.cols, geo.rows);          // 复位几何（可能刚从大地图弹珠关退回）
    if (B.Render) B.Render.resize();
    g.mode = 'runner';
    if (B.Music) B.Music.start();                  // 进无尽冲刺 → 起背景音乐
    B.Runner.init();
    var pb = document.getElementById('phaseBanner');
    if (pb) {
      pb.innerHTML = '无尽冲刺<small>方向键 / 拖动 躲开下落方块 —— 活得越久越好</small>';
      pb.classList.remove('hidden'); pb.classList.add('show');
      setTimeout(function () { pb.classList.remove('show'); setTimeout(function () { pb.classList.add('hidden'); }, 420); }, 2600);
    }
    return g;
  }

  // 跳跃拾金入口：第三个独立游戏（30 关关卡制横版跑跳）。
  // 跟 startRunner 一样，进游戏前必须复位棋盘几何：刚从弹珠 16×16 大地图退回来时
  // C.W/C.H 还撑着，不复位的话画布缩放会按大地图算、整个世界被挤偏。
  function startHop(n) {
    var geo = B.Gen.geoFor(1);
    B.Board.applyGeo(geo.cols, geo.rows);  // 先把 16×16 大地图复位回来
    // 横版跑跳要横屏视野。C.W/C.H 同时也是渲染器缩放和 clip 的依据，改这里就能整条链路一起换；
    // 弹珠物理在 hop 模式不跑，改尺寸不会污染它；退出时 load(1) 里的 applyGeo 会自动恢复。
    B.C.W = 1100; B.C.H = 620;
    if (B.Render && B.Render.setInsets) B.Render.setInsets(54, 54);
    if (B.Render) B.Render.resize();
    g.mode = 'hop';
    if (B.Music) B.Music.stop();          // 别把无尽冲刺的背景音乐带进新游戏
    B.Hop.start(n || B.Hop.lastLevel());
    var pb = document.getElementById('phaseBanner');
    if (pb) {
      pb.innerHTML = '第 ' + B.Hop.state().level + ' 关 · 走到旗子过关';
      pb.classList.remove('hidden'); pb.classList.add('show');
      setTimeout(function () { pb.classList.remove('show'); setTimeout(function () { pb.classList.add('hidden'); }, 420); }, 2200);
    }
    return g;
  }

  // 发射点规则（用户硬需求）：球只能从边框打进来，不能从棋盘中间凭空出现。
  // 玩家按下的点 = 瞄准锚点（球会从那条射线上经过），拖拽定方向；把射线往回延长到最近的一条边框，
  // 交点就是球"从框外进来"的入口。四面墙依旧全封闭，进来之后随便反弹。
  function clampAnchor(wx, wy) {
    var R = C.BALL_R;
    return {
      x: U.clamp(wx, C.BX + R, C.BX + C.BW - R),
      y: U.clamp(wy, C.BY + R, C.BY + C.BH - R)
    };
  }

  // 入口那一格要是有砖，球一出生就会卡在砖与墙之间来回弹到寿命耗尽。
  // 所以沿这条边挪到最近的空格中心：出生点仍贴着边框，且预测线与真实球用的是同一个点。
  function freeEdgeCell(side, along) {
    var b = g.board;
    var vertical = (side === 'left' || side === 'right');
    var col = side === 'right' ? b.cols - 1 : 0;
    var row = side === 'bottom' ? b.rows - 1 : 0;
    var n = vertical ? b.rows : b.cols;
    var k0 = U.clamp(vertical ? Bd.rowAt(along) : Bd.colAt(along), 0, n - 1);
    for (var d = 0; d < n; d++) {
      var cand = d === 0 ? [k0] : [k0 - d, k0 + d];
      for (var j = 0; j < cand.length; j++) {
        var k = cand[j];
        if (k < 0 || k >= n) continue;
        var c = vertical ? col : k, r = vertical ? k : row;
        if (!Bd.get(b, c, r)) return { c: c, r: r };
      }
    }
    return null;
  }

  function borderSpawn(anchor, angle) {
    var R = C.BALL_R;
    var L = C.BX + R, RR = C.BX + C.BW - R, T = C.BY + R, Bo = C.BY + C.BH - R;
    var dx = Math.cos(angle), dy = Math.sin(angle);
    var best = null;
    function consider(t, side, x, y) {
      if (!(t > 0)) return;
      if (!best || t < best.t) best = { t: t, side: side, x: x, y: y };
    }
    if (dx > 1e-9) consider((anchor.x - L) / dx, 'left', L, anchor.y - ((anchor.x - L) / dx) * dy);
    if (dx < -1e-9) consider((anchor.x - RR) / dx, 'right', RR, anchor.y - ((anchor.x - RR) / dx) * dy);
    if (dy > 1e-9) consider((anchor.y - T) / dy, 'top', anchor.x - ((anchor.y - T) / dy) * dx, T);
    if (dy < -1e-9) consider((anchor.y - Bo) / dy, 'bottom', anchor.x - ((anchor.y - Bo) / dy) * dx, Bo);
    if (!best) return { x: U.clamp(anchor.x, L, RR), y: Bo };
    var x = best.x, y = best.y;
    var cell = freeEdgeCell(best.side, (best.side === 'left' || best.side === 'right') ? y : x);
    if (cell) {
      if (best.side === 'left' || best.side === 'right') y = Bd.ccy(cell.r);
      else x = Bd.ccx(cell.c);
    }
    return { x: U.clamp(x, L, RR), y: U.clamp(y, T, Bo) };
  }

  // 预览和真实发射都从这里取出生点，绝不各算各的（预测虚线 = 真实弹道）。
  function spawnPoint() {
    var a = g.aimAnchor || { x: g.board.launchX, y: C.BY + C.BH / 2 };
    return borderSpawn(a, g.aimAngle);
  }

  // ---------- 瞄准 ----------
  // 按下 = 记一个"球要穿过的锚点"，拖拽 = 定方向，球永远从边框沿这个方向打进来。
  // 连发：飞行途中再按一下 = 换锚点、再射一颗。
  function aimStart(wx, wy) {
    if (g.state !== 'aim' && g.state !== 'fly') return;   // 飞行途中也允许瞄准下一颗（连发）
    g.aiming = true; g.mx = wx; g.my = wy;
    g.aimAnchor = clampAnchor(wx, wy);
    // 按下那一刻还没有方向，沿用上一次角度；纯点击不会莫名其妙横着打出去
    g.marker = spawnPoint();
    updatePreview();
  }
  function aimMove(wx, wy) {
    if (!g.aiming || (g.state !== 'aim' && g.state !== 'fly')) return;
    g.mx = wx; g.my = wy;
    var a = g.aimAnchor;
    var dx = wx - a.x, dy = wy - a.y;
    if (dx * dx + dy * dy > 4) g.aimAngle = U.normAngle(Math.atan2(dy, dx));
    g.marker = spawnPoint();
    updatePreview();
  }
  function aimEnd() {
    if (!g.aiming) return;
    g.aiming = false;
    if (g.state !== 'aim' && g.state !== 'fly') return;
    if (g.balls <= 0) return;
    shoot(g.aimAngle);
  }
  function aimCancel() { g.aiming = false; g.preview = null; }

  // 直接给角度（键盘、自动游玩机器人用）：角度一变，入口就沿边框跟着变。
  function aimSet(angle) {
    g.aimAngle = U.normAngle(angle);
    g.marker = spawnPoint();
    updatePreview();
  }

  // 键盘 / 触屏：直接调角度与力度，鼠标拖也是往这俩变量里灌
  function nudgeAngle(d) {
    if (g.state !== 'aim') return;
    aimSet(g.aimAngle + d);
  }
  function nudgePower(d) {
    if (g.state !== 'aim') return;
    g.power = U.clamp(g.power + d, 0.55, 1);
    updatePreview();
  }
  function fire() {
    if ((g.state !== 'aim' && g.state !== 'fly') || g.balls <= 0) return;
    shoot(g.aimAngle);
  }

  // 预测：跑一发完整模拟（内部克隆棋盘，不会动真实局面）。出生点 = 当前发射标记。
  function updatePreview() {
    var st = Meta.stats();
    // preview:true → 预测线在传送门处截断（门后面全是随机出口，画了也是骗人，只画到"进哪扇门"）
    // previewSteps 把虚线长度截短到一屏好看；真实球按自己的寿命(full lifeSteps)跑，虚线是它的前缀 → 预测=真实不破
    var spawn = spawnPoint();
    g.marker = spawn;
    var opt = { power: g.power, dmg: st.dmg, boomR: st.boomR, boomDmg: st.boomDmg, chain: st.chain, preview: true, previewSteps: 900, spawn: spawn };
    if (g.shots.length === 0) {
      g.preview = P.run(g.board, g.aimAngle, opt);
    } else {
      // 飞行途中瞄准下一颗：把已在飞的球一起模拟，预测线含它们之间的碰撞拐点（多球下仍"预测=真实"）
      g.preview = P.runMulti(g.board, g.shots.map(function (x) { return x.s; }), g.aimAngle, opt);
    }
  }

  // ---------- 发射 ----------
  function shoot(angle) {
    if ((g.state !== 'aim' && g.state !== 'fly') || g.balls <= 0) return;
    var st = Meta.stats();
    // 先存快照，撤回用（只在波次之间可撤回）
    g.snap = { board: Bd.clone(g.board), balls: g.balls, combo: g.combo };
    g.balls--;
    g.shotsUsed++;
    g.lastBall = g.balls === 0;   // 这是最后一颗：这发清完就是绝杀
    // 每发是一颗独立的球，可连续发射；出生点永远在边框上，且与预测虚线取的是同一个 spawnPoint()。
    // 飞行途中棋盘冻结（动块两波之间才挪），所以预测=真实不被破坏。
    var spawn = spawnPoint();
    g.aimAngle = angle; g.marker = spawn;
    var s = P.shot(g.board, angle, {
      mutate: true, power: g.power, dmg: st.dmg, boomR: st.boomR, boomDmg: st.boomDmg, chain: st.chain,
      spawn: spawn
    });
    g.shots.push({ s: s, ball: { x: s.x, y: s.y }, trail: [], evIdx: 0 });
    g.preview = null; g.aiming = false;
    if (g.shots.length === 1) g.state = 'fly';   // 第一颗：离开瞄准态；后续连发保持飞行态
    A.play('launch');
  }

  // 连击里程碑：6 粉 → 12 金 → 18 更炸。hit 和弹板共用。
  function milestone(combo, x, y) {
    if (combo <= 0 || combo % 6 !== 0) return;
    var deep = combo >= 18 ? 3 : (combo >= 12 ? 2 : 1);
    var col = deep === 3 ? '#ffd24a' : (deep === 2 ? '#ffb02e' : '#ff7ae0');
    FX.text(x, y - 26, combo + ' 连击', col, 18 + deep * 5);
    FX.flash(0.05 + deep * 0.05);
    FX.shake(2 + deep * 3, 0.12);
    FX.ring(x, y, 6, 40 + deep * 16, 'rgba(255,210,90,' + (0.5 + deep * 0.2) + ')', 0.35, 3);
  }

  // 把物理事件翻译成"看得见听得见"的东西
  function drainEvents(s) {
    var ev = s.events;
    for (var i = s.evIdx; i < ev.length; i++) {
      var e = ev[i];
      if (e.t === 'hit') {
        FX.spark(e.x, e.y, '#9beaff', 5, 190);
        FX.stop(0.028);                      // 顿帧：命中那一下"卡"一下，这是打击感的来源
        A.play('hit', e.combo);
        if (e.combo > s.combo) s.combo = e.combo;
        if (e.combo > g.bestCombo) g.bestCombo = e.combo;
        milestone(e.combo, e.x, e.y);
      } else if (e.t === 'brk') {
        var col = '#3fd6ff';
        FX.shard(e.x, e.y, col, 11);
        FX.spark(e.x, e.y, '#c8f2ff', 7, 240);
        FX.shake(3.5, 0.12);
        A.play('brk');
      } else if (e.t === 'tgt') {
        FX.shard(e.x, e.y, '#ffb02e', 16);
        FX.ring(e.x, e.y, 8, 70, 'rgba(255,176,46,.9)', 0.45, 4);
        FX.shake(9, 0.22);
        FX.flash(0.16);
        FX.text(e.x, e.y - 30, '目标碎了', '#ffb02e', 22);
        A.play('tgt');
      } else if (e.t === 'boom') {
        FX.ring(e.x, e.y, 10, e.r, 'rgba(255,140,80,.95)', 0.5, 6);
        FX.ring(e.x, e.y, 4, e.r * 0.6, 'rgba(255,220,150,.8)', 0.32, 3);
        FX.spark(e.x, e.y, '#ffb066', 26, 460);
        FX.shake(15, 0.3);
        FX.flash(0.3);
        FX.stop(0.05);
        A.play('boom');
      } else if (e.t === 'crack') {
        // 裂缝砖：全场砖掉血的瞬间，给一个"大坝决堤"级别的反馈
        FX.ring(e.x, e.y, 8, 420, 'rgba(255,255,255,.75)', 0.55, 5);
        FX.ring(e.x, e.y, 4, 240, 'rgba(255,120,90,.9)', 0.4, 3);
        FX.shake(16, 0.35);
        FX.flash(0.38);
        FX.stop(0.07);
        FX.text(e.x, e.y - 34, '决堤！', '#ff8a6a', 26);
        A.play('boom');
      } else if (e.t === 'coin') {
        FX.ring(e.x, e.y, 4, 44, 'rgba(255,208,74,.95)', 0.4, 3);
        FX.spark(e.x, e.y, '#ffd04a', 12, 260);
        FX.text(e.x, e.y - 28, '◈ +15', '#ffd04a', 21);
        A.play('coin');
      } else if (e.t === 'bumper') {
        FX.ring(e.x, e.y, 6, 52, 'rgba(255,176,46,.9)', 0.3, 4);
        FX.spark(e.x, e.y, '#ffb02e', 8, 300);
        FX.stop(0.02);
        if (e.combo > s.combo) s.combo = e.combo;
        if (e.combo > g.bestCombo) g.bestCombo = e.combo;
        milestone(e.combo, e.x, e.y);
        A.play('bumper');
      } else if (e.t === 'wall') {
        // 撞墙声太密会吵，只让一部分出声
        if (Math.random() < 0.34) A.play('wall');
      } else if (e.t === 'portal') {
        FX.ring(e.x, e.y, 4, 46, 'rgba(169,123,255,.9)', 0.4, 3);
        FX.spark(e.x, e.y, '#c79bff', 10, 220);
        A.play('portal');
      } else if (e.t === 'plus') {
        g.balls++;
        FX.ring(e.x, e.y, 4, 52, 'rgba(70,224,138,.9)', 0.42, 3);
        FX.text(e.x, e.y - 28, '+1 球', '#46e08a', 22);
        A.play('plus');
      } else if (e.t === 'bbhit') {
        FX.spark(e.x, e.y, '#ffd24a', 6, 220);   // 球撞球：金色火花 + 撞击声
        A.play('hit');
      }
    }
    s.evIdx = ev.length;
  }

  // ---------- 每帧 ----------
  function update(dt, rawDt) {
    g.t += rawDt;
    B.Phys.tick(rawDt);     // 推进传送门冷却时钟（仅真实对局里有效）
    spinPortals();          // 旋转门：出口方向随时间转，球从当前指针方向出
    FX.update(dt, rawDt);

    if (g.state === 'fly' && g.shots.length) {
      var steps = Math.max(0, Math.round(C.SPEED * dt / P.STEP));
      if (steps > 0) {
        // 多球同帧推进 + 球间弹性碰撞（预测和真实同一套，红线不被破坏）
        P.advanceMulti(g.shots.map(function (x) { return x.s; }), steps);
        var still = [];
        for (var i = 0; i < g.shots.length; i++) {
          var x = g.shots[i];
          drainEvents(x.s);
          x.ball.x = x.s.x; x.ball.y = x.s.y;
          x.trail.push({ x: x.s.x, y: x.s.y });
          if (x.trail.length > 16) x.trail.shift();
          if (x.s.alive) still.push(x);
          else g.coinRun += x.s.coins;   // 寿命/反弹次数到顶的球把敲到的金币入账
        }
        g.shots = still;
        var lc = 0;
        for (var ci = 0; ci < g.shots.length; ci++) if (g.shots[ci].s.combo > lc) lc = g.shots[ci].s.combo;
        g.combo = lc;   // HUD 连击数显示（多球下取当前在飞球里最高的）
        // 目标清完立刻赢（哪怕还有球在飞）
        if (Bd.countTargets(g.board) <= 0) finish(true);
        else if (g.shots.length === 0) {
          if (g.balls <= 0) finish(false);   // 没球也没余弹 → 输
          else endVolley();                    // 一波打完、还有弹 → 动块挪一格、回到瞄准态
        }
      }
    } else if (g.state === 'over') {
      g.overT += rawDt;
      if (g.overT > 0.55 && !g.result.shown) {
        g.result.shown = true;
        B.UI.showResult(g.result);
      }
    }
  }

  // 一波球全部落地后调用：金币已入账、动块挪一格、门重洗、回到瞄准态。
  // 关键：动块只在"两波之间"挪（飞行途中棋盘冻结），预测=真实这条红线在多球下也不破。
  function endVolley() {
    // 本波最高连击简报
    if (g.bestCombo >= 6) FX.text(g.board.launchX, C.LAUNCH_Y - 56, '最高 ' + g.bestCombo + ' 连击', '#9beaff', 17);
    g.bestCombo = 0;
    g.combo = 0;
    g.aiming = false; g.preview = null;
    stepMovers();
    reshufflePortals(g.board, g.n);
    // 动块挪过之后重新算入口（边框空格可能变了），别让出生点落在刚挪来的砖上
    g.aimAnchor = { x: g.board.launchX, y: C.BY + C.BH / 2 };
    g.marker = spawnPoint();
    g.state = 'aim';
    A.play('back');
  }

  function finish(won) {
    g.state = 'over';
    g.overT = 0;
    var n = g.n;
    var targets = g.level.targetsCount || 1;
    var coin = 0, stars = 0, clutch = false;
    if (won) {
      // 绝杀（clutch）：用最后一颗球清掉最后一个目标。一局里最值钱的瞬间。
      clutch = !!g.lastBall;
      stars = Meta.starsFor(g.balls, g.totalBalls);
      coin = Meta.reward(n, g.balls, targets) * (clutch ? 2 : 1) + g.coinRun;
      Meta.win(n, stars, g.balls, g.shotsUsed);
      Meta.addCoin(coin);
      FX.flash(clutch ? 0.55 : 0.34);
      FX.slow(clutch ? 1.1 : 0.5);
      if (clutch) FX.shake(10, 0.4);
      A.play('win');
      if (clutch) setTimeout(function () { A.play('clutch'); }, 250);
    } else {
      Meta.lose(n);
      FX.shake(8, 0.3);
      setTimeout(function () { A.play('lose'); }, 120);
    }
    g.lastBall = false;
    g.result = {
      won: won, n: n, stars: stars, coin: coin, clutch: clutch,
      coins: g.coinRun,
      left: g.balls, total: g.totalBalls,
      combo: g.bestCombo, shots: g.shotsUsed,
      targets: targets, shown: false
    };
  }

  // 撤回上一发（只撤一步：够用了，而且不会让人无限试）
  function undo() {
    if (g.state !== 'aim' || !g.snap) return false;
    g.board = g.snap.board;
    g.balls = g.snap.balls;
    g.combo = g.snap.combo;
    g.shots = [];          // 撤回只在两波之间可用，清掉在场的所有球
    g.snap = null;
    g.shotsUsed = Math.max(0, g.shotsUsed - 1);
    FX.reset();
    A.play('back');
    return true;
  }

  function restart() {
    if (g.mode === 'runner') { startRunner(); A.play('click'); return; }
    if (g.mode === 'hop') { B.Hop.restart(); A.play('click'); return; }
    var n = g.n;
    load(n);
    A.play('click');
  }

  function targetsLeft() { return g.board ? Bd.countTargets(g.board) : 0; }

  // 第 n 关显示用：一共有几个目标（关卡加载前也要知道，所以从关卡定义数）
  function countTargetsOfLevel(lv) {
    if (!lv) return 0;
    var b = Bd.fromLevel(lv);
    return Bd.countTargets(b);
  }

  return {
    g: g, load: load, getLevel: getLevel, startRunner: startRunner, startHop: startHop,
    aimStart: aimStart, aimMove: aimMove, aimEnd: aimEnd, aimCancel: aimCancel, aimSet: aimSet,
    nudgeAngle: nudgeAngle, nudgePower: nudgePower, fire: fire,
    update: update, undo: undo, restart: restart,
    targetsLeft: targetsLeft, countTargetsOfLevel: countTargetsOfLevel,
    state: function () { return g.state; }
  };
})();

// ============================================================================
// 游戏注册表：大厅只认这张表，每个游戏都是一条完全独立的入口。
// 加新游戏 = B.Games.add({ id, name, icon, desc, category, resume, enter, shop })
// 大厅自动多一张卡。desc 只写一句话：这游戏是干什么的，别加别的说明。
// ============================================================================
B.Games = (function () {
  var arr = [
    {
      id: 'marble', name: '弹珠解谜', category: '益智', icon: '◉',
      desc: '瞄准发射，用有限的球打碎所有金色砖。',
      resume: function () { B.UI.startLevel(B.Meta.data().cur || 1); },
      enter: function () { B.UI.show('screenMenu'); },
      shop: function () { B.UI.show('screenUpgrades'); }
    },
    {
      id: 'runner', name: '无尽冲刺', category: '动作', icon: '⚡',
      desc: '躲开下落的方块，活得越久分越高。',
      resume: function () { B.UI.startRunner(); },
      enter: function () { B.UI.startRunner(); },
      shop: function () { B.UI.show('screenRunnerShop'); }
    }
  ];

  var LAST_KEY = 'bounce.lastGame';
  function lastId() { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } }
  function touch(id) { try { localStorage.setItem(LAST_KEY, id); } catch (e) { } }
  function get(id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }
  function categories() {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i].category || '其它';
      if (!seen[c]) { seen[c] = 1; out.push(c); }
    }
    return out;
  }
  function add(g) {
    if (!g || !g.id) return;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === g.id) { arr[i] = g; return; }
    arr.push(g);
  }
  function enterGame(id) { var g = get(id); if (!g) return; touch(id); (g.enter || g.resume || function () { })(); }
  function resumeGame(id) { var g = get(id); if (!g) return; touch(id); (g.resume || g.enter || function () { })(); }

  return {
    list: function () { return arr.slice(); },
    add: add, get: get, categories: categories,
    lastId: lastId, last: function () { return get(lastId()); },
    enterGame: enterGame, resumeGame: resumeGame
  };
})();

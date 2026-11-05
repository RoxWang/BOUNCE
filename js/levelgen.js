// levelgen.js —— 关卡：手工教学关 + 种子化程序生成 + 求解器验证
//
// 长期性全靠这里：每一关都是一道"新题"，而不是同一道题的更高难度。
// 做法成熟但很实在：随机布局 → 用求解器模拟几百次 → 太简单/不可能的丢掉 → 留下难度刚好的。
var B = window.B = window.B || {};

B.Gen = (function () {
  var Bd = B.Board, P = B.Phys, U = B.U, C = B.C;
  var COLS = C.COLS, ROWS = C.ROWS;

  // 新机制：球从"框内底部中心"出生（四面实心墙封死，进得去出不来）。
  // 求解器 / 物理默认也用它，保证"求解器验证过能通的关，玩家把发射标记放这也能复现"。
  function spawnPoint(b) {
    return { x: (b && b.launchX != null) ? b.launchX : (C.BX + C.BW / 2), y: C.BY + C.BH - C.BALL_R - 2 };
  }
  // 当前生成关卡的几何（被下面的 helper 引用；每次生成前由 paramsFor/gen 写入）
  var GEO = { cols: 9, rows: 11 };

  // ============ 手工教学关（前 6 关，逐个引入新机制，保证一定能过） ============
  var HAND = [
    { // 1 · 直着打：让你先看见那条虚线
      name: '第一发', balls: 4, segs: 3, tgtHp: 1,
      rows: [
        '...........',
        '...........',
        '...........',
        '....111....',
        '....1*1....',
        '....111....',
        '...........',
        '...........',
        '...........',
        '...........',
        '...........'
      ]
    },
    { // 2 · 反弹：钢块打不碎，但可以当跳板
      name: '绕过去', balls: 4, segs: 3, tgtHp: 1,
      rows: [
        '...........',
        '...........',
        '...........',
        '..*.....*..',
        '...........',
        '...#####...',
        '...........',
        '...........',
        '...........',
        '...........',
        '...........'
      ]
    },
    { // 3 · 炸弹：打到就炸，范围内的砖一起掉血
      name: '点它', balls: 4, segs: 3, tgtHp: 1,
      rows: [
        '...........',
        '...........',
        '....222....',
        '...2*B2....',
        '....222....',
        '...........',
        '....111....',
        '...........',
        '...........',
        '...........',
        '...........'
      ]
    },
    { // 4 · 传送门：中间钢墙挡住直路。进下方门，从上方门冒出来（箭头朝上），正好击中目标。
      // 关键：出口方向由门上的箭头"定义死"，不是随机——你只算"怎么把球送进门"。
      name: '抄近路', balls: 5, segs: 3, tgtHp: 1,
      rows: [
        '...........',
        '.......*...',   // 目标：右上角
        '...........',
        '...........',
        '...........',
        '.....####..',   // 钢墙：封死通往目标的直线，逼你用传送门
        '...........',
        '...........',
        '...........',
        '...........',
        '...........'
      ],
      portals: [
        { c: 5, r: 8, gid: 0, dir: 'up' },   // 下方门：从正下方直上就能打中它
        { c: 7, r: 3, gid: 0, dir: 'up' }    // 上方门：从这儿冒出，朝上正好击中目标
      ]
    },
    { // 5 · 加球：碰到就多一颗，用得好等于多一次机会
      name: '捡到就是赚到', balls: 3, segs: 3, tgtHp: 1,
      rows: [
        '...........',
        '...........',
        '...3...3...',
        '..3.....3..',
        '.....*.....',
        '..3.....3..',
        '...3...3...',
        '...........',
        '.....+.....',
        '...........',
        '...........'
      ]
    },
    { // 6 · 综合：两个目标，钢块、炸弹、加球、金币砖都在
      name: '合起来', balls: 4, segs: 3, tgtHp: 2,
      rows: [
        '...........',
        '...........',
        '..*..#..*..',
        '...........',
        '...2...2...',
        '.....B.....',
        '...2...2...',
        '.....O.....',
        '.....#.....',
        '...+...+...',
        '...........'
      ]
    }
  ];

  // ============ 每关几何 ============
  // 棋盘一律正方形：11×11（1–100 关）、16×16（101–200 关）。
  // 正方形让四个方向的反弹距离对称，算弹道时不用再补偿"竖着比横着长"的偏差。
  // 几何改了以后关卡缓存必须换版本戳（见 game.js 的 LVKEY），否则旧关卡会按新墙尺寸错位。
  function geoFor(n) {
    if (n <= 100) return { cols: 11, rows: 11 };
    return { cols: 16, rows: 16 };
  }

  // ============ 难度参数 ============
  function paramsFor(n) {
    var p = {};
    var big = n > 100;
    p.targets = Math.min(big ? 9 : 4, 1 + Math.floor((n - 1) / 4));
    p.tgtHp = Math.max(1, Math.min(4, 1 + Math.floor((n - 6) / 8)));
    p.density = Math.min(0.40, 0.13 + n * 0.011);
    p.steel = n >= 4 ? Math.min(5, 1 + Math.floor((n - 4) / 7)) : 0;
    p.bomb = n >= 6 ? Math.min(3, 1 + Math.floor((n - 6) / 10)) : 0;
    // 传送门分档（用户硬需求）——门槛比旧版更低，让玩家更早看到"会转的传送门"：
    //   0–49：静态模块，最干净（不开门）
    //   50–99：随机传送门 + 静态模块（每发随机出口，预测线在门口截断），部分门会自转
    //   100+：门更多、且每发重新洗牌出口方向（动态感），地图也更大
    p.portals = n >= 100 ? 2 : (n >= 50 ? 1 : 0);
    p.portalNodes = n >= 100 ? 6 : (n >= 80 ? 5 : (n >= 50 ? 4 : (n >= 22 ? 3 : 2)));
    p.plus = n >= 5 ? Math.min(2, 1 + Math.floor((n - 5) / 18)) : 0;
    p.hpMax = Math.max(1, Math.min(6, 1 + Math.floor(n / 5)));
    // 新元素按进度解锁：金币砖 → 裂缝砖 → 弹板
    p.coin = n >= 6 ? Math.min(3, 1 + Math.floor((n - 6) / 12)) : 0;
    p.crack = n >= 8 ? Math.min(2, 1 + Math.floor((n - 8) / 15)) : 0;
    p.bumper = n >= 12 ? Math.min(2, 1 + Math.floor((n - 12) / 20)) : 0;
    // 弹珠关里不再生成任何引力井（已废弃引力场），保留代码为惰性。
    p.wells = 0;
    // 球数就是"这一关你能做几个决定"。大地图同步放大（"该失败就失败"，但也要给够决策空间）。
    var base = 2 + p.targets + (n >= 20 ? 1 : 0);
    p.balls = Math.min(big ? 16 : 7, base + (big ? 4 : 0));
    p.geo = geoFor(n);
    p.big = big;
    return p;
  }

  function blank() {
    var a = [];
    for (var r = 0; r < GEO.rows; r++) {
      var s = '';
      for (var c = 0; c < GEO.cols; c++) s += '.';
      a.push(s.split(''));
    }
    return a;
  }
  function toRows(g) { return g.map(function (r) { return r.join(''); }); }

  function freeCells(g, used, r0, r1) {
    var out = [];
    for (var r = r0; r <= r1; r++) for (var c = 0; c < GEO.cols; c++) if (g[r][c] === '.' && !used[r][c]) out.push([c, r]);
    return out;
  }

  // 目标质心（行列平均），用来给传送门定一个"指向目标"的出口方向
  function targetCentroid(g) {
    var sx = 0, sy = 0, n = 0, r, c;
    for (r = 0; r < GEO.rows; r++) for (c = 0; c < GEO.cols; c++) if (g[r][c] === '*') { sx += c; sy += r; n++; }
    if (!n) return { c: GEO.cols / 2, r: 3 };
    return { c: sx / n, r: sy / n };
  }

  // 在 [r0,r1] 里挑 count 个互相拉开距离的空格（used 标记已占用，避免别的东西压上传送门）。
  // minDist 默认 2（门之间留点空隙好看）；放不下时调用方会降到 1 再凑，保证难关真能给到足够多的门。
  function pickSpread(g, used, count, r0, r1, rnd, minDist) {
    if (minDist == null) minDist = 2;
    var cand = [];
    for (var r = r0; r <= r1; r++) for (var c = 0; c < GEO.cols; c++) if (g[r][c] === '.' && !used[r][c]) cand.push([c, r]);
    cand = rnd.shuffle(cand);
    var out = [];
    for (var i = 0; i < cand.length && out.length < count; i++) {
      var ok = true;
      for (var k = 0; k < out.length; k++) {
        if (Math.abs(out[k][0] - cand[i][0]) + Math.abs(out[k][1] - cand[i][1]) < minDist) { ok = false; break; }
      }
      if (ok) { out.push(cand[i]); used[cand[i][1]][cand[i][0]] = true; }
    }
    return out;
  }

  // ============ 生成一关 ============
  // 返回 { rows: [...], portals: [...] }。传送门单独用 portals 数组定义（每个门带 gid + dir），
  // 不塞进 rows 字符里——因为"方向"没法用单个字符说清，显式定义才能保证唯一性、不靠运气。
  // 构造一个动体方块的移动路径（path）：从起点砖格出发，沿轴走 span 格（直线 AB），
  // 40关+ 有一半概率再转 90° 走一段（转角 ABC，弧线感）。路径上除起点外的格子若是普通砖，
  // 直接清掉当轨道（g 是字符数组，可改）；若是目标砖(*)或传送门(used)则不动，整条放弃。
  // 这样即使高密度关卡也能稳定造出"专属轨道"，动体方块一定看得到。
  function buildMoverPath(g, used, sc, sr, n, rnd) {
    var axis = rnd() < 0.5 ? 'h' : 'v';
    var span = 2 + (n >= 80 ? rnd.int(2) : 0);            // 直线段长度 2~3
    var cells = [{ c: sc, r: sr }];
    var c = sc, r = sr;
    function step(taxis, len) {
      for (var k = 0; k < len; k++) {
        var nc = c + (taxis === 'h' ? 1 : 0), nr = r + (taxis === 'v' ? 1 : 0);
        if (nr >= g.length || nc >= g[0].length || nc < 0 || nr < 0) return false;
        var ch = g[nr][nc];
        if (ch === '*' || used[nr][nc]) return false;          // 目标/传送门：不能清，整条放弃
        if (ch !== '.') { g[nr][nc] = '.'; used[nr][nc] = false; } // 普通砖：清出来当轨道
        cells.push({ c: nc, r: nr }); c = nc; r = nr;
      }
      return true;
    }
    if (!step(axis, span)) return null;
    if (n >= 40 && rnd() < 0.5) {                          // 转角：再走一段垂直方向（弧线 ABC）
      if (!step(axis === 'h' ? 'v' : 'h', 2)) return null;
    }
    return cells;
  }
  function layout(n, p, rnd) {
    GEO = p.geo || { cols: 9, rows: 11 };
    // 关键：生成/求解所用的棋盘尺寸（14×16 大地图等）必须同步到全局几何 B.C，
    // 否则物理与求解器会沿用默认的 9×11 墙边界，第 10 列以后的目标永远够不到 → 整关无解。
    // 让 gen/layout 自洽，测试或游戏单独调用 gen() 也都正确（不再依赖调用方先 applyGeo）。
    Bd.applyGeo(GEO.cols, GEO.rows);
    var g = blank();
    var used = [];
    for (var rr = 0; rr < GEO.rows; rr++) { used.push([]); for (var cc = 0; cc < GEO.cols; cc++) used[rr].push(false); }
    var portals = [];
    var wells = [];
    var i, cell;

    // 引力场（已废弃）：占位保留，不再触发
    if (p.wells) {
      var wp = pickSpread(g, used, p.wells, 2, GEO.rows - 2, rnd);
      for (var wi = 0; wi < wp.length; wi++) {
        var wtype = ((n + wi) % 2 === 0) ? 'attract' : 'repel';
        wells.push({ c: wp[wi][0], r: wp[wi][1], type: wtype });
      }
    }

    // 目标：上半部，彼此拉开距离
    var placed = [];
    for (i = 0; i < p.targets; i++) {
      var ok = false;
      for (var t = 0; t < 60 && !ok; t++) {
        var c = rnd.int(GEO.cols), r = 1 + rnd.int(Math.max(1, GEO.rows - 4));
        var far = true;
        for (var k = 0; k < placed.length; k++) {
          if (Math.abs(placed[k][0] - c) + Math.abs(placed[k][1] - r) < 3) { far = false; break; }
        }
        if (far && g[r][c] === '.' && !used[r][c]) { g[r][c] = '*'; used[r][c] = true; placed.push([c, r]); ok = true; }
      }
    }
    if (!placed.length) { var mc = Math.floor(GEO.cols / 2); g[2][mc] = '*'; used[2][mc] = true; placed.push([mc, 2]); }

    // 传送门：先放，占用格，避免后面被砖/钢块盖住。每发出口随机（live），但生成时先给一组合法的"作者出口" to，
    // 求解器靠它验证"这一关确实能通"。to 指向同组里另一扇门（确定性随机，保证不指向自己）。
    var tcent = targetCentroid(g);
    var nGroups = p.portals || 0;
    var nodes = p.portalNodes || 2;
    for (var gi = 0; gi < nGroups; gi++) {
      // 先按间距 2 挑；放不下就降到间距 1 再凑，确保难关真能给到足够多的门（不会悄悄掉回 2 个）
      var picks = [];
      for (var md = 2; md >= 1 && picks.length < nodes; md--) {
        picks = picks.concat(pickSpread(g, used, nodes - picks.length, 2, GEO.rows - 2, rnd, md));
      }
      if (picks.length < 2) break;
      var groupKeys = [];
      for (var ni = 0; ni < picks.length; ni++) {
        var pc = picks[ni][0], pr = picks[ni][1];
        // 出口角度：任意 360°（用户硬需求，不锁上下左右）。以"从棋盘中心朝门外"为基准 + 大幅随机抖动。
        var bcx = (GEO.cols - 1) / 2, bcy = (GEO.rows - 1) / 2;
        var base = Math.atan2(pr - bcy, pc - bcx);
        var jitter = (rnd.int(1000) / 1000 - 0.5) * Math.PI * 0.85;  // ±约 76°，任意角度都可能出现
        var ang = base + jitter;
        // 旋转门（50关+ 起陆续出现）：门自身持续旋转，球从"当前指针所指方向"出——出口可见、不靠运气猜。
        // 角速度 1.0~1.7 rad/s → 一圈约 3.7~6.3 秒（用户想要"几秒转一圈"的观感，取中段）。
        var spin = 0;
        var spinChance = n >= 100 ? 0.6 : (n >= 70 ? 0.4 : (n >= 50 ? 0.3 : 0));
        if (n >= 50 && rnd() < spinChance) spin = (rnd() < 0.5 ? 1 : -1) * (1.0 + rnd() * 0.7);
        portals.push({ c: pc, r: pr, gid: gi, dir: ang, baseDir: ang, spin: spin });
        used[pr][pc] = true;   // 占位；网格里仍留 '.'，真正放置由 lv.portals 完成
        groupKeys.push(pc + ',' + pr);
      }
      // 组内每个门随机指向下一个（错开，保证不是自己），形成"每个门独立、出口随机"的网络
      for (var ki = 0; ki < groupKeys.length; ki++) {
        var other = groupKeys[(ki + 1 + rnd.int(groupKeys.length - 1)) % groupKeys.length];
        portals[portals.length - groupKeys.length + ki].to = other;
      }
    }

    // 钢块
    for (i = 0; i < p.steel; i++) {
      var fs = freeCells(g, used, 2, GEO.rows - 2); if (!fs.length) break;
      cell = fs[rnd.int(fs.length)]; g[cell[1]][cell[0]] = '#'; used[cell[1]][cell[0]] = true;
    }
    // 炸弹
    for (i = 0; i < p.bomb; i++) {
      var fb = freeCells(g, used, 2, GEO.rows - 3); if (!fb.length) break;
      cell = fb[rnd.int(fb.length)]; g[cell[1]][cell[0]] = 'B'; used[cell[1]][cell[0]] = true;
    }
    // 加球
    for (i = 0; i < p.plus; i++) {
      var fp = freeCells(g, used, 6, GEO.rows - 1); if (!fp.length) break;
      cell = fp[rnd.int(fp.length)]; g[cell[1]][cell[0]] = '+'; used[cell[1]][cell[0]] = true;
    }
    // 金币砖（打碎给钱，纯甜点）
    for (i = 0; i < p.coin; i++) {
      var fc = freeCells(g, used, 2, GEO.rows - 2); if (!fc.length) break;
      cell = fc[rnd.int(fc.length)]; g[cell[1]][cell[0]] = 'O'; used[cell[1]][cell[0]] = true;
    }
    // 裂缝砖（碎了全场掉血——放在砖堆中间才有威力）
    for (i = 0; i < p.crack; i++) {
      var fx2 = freeCells(g, used, 2, GEO.rows - 2); if (!fx2.length) break;
      cell = fx2[rnd.int(fx2.length)]; g[cell[1]][cell[0]] = 'X'; used[cell[1]][cell[0]] = true;
    }
    // 弹板（圆形障碍，改变球的走向）
    for (i = 0; i < p.bumper; i++) {
      var fu = freeCells(g, used, 3, GEO.rows - 2); if (!fu.length) break;
      cell = fu[rnd.int(fu.length)]; g[cell[1]][cell[0]] = 'U'; used[cell[1]][cell[0]] = true;
    }
    // 普通砖：按密度填（已占用的门格不会被填）
    var fk = freeCells(g, used, 2, GEO.rows - 2);
    var want = Math.floor(fk.length * p.density);
    for (i = 0; i < want; i++) {
      var j = rnd.int(fk.length);
      cell = fk.splice(j, 1)[0];
      if (g[cell[1]][cell[0]] !== '.') continue;
      g[cell[1]][cell[0]] = String(1 + rnd.int(p.hpMax));
      used[cell[1]][cell[0]] = true;
    }
    // 动体方块（25关+ 出现，让地图"在动"看得见）：挑普通砖格登记成动块，沿 path 在两发之间平移（乒乓）。
    // 一半直线 AB、一半转角 ABC（弧线感）。平移只发生在两发之间（见 game.js stepMovers），飞行途中棋盘不动
    // → 确定性物理红线不受影响。path 上的其它格子必须为空（也不能压在传送门上），否则这条动块整条不要。
    var movers = [];
    if (n >= 25 && p.density > 0.05) {
      var brickCells2 = [];
      for (var br2 = 0; br2 < g.length; br2++) for (var bc2 = 0; bc2 < g[br2].length; bc2++) {
        var ch2 = g[br2][bc2];
        if (ch2 >= '1' && ch2 <= '9') brickCells2.push([bc2, br2]);
      }
      var nMov = n >= 120 ? 2 + rnd.int(2) : (n >= 60 ? 2 : 1);
      nMov = Math.min(nMov, 3);
      // 多次尝试不同的砖格，直到凑够 nMov 个动块（路径被目标/门挡住就换一块），保证 25关+ 几乎关关都有动块可见
      var tries = 0;
      while (movers.length < nMov && brickCells2.length && tries < 24) {
        tries++;
        var bi = rnd.int(brickCells2.length);
        var bp = brickCells2.splice(bi, 1)[0];
        var path = buildMoverPath(g, used, bp[0], bp[1], n, rnd);
        if (path) movers.push({ path: path });
      }
    }
    return { rows: toRows(g), portals: portals, wells: wells, movers: movers, cols: GEO.cols };
  }

  // ============ 求解器：用"带噪声的贪心"模拟人类打法 ============
  // 完全随机采样的角度会严重低估可解性（人类不会闭着眼打），
  // 所以每一步都挑当前最优角度，再叠一点随机扰动 —— 这个代理指标才贴近真实难度。
  function playout(board0, balls, rnd, opt) {
    var b = Bd.clone(board0);
    var cand = 12;
    var sp = spawnPoint(b);   // 新机制：每发都从"框内底部中心"出生（四面墙封死），求解与真实发射一致
    for (var i = 0; i < balls; i++) {
      var bestA = 0, bestScore = -1;
      for (var k = 0; k < cand; k++) {
        var a = U.AMIN + (U.AMAX - U.AMIN) * ((k + 0.5) / cand);
        var e = P.evalAngle(b, a, opt);
        var sc = e.tgtKilled * 1000 + e.hpDealt * 10 + e.gained * 400 + (e.cleared ? 1e6 : 0);
        sc *= (0.7 + rnd() * 0.6);          // 扰动：模拟人不会每次都选到最优
        if (sc > bestScore) { bestScore = sc; bestA = a; }
      }
      var s = P.shot(b, bestA, { mutate: true, dmg: opt.dmg, boomR: opt.boomR, boomDmg: opt.boomDmg, solve: true, spawn: sp });
      while (s.alive && s.steps < P.MAX_STEPS && s.tgtLeft > 0) P.step(s);
      if (s.tgtLeft <= 0) return true;
    }
    return false;
  }

  function verify(lv, opt) {
    opt = opt || {};
    // 防御：按关卡自身的几何对齐 B.C，求解器/物理才会在正确的墙边界里跑
    Bd.applyGeo(lv.cols || C.COLS, lv.rows ? lv.rows.length : C.ROWS);
    var board = Bd.fromLevel(lv);
    var T = opt.tries || 6;
    var rnd = U.rng(0x9e37 + (lv.n || 1) * 131);
    var win = 0;
    for (var i = 0; i < T; i++) if (playout(board, board.balls, rnd, opt)) win++;
    return { rate: win / T, win: win, tries: T };
  }

  // ============ 生成 + 验证循环 ============
  // 铁律：绝不发出 rate=0 的死关。每轮用独立种子重摇（门 to 映射 + 布局一并重来），
  // 只保留"可解"的候选；全失败则降级兜底（撤门/降密度），理论不可达时丢一个保底可通关。
  function gen(n, opt) {
    opt = opt || {};
    var p = paramsFor(n);
    var minRate = n < 10 ? 0.25 : 0.12;
    var maxRate = n < 10 ? 1.01 : 0.85;
    var best = null, bestScore = -1;

    for (var attempt = 0; attempt < 8; attempt++) {
      // 每轮独立种子：布局与门 to 映射都重新生成，避免"同一无解 layout 反复试 8 次"
      var rnd = U.rng((((n * 7919 + 13) >>> 0) ^ ((attempt + 1) * 0x9e3779b1)) >>> 0);
      // 每失败一次就放宽一点点，最后一定能出得来（不会卡死玩家）
      var q = {
        targets: p.targets, tgtHp: p.tgtHp,
        density: Math.max(0.06, p.density - attempt * 0.03),
        steel: Math.max(0, p.steel - Math.floor(attempt / 3)),
        bomb: Math.max(0, p.bomb - Math.floor(attempt / 5)),
        portals: p.portals, portalNodes: p.portalNodes, plus: p.plus,
        coin: p.coin, crack: p.crack, bumper: p.bumper,
        hpMax: Math.max(1, p.hpMax - Math.floor(attempt / 3)),
        wells: Math.max(0, p.wells - Math.floor(attempt / 3)),   // 试了几轮还过不了就撤掉井，绝不卡死玩家
        balls: p.balls,
        geo: p.geo                                            // 本关几何（大地图/小地图）
      };
      var lo = layout(n, q, rnd);
      var lv = {
        n: n, name: '', segs: opt.segs == null ? 2 : opt.segs,
        tgtHp: q.tgtHp, balls: q.balls,
        rows: lo.rows, portals: lo.portals, wells: lo.wells, movers: lo.movers,
        cols: lo.cols
      };
      var v = verify(lv, {
        tries: 6, dmg: opt.dmg || 1, boomR: opt.boomR || 112, boomDmg: opt.boomDmg || 2
      });
      // 绝不接受 rate=0：无解关绝不发出去（"该失败就失败"但关本身必须可通）
      if (v.rate <= 0) continue;
      var score = v.rate;
      // 越靠近 [minRate, maxRate] 越好
      var fit = v.rate >= minRate && v.rate <= maxRate ? 2 : 1;
      var tot = fit * 10 + (v.rate > maxRate ? -v.rate : v.rate);
      if (tot > bestScore) { bestScore = tot; best = lv; best.rate = v.rate; }
      if (fit === 2) break;
    }

    // 兜底：8 轮全无解，撤掉传送门 + 压低密度/目标，保证至少能通（永不发死关）
    if (!best) {
      for (var fb = 0; fb < 12 && !best; fb++) {
        var frnd = U.rng((((n * 7919 + 13) >>> 0) ^ ((0x5151 + fb) * 0x85ebca77)) >>> 0);
        var fq = {
          targets: Math.min(p.targets, 4), tgtHp: p.tgtHp,
          density: Math.max(0.05, p.density * 0.5),
          steel: 0, bomb: 0, portals: 0, portalNodes: 0, plus: p.plus,
          coin: 0, crack: 0, bumper: 0, hpMax: 1, wells: 0, balls: p.balls, geo: p.geo
        };
        var flo = layout(n, fq, frnd);
        var flv = { n: n, name: '', segs: 2, tgtHp: fq.tgtHp, balls: fq.balls, rows: flo.rows, portals: flo.portals, wells: flo.wells, cols: flo.cols };
        var fv = verify(flv, { tries: 6, dmg: 1, boomR: 112, boomDmg: 2 });
        if (fv.rate > 0) { best = flv; best.rate = fv.rate; }
      }
    }

    // 绝对兜底（理论不可达）：放一个无遮挡、单目标、满球的关，必定可通
    if (!best) {
      Bd.applyGeo(p.geo.cols, p.geo.rows);
      var rows0 = [];
      for (var rr = 0; rr < p.geo.rows; rr++) {
        var s0 = '';
        for (var cc = 0; cc < p.geo.cols; cc++) s0 += '.';
        rows0.push(s0);
      }
      var mc0 = Math.floor(p.geo.cols / 2);
      var ra0 = rows0[2].split(''); ra0[mc0] = '*'; rows0[2] = ra0.join('');
      best = { n: n, name: '', segs: 2, tgtHp: 1, balls: p.balls, rows: rows0, portals: [], wells: [], cols: p.geo.cols, rate: 1 };
    }
    return best;
  }

  function count() { return HAND.length; }

  // 取第 n 关（n 从 1 开始）
  function level(n, opt) {
    if (n <= HAND.length) {
      var h = HAND[n - 1];
      return {
        n: n, name: h.name, balls: h.balls, segs: h.segs, tgtHp: h.tgtHp, rows: h.rows, hand: true
      };
    }
    return gen(n, opt);
  }

  return {
    HAND: HAND, count: count, level: level, gen: gen, verify: verify,
    paramsFor: paramsFor, layout: layout, playout: playout, geoFor: geoFor
  };
})();

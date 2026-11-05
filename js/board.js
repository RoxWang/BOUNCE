// board.js —— 世界常量 + 棋盘数据结构
var B = window.B = window.B || {};

// 世界坐标是固定的（760×980），画布按窗口缩放后居中。
// 好处：所有物理、关卡、求解器都用同一套数，跟屏幕大小无关。
B.C = {
  W: 760, H: 980,
  COLS: 9, ROWS: 11,
  CELL: 76,
  BX: 38,          // 棋盘左边距
  BY: 62,          // 棋盘上边距
  LAUNCH_Y: 938,   // 发射点所在的 y
  BALL_R: 9,
  SPEED: 900,      // 球匀速（匀速 = 轨迹可预测 = 玩家能推理）
  ROT_STEP: 0.052, // 键盘/触屏每次转角的弧度（≈3°）
  BOTTOM: 962,     // 越过这条线算落底
  MAX_PORTAL: 6,   // 单发球用传送门的次数上限：超过就判该发落空结束，杜绝"来回穿梭最后消失"
  MAX_STEPS: 2600, // 单发球子步上限（随地图面积在 applyGeo 里放大）：正常几百步就落底
  GRAV_STRENGTH: 3800, // PHASE 2 引力场：井的加速度（px/s²），越大弯得越狠
  GRAV_RADIUS: 200     // 井的作用半径（px，约 2.6 格）
};

B.C.BW = B.C.COLS * B.C.CELL;   // 684
B.C.BH = B.C.ROWS * B.C.CELL;   // 836

// 8 个标准方向（单位向量）。传送门的"出口方向"就是这表里的一项。
// 门上画箭头让玩家直接看到它会往哪喷，玩家只算"怎么把球送进门"，出来往哪走由门定义死。
B.DIR = {
  up:    { x: 0, y: -1 },
  down:  { x: 0, y: 1 },
  left:  { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  ul:    { x: -0.7071, y: -0.7071 },
  ur:    { x: 0.7071, y: -0.7071 },
  dl:    { x: -0.7071, y: 0.7071 },
  dr:    { x: 0.7071, y: 0.7071 }
};
// 出口方向：既认方向名（'up'/'down'/...，兼容旧关卡），也认数字弧度（任意 360° 角度，用户硬需求）。
// 数字时直接返回单位向量 (cosθ, sinθ)；canvas 里 y 向下，所以 θ 按屏幕坐标解释，箭头与出口速度方向一致。
function dirVec(d) {
  if (typeof d === 'number') return { x: Math.cos(d), y: Math.sin(d) };
  return B.DIR[d] || B.DIR.up;
}

B.Board = (function () {
  var C = B.C;

  // 格子字符 → 数据
  //  . 空   1-9 普通砖(数字=血)   * 目标砖   # 钢块   B 炸弹
  //  + 拾取加一球   X 裂缝砖(碎时全场砖-2)   O 金币砖(碎时+金币)   U 弹板(圆形,弹开+连击)
  //  传送门不再用字符表示（方向说不清），改由关卡里的 portals 数组显式定义：
  //    { c, r, gid, dir } —— c/r 坐标、gid 组号、dir 出口方向(见 B.DIR)。
  //  同 gid 的门按 (行,列) 顺序排成环：进第 i 个，必从第 i+1 个出来（2个=成对，3个=A→B→C→A）。
  var CHAR = {
    '#': { t: 'steel' },
    'B': { t: 'bomb' },
    '+': { t: 'plus' },
    '*': { t: 'brick', target: true },
    'X': { t: 'crack' },
    'O': { t: 'coin' },
    'U': { t: 'bumper' }
  };

  function make(cols, rows) {
    var b = {
      cols: cols, rows: rows,
      cells: new Array(cols * rows),
      balls: 4,
      segs: 2,
      launchX: C.W / 2,
      name: '', n: 0, tgtHp: 1,
      wells: null,
      cd: null,            // 传送门冷却表：'c,r' → 可用时间戳（秒）。null 表示从未用过门
      movers: null         // 动体方块列表（两发之间在网格内平移）；null = 本关无动块
    };
    for (var i = 0; i < b.cells.length; i++) b.cells[i] = null;
    return b;
  }

  function idx(b, c, r) { return r * b.cols + c; }
  function inB(b, c, r) { return c >= 0 && c < b.cols && r >= 0 && r < b.rows; }
  function get(b, c, r) { return inB(b, c, r) ? b.cells[r * b.cols + c] : null; }
  function set(b, c, r, v) { if (inB(b, c, r)) b.cells[r * b.cols + c] = v; }

  // 格子左上角（世界坐标）
  function cx(c) { return C.BX + c * C.CELL; }
  function cy(r) { return C.BY + r * C.CELL; }
  function ccx(c) { return C.BX + c * C.CELL + C.CELL / 2; }
  function ccy(r) { return C.BY + r * C.CELL + C.CELL / 2; }

  // 世界坐标 → 格子（可能越界，返回 -1）
  function colAt(x) { return Math.floor((x - C.BX) / C.CELL); }
  function rowAt(y) { return Math.floor((y - C.BY) / C.CELL); }

  // 从关卡定义构建棋盘
  function fromLevel(lv) {
    var rows = lv.rows || [];
    // 没显式给 cols 时，从首行宽度自取——纯由 rows 定义的棋盘应能自洽，
    // 不依赖全局 C.COLS（否则别的测试改过几何后这里会被悄悄撑成别的列数）。
    var cols = lv.cols != null ? lv.cols : (rows[0] ? rows[0].length : C.COLS);
    var rws = (lv.rows && lv.rows.length) || C.ROWS;
    var b = make(cols, rws);
    b.name = lv.name || ''; b.n = lv.n || 0;
    b.balls = lv.balls || 4;
    b.segs = lv.segs == null ? 2 : lv.segs;
    b.tgtHp = lv.tgtHp || 1;
    b.launchX = (lv.launchX != null) ? lv.launchX : (C.BX + cols * C.CELL / 2);
    for (var r = 0; r < Math.min(rows.length, rws); r++) {
      var line = rows[r];
      for (var c = 0; c < Math.min(line.length, cols); c++) {
        var ch = line[c];
        if (ch === '.' || ch === ' ') { set(b, c, r, null); continue; }
        if (ch >= '1' && ch <= '9') {
          set(b, c, r, { t: 'brick', hp: +ch, max: +ch, target: false });
          continue;
        }
        var d = CHAR[ch];
        if (!d) { set(b, c, r, null); continue; }
        if (d.t === 'brick' && d.target) set(b, c, r, { t: 'brick', hp: b.tgtHp, max: b.tgtHp, target: true });
        else if (d.t === 'steel') set(b, c, r, { t: 'steel' });
        else if (d.t === 'bomb') set(b, c, r, { t: 'bomb' });
        else if (d.t === 'plus') set(b, c, r, { t: 'plus' });
        else if (d.t === 'crack') set(b, c, r, { t: 'crack' });
        else if (d.t === 'coin') set(b, c, r, { t: 'coin' });
        else if (d.t === 'bumper') set(b, c, r, { t: 'bumper' });
      }
    }
    // 传送门：每个门带 gid(颜色组) + dir(出口方向，数字角度) + to(作者设定的出口 key，求解器/预测用)。
    // to = 'c,r' 字符串：进这扇门，从 to 指向的那扇出来。to 由生成器随机指定（每发独立、出口随机）。
    if (lv.portals) {
      for (var pi = 0; pi < lv.portals.length; pi++) {
        var pd = lv.portals[pi];
        if (pd.c == null || pd.r == null) continue;
        if (!inB(b, pd.c, pd.r)) continue;
        b.cells[pd.r * b.cols + pd.c] = {
          t: 'portal',
          gid: pd.gid || 0,
          dir: (pd.dir != null ? pd.dir : 'up'),
          to: (pd.to != null ? pd.to : null),   // null = 孤儿门，撞上当成实心墙
          spin: pd.spin || 0,                  // ≠0 = 旋转门：出口方向随时间转，球从指针方向出
          baseDir: (pd.dir != null ? pd.dir : 0)
        };
      }
    }
    // 引力场（PHASE 2，100关后）：从关卡的 wells 数组放置。每个井带 c/r 坐标 + type(attract/repel)，
    // strength/radius 缺省用全局常量。井是固定的、不讲运气——同一关每次进来场完全一样，玩家可以反复算。
    if (lv.wells) {
      b.wells = [];
      for (var wi = 0; wi < lv.wells.length; wi++) {
        var wl = lv.wells[wi];
        if (wl.c == null || wl.r == null) continue;
        b.wells.push({
          x: ccx(wl.c), y: ccy(wl.r),
          type: wl.type || 'attract',
          strength: wl.strength == null ? C.GRAV_STRENGTH : wl.strength,
          radius: wl.radius == null ? C.GRAV_RADIUS : wl.radius
        });
      }
      if (!b.wells.length) b.wells = null;
    }
    // 动体方块：从关卡的 movers 数组登记。每个动块是一个普通砖格，在两发之间沿 path 路径（乒乓）平移。
    // path 是格子坐标数组（≥2）：直线 AB 或转角 ABC（弧线感）。物理完全确定性（平移只发生在"两发之间"，
    // 飞行途中棋盘不动），所以预测=真实这条红线不被破坏；渲染时再补一段平滑滑动动画让"在动"看得出来。
    if (lv.movers && lv.movers.length) {
      b.movers = [];
      for (var mi = 0; mi < lv.movers.length; mi++) {
        var m = lv.movers[mi];
        if (!m.path || m.path.length < 2) continue;
        var hc = m.path[0].c, hr = m.path[0].r;
        if (!inB(b, hc, hr)) continue;
        var mc = { c: hc, r: hr, dir: 1, idx: 0, path: m.path,
                   fromX: ccx(hc), fromY: ccy(hr), toX: ccx(hc), toY: ccy(hr), animStart: 0 };
        b.movers.push(mc);
        var mcell = b.cells[hr * b.cols + hc];
        if (mcell) mcell.mover = b.movers.length - 1;   // 标在格子上：render 据此跳过普通砖画法，改走动块画法
      }
      if (!b.movers.length) b.movers = null;
    }
    return b;
  }

  // 深拷贝：模拟（预测轨迹 / 求解器）必须在不污染真实棋盘的前提下跑
  function clone(b) {
    var n = make(b.cols, b.rows);
    n.balls = b.balls; n.segs = b.segs; n.launchX = b.launchX;
    n.name = b.name; n.n = b.n; n.tgtHp = b.tgtHp;
    n.wells = b.wells;   // 井是静态的，不随模拟变化，直接共享引用即可（预测和真实用同一份 → 虚线=真实）
    n.cd = b.cd;         // 冷却表：模拟（预测）时只读不写，写只在真实发射(mutate)时进行
    n.movers = b.movers; // 动块列表：模拟时不移动，移动只发生在真实对局的两发之间
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      n.cells[i] = v ? { t: v.t, hp: v.hp, max: v.max, target: v.target, gid: v.gid, dir: v.dir, to: v.to, spin: v.spin, baseDir: v.baseDir } : null;
    }
    return n;
  }

  function countTargets(b) {
    var n = 0;
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      if (v && v.target && v.hp > 0) n++;
    }
    return n;
  }

  // 作者设定的出口（确定性）：进 (c,r) 这扇门，从它 to 指向的那扇出来。
  // 用于"预测线截断后仍需继续模拟"的求解器/预测签名校验——真实飞行(live)的随机出口在 physics.js 里算。
  // 孤儿门(to 为空 或 指向不存在的门) 返回 null → 当成实心墙。
  function portalExit(b, c, r) {
    var here = b.cells[r * b.cols + c];
    if (!here || here.t !== 'portal') return null;
    if (!here.to) return null;
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      if (!v || v.t !== 'portal') continue;
      var pc = i % b.cols, pr = (i / b.cols) | 0;
      if (pc + ',' + pr === here.to) return { c: pc, r: pr, dir: dirVec(v.dir) };
    }
    return null;
  }

  // 每关几何：把世界坐标系按本关格子数重新铺一遍（一次只激活一个棋盘，直接改 B.C 最稳，
  // 物理/渲染所有公式都不用动）。100+ 关用更大的方块地图，render 自动缩放适配屏幕。
  function applyGeo(cols, rows) {
    var C = B.C;
    C.COLS = cols; C.ROWS = rows;
    C.BW = cols * C.CELL; C.BH = rows * C.CELL;
    C.BX = 38;
    C.W = C.BW + C.BX * 2;          // 棋盘左右各留 38 边距
    C.BY = 62;
    C.LAUNCH_Y = C.BY + C.BH + 40;  // 棋盘下方 40 留作发射区
    C.BOTTOM = C.LAUNCH_Y + 24;     // 越过这条线算落底
    C.H = C.BOTTOM + 18;
    C.MAX_STEPS = Math.round(2600 * (cols * rows) / (9 * 11));  // 大地图一发要走更远，子步上限同步放大
  }
  applyGeo(9, 11);   // 默认几何（弹珠 1–100 关）

  // 关卡定义 → 紧凑字符串（存缓存用）
  function serialize(lv) {
    return JSON.stringify(lv);
  }
  function deserialize(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  return {
    make: make, idx: idx, get: get, set: set, inB: inB,
    cx: cx, cy: cy, ccx: ccx, ccy: ccy, colAt: colAt, rowAt: rowAt,
    fromLevel: fromLevel, clone: clone, countTargets: countTargets,
    portalExit: portalExit, applyGeo: applyGeo, dirVec: dirVec, serialize: serialize, deserialize: deserialize
  };
})();

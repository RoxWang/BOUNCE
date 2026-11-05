// physics.js —— 弹射物理
// 两条铁律：
//  1) 球永远匀速。没有重力、没有摩擦——匀速意味着轨迹可以被精确预测，玩家才谈得上"算"。
//  2) 预测轨迹和真实发射跑的是同一份代码（同一个 shot/advance），所以虚线画到哪，球就真走到哪。
var B = window.B = window.B || {};

B.Phys = (function () {
  var C = B.C, Bd = B.Board, U = B.U;

  var STEP = 2.0;        // 每个子步前进 2 像素（远小于球半径，绝不会穿过一格）

  // 传送门"连续上限"规则（用户硬需求）：单个球一发之内连续碰传送门最多 2 次，
  // 第 3 次直接当实心墙反弹；必须先撞到别的方块把 portalStreak 清零，才能再用门。
  // 这比"固定冷却秒数"更贴合手感——靠"歇一下"而非"等时间"，也彻底杜绝长串门链死循环。
  // clock 仍保留给 game.js 调用（update 里 tick 推进实时），但不再驱动冷却。
  var clock = 0;
  function tick(dt) { clock += dt; }

  // 寿命阈值（随地图面积缩放：前期小图寿命短、后期大图寿命长，避免"小图球秒没 / 大图球永远撞不腻"）。
  // 双阈值：时间(steps) 或 反弹次数 先到哪个，球就消失——用户定位"时间或次数都行，先到先没"。
  // 具体数值按试玩手感调，这里给的是随面积线性缩放的稳妥默认值。
  function lifeStepsFor(b) {
    var area = (b.cols || 9) * (b.rows || 11);
    var sec = U.clamp(4 + area * 0.02, 4, 9);   // 4s ~ 9s
    var ls = Math.round(sec * C.SPEED / STEP);  // steps = 秒 × (SPEED/STEP)；STEP 是 physics 模块内的局部常量，不是 C.STEP
    // 卡在 MAX_STEPS 的 95% 以内，保证"寿命到点"先触发、不会退化成 timeout
    return Math.min(ls, Math.round(C.MAX_STEPS * 0.95));
  }
  function maxBouncesFor(b) {
    var area = (b.cols || 9) * (b.rows || 11);
    return Math.round(U.clamp(25 + area * 0.2, 25, 70));
  }

  // 开一发。opt.mutate=true 表示直接改真实棋盘；否则内部克隆一份（预测用）
  function shot(board, angle, opt) {
    opt = opt || {};
    var b = opt.mutate ? board : Bd.clone(board);
    var sp = (opt.power == null ? 1 : opt.power) * C.SPEED;
    // kind 决定这一发怎么走传送门：
    //   preview = 预测虚线（画到门口就截断，后面的全是随机，画了也骗人）
    //   solve   = 求解器/预测签名（走"作者设定的 to"出口，确定性，便于验证可解性）
    //   live    = 真实发射（每个门每次随机指到另一个门，纯随机——用户硬需求）
    var kind = opt.preview ? 'preview' : (opt.solve ? 'solve' : 'live');
    // live 的随机性来自这里：每发一个独立种子，所以"同一关每次发射出口都不同"。测试可传 opt.rng 锁定。
    var rng = opt.rng || U.rng((Date.now() ^ ((typeof Math.random === 'function' ? (Math.random() * 0x7fffffff) : 1)) >>> 0));
    // 出生点：opt.spawn 优先（新弹珠机制 = 鼠标点击的发射标记），否则退回旧默认值（求解器/兼容用）
    var sx = opt.spawn ? opt.spawn.x : (board.launchX || C.BX + C.BW / 2);
    var sy = opt.spawn ? opt.spawn.y : C.LAUNCH_Y;
    // 寿命（预测虚线用 previewSteps 截断，短一点好看；真实球用随地图缩放的双阈值）
    var lifeSteps = opt.preview ? (opt.previewSteps || 900) : lifeStepsFor(b);
    var maxBounces = opt.preview ? 1e9 : maxBouncesFor(b);
    var s = {
      board: b,
      mutate: !!opt.mutate,
      kind: kind,
      rng: rng,
      x: sx, y: sy,
      vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
      bounces: 0,                 // 累计反弹次数（墙/砖/弹板都算），到 maxBounces 球消失
      lifeSteps: lifeSteps,       // 时间阈值（子步数），到 lifeSteps 球消失
      maxBounces: maxBounces,
      alive: true,
      noPortal: false,
      portalUses: 0,   // 单发球用传送门次数，超过上限直接判落空（防卡死环）
      portalStreak: 0, // 连续用门计数：连碰 2 次后第 3 次当实心墙，须先撞别的方块清零
      used: {},        // 本发已经用过的门(c+','+r)：用过的门变实心，杜绝 A→B→B→A 死循环
      combo: 0,
      dmg: opt.dmg == null ? 1 : opt.dmg,
      boomR: opt.boomR == null ? 112 : opt.boomR,
      boomDmg: opt.boomDmg == null ? 2 : opt.boomDmg,
      chain: opt.chain || 6,     // 每多少连击加 1 点伤害（强化站可以把它降到 4）
      stopOnClear: opt.stopOnClear !== false,  // 目标清完立刻收工（预测和真实必须一致，否则虚线骗人）
      tgtLeft: Bd.countTargets(b),   // 维护计数，省得每步都遍历整块棋盘
      coins: 0,                      // 这一发从金币砖里敲出来的钱
      steps: 0,
      hits: 0, gained: 0,
      events: [],       // 给特效用的事件流
      pts: [],          // 轨迹采样点
      segIdx: [0],      // 每一段起点在 pts 里的下标（第 0 段从 0 开始）
      sample: 0,
      truncated: false  // 预测线在传送门处被截断时为 true
    };
    s.pts.push({ x: s.x, y: s.y });
    return s;
  }

  // 列出棋盘上所有传送门（带 key='c,r'，便于按 to 匹配出口）
  function allPortals(b) {
    var out = [];
    for (var r = 0; r < b.rows; r++) for (var c = 0; c < b.cols; c++) {
      var v = Bd.get(b, c, r);
      if (v && v.t === 'portal') out.push({ c: c, r: r, dir: v.dir, to: v.to, key: c + ',' + r });
    }
    return out;
  }

  // 圆心到矩形的最近点
  function closestOnRect(px, py, rx, ry, rw, rh) {
    return { x: px < rx ? rx : (px > rx + rw ? rx + rw : px),
             y: py < ry ? ry : (py > ry + rh ? ry + rh : py) };
  }

  // 球心陷在格子内部时（快速挤入角落），用最小穿透轴当法线
  function axisNormal(px, py, rx, ry, rw, rh) {
    var l = px - rx, r = rx + rw - px, t = py - ry, bo = ry + rh - py;
    var m = Math.min(l, r, t, bo);
    if (m === l) return { x: -1, y: 0 };
    if (m === r) return { x: 1, y: 0 };
    if (m === t) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  // 统一走这里清除格子：顺便维护"还剩几个目标"的计数
  function kill(s, i, v) {
    if (v && v.t === 'brick' && v.target) s.tgtLeft--;
    s.board.cells[i] = null;
  }

  // 爆炸：炸掉范围内砖块的血，并连锁引爆其它炸弹
  function explode(s, x0, y0, depth) {
    if (depth > 4) return;
    var R = s.boomR, b = s.board;
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      if (!v) continue;
      var c = i % b.cols, r = (i / b.cols) | 0;
      var px = Bd.ccx(c), py = Bd.ccy(r);
      if (U.dist(px, py, x0, y0) > R) continue;
      if (v.t === 'bomb') {
        b.cells[i] = null;
        s.events.push({ t: 'boom', x: px, y: py, r: R });
        explode(s, px, py, depth + 1);
      } else if (v.t === 'brick') {
        v.hp -= s.boomDmg; s.hits++;
        if (v.hp <= 0) {
          kill(s, i, v);
          s.events.push({ t: v.target ? 'tgt' : 'brk', x: px, y: py, boom: true });
        } else {
          s.events.push({ t: 'dmg', x: px, y: py });
        }
      } else if (v.t === 'plus') {
        // 顺手炸掉也吃掉
        b.cells[i] = null; s.gained++;
        s.events.push({ t: 'plus', x: px, y: py });
      }
    }
  }

  // 裂缝砖碎了：全场所有砖一起掉 2 血。一发清屏的"拆迁按钮"。
  function crackAll(s) {
    var b = s.board;
    for (var i = 0; i < b.cells.length; i++) {
      var v = b.cells[i];
      if (!v || v.t !== 'brick') continue;
      var c = i % b.cols, r = (i / b.cols) | 0;
      var px = Bd.ccx(c), py = Bd.ccy(r);
      v.hp -= 2; s.hits++;
      if (v.hp <= 0) {
        kill(s, i, v);
        s.events.push({ t: v.target ? 'tgt' : 'brk', x: px, y: py });
      } else {
        s.events.push({ t: 'dmg', x: px, y: py });
      }
    }
  }

  // 命中一个格子。返回 true = 这个格子没了，球照直穿过（不反弹）
  function onHit(s, c, r, v) {
    var b = s.board, i = Bd.idx(b, c, r);
    var px = Bd.ccx(c), py = Bd.ccy(r);

    // 撞到任何实体方块（传送门以外的）= 给传送门"歇一下"：连续用门计数清零
    if (v.t !== 'portal') s.portalStreak = 0;

    if (v.t === 'steel') { s.events.push({ t: 'wall', x: px, y: py }); return false; }

    if (v.t === 'crack') {
      kill(s, i, v);
      s.events.push({ t: 'crack', x: px, y: py });
      crackAll(s);
      return true;
    }

    if (v.t === 'coin') {
      kill(s, i, v);
      s.coins += 15;
      s.events.push({ t: 'coin', x: px, y: py });
      return true;
    }

    if (v.t === 'plus') {
      kill(s, i, v); s.gained++;
      s.events.push({ t: 'plus', x: px, y: py });
      return true;
    }

    if (v.t === 'bomb') {
      kill(s, i, v);
      s.events.push({ t: 'boom', x: px, y: py, r: s.boomR });
      explode(s, px, py, 1);
      return true;
    }

    if (v.t === 'portal') {
      // 连续用门上限：同一发里已经连碰过 2 次传送门，第 3 次直接当实心墙反弹——
      // 必须先撞到别的方块把计数清零，才能再用门。这比"固定冷却秒数"更贴合手感，也彻底杜绝长串门链死循环。
      if (s.portalStreak >= 2) return false;
      // 每个门在一发里只能用一次：再次进入就当实心墙反弹。这是根治"两门之间来回穿梭"死循环的关键。
      // 旧版只靠 MAX_PORTAL 护栏，球还是会蹦几下才被强行结束（像卡死）；现在用过的门直接失效，绝不成环。
      if (s.used[c + ',' + r]) return false;
      if (s.noPortal) return false;                          // 刚从某门出来，离开门前不再触发，防原地反复
      if (s.portalUses >= C.MAX_PORTAL) {                    // 护栏：同一发用门太多次 = 卡死环，直接判该发落空
        s.alive = false; s.end = 'portalloop';
        s.events.push({ t: 'portal', x: s.x, y: s.y, voided: true });
        return 'portalloop';
      }
      var list = allPortals(b);
      var ex = null;
      if (s.kind === 'live') {
        // 真实发射：进 A 门可能从 C、D 任意一扇出来——每发随机，且每扇门一发只用一次。
        // 正是"传送门之间不互相绑死、每个独立随机"的硬需求；预测虚线因此只在门口截断。
        var cand = [];
        for (var li = 0; li < list.length; li++) {
          var p = list[li];
          if (p.key !== (c + ',' + r) && !s.used[p.key]) cand.push(p);
        }
        if (!cand.length) return false;                     // 没别的门可去 → 实心墙
        var pk = cand[s.rng.int(cand.length)];
        ex = { c: pk.c, r: pk.r, dir: dirVec(pk.dir) };
      } else {
        // 预测/求解：走"作者设定的 to"出口（确定性）。预测线会在 run() 里于门口截断，不会泄露随机结果。
        if (!v.to) return false;
        for (var mi = 0; mi < list.length; mi++) {
          if (list[mi].key === v.to) { ex = { c: list[mi].c, r: list[mi].r, dir: dirVec(list[mi].dir) }; break; }
        }
        if (!ex) return false;
      }
      s.used[c + ',' + r] = true;                           // 标记本门已用（只标入口；出口下次作为入口再标）
      // 瞬移到"出口门"的外沿，并把它自己的 dir 当成出口速度方向。
      // 关键：出来往哪走由门定义，不继承进来时的方向 → 不会再因为"方向被保留"而形成来回穿梭。
      var off = C.CELL / 2 + C.BALL_R + 1;
      s.x = Bd.ccx(ex.c) + ex.dir.x * off;
      s.y = Bd.ccy(ex.r) + ex.dir.y * off;
      s.vx = ex.dir.x * C.SPEED;
      s.vy = ex.dir.y * C.SPEED;
      s.noPortal = true;
      s.portalUses++;
      s.portalStreak++;                                    // 连续用门 +1；满 2 后下次当实心墙
      s.events.push({ t: 'portal', x: s.x, y: s.y, fromC: c, fromR: r, toC: ex.c, toR: ex.r, dir: ex.dir, live: s.kind === 'live' });
      return 'portal';
    }

    if (v.t === 'brick') {
      var dmg = s.dmg + Math.floor(s.combo / s.chain);
      v.hp -= dmg; s.combo++; s.hits++;
      if (v.hp <= 0) {
        kill(s, i, v);
        s.events.push({ t: v.target ? 'tgt' : 'brk', x: px, y: py });
        return true;
      }
      s.events.push({ t: 'hit', x: px, y: py, combo: s.combo, hp: v.hp });
      return false;
    }
    return false;
  }

  // 推进一个子步
  function step(s) {
    var R = C.BALL_R, b = s.board;
    var left = C.BX, right = C.BX + C.BW, top = C.BY, bottom = C.BY + C.BH;  // 四边全封：底边也反射

    // --- 引力场（PHASE 2，100关后才有井）：井对球施加加速度，球走曲线。
    //     就写在这里——真实飞行(advance)和预测(run)都走 step()，所以虚线画到哪、球就真走到哪。
    var wells = b.wells;
    if (wells) {
      var dt = STEP / C.SPEED;
      for (var _w = 0; _w < wells.length; _w++) {
        var W = wells[_w];
        var dx = W.x - s.x, dy = W.y - s.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= W.radius || d < 1) continue;
        var fall = 1 - d / W.radius;            // 作用范围内：边缘 0 → 中心 1
        var a = W.strength * fall * dt;          // 本子步的速度增量（与速度同量纲）
        var ux = dx / d, uy = dy / d;
        if (W.type === 'repel') { ux = -ux; uy = -uy; }   // 斥力把球推开
        s.vx += ux * a; s.vy += uy * a;
      }
    }

    s.x += s.vx * (STEP / C.SPEED);
    s.y += s.vy * (STEP / C.SPEED);
    s.steps++;

    // --- 寿命：时间(steps) 或 反弹次数 先到哪个，球就消失（阈值随地图缩放）---
    if (s.steps >= s.lifeSteps || s.bounces >= s.maxBounces) {
      s.alive = false; s.end = 'life'; return 'life';
    }

    // --- 边界（四边全实心墙，球进得去出不来）---
    if (s.x < left + R) { s.x = left + R; if (s.vx < 0) { s.vx = -s.vx; bounce(s, 'wall'); } }
    else if (s.x > right - R) { s.x = right - R; if (s.vx > 0) { s.vx = -s.vx; bounce(s, 'wall'); } }
    if (s.y < top + R) { s.y = top + R; if (s.vy < 0) { s.vy = -s.vy; bounce(s, 'wall'); } }
    if (s.y > bottom - R) { s.y = bottom - R; if (s.vy > 0) { s.vy = -s.vy; bounce(s, 'wall'); } }

    // --- 格子碰撞：只处理穿透最深的那个，最多两轮（角落双碰也稳） ---
    for (var pass = 0; pass < 2; pass++) {
      var bc = Bd.colAt(s.x), br = Bd.rowAt(s.y);
      var best = null, bestD = 1e9, bestC = 0, bestR = 0, hitBumper = false;
      for (var dc = -1; dc <= 1; dc++) {
        for (var dr = -1; dr <= 1; dr++) {
          var c = bc + dc, r = br + dr;
          var v = Bd.get(b, c, r);
          if (!v) continue;
          // 弹板是圆的，不走 AABB：圆-圆检测，弹开还给连击奖励
          if (v.t === 'bumper') {
            var bx2 = Bd.ccx(c), by2 = Bd.ccy(r);
            var dd = Math.hypot(s.x - bx2, s.y - by2);
            var rr = 26 + R;
            if (dd < rr) {
              var n2 = dd < 1e-6 ? { x: 0, y: -1 } : { x: (s.x - bx2) / dd, y: (s.y - by2) / dd };
              s.x = bx2 + n2.x * (rr + 0.05); s.y = by2 + n2.y * (rr + 0.05);
              var dot2 = s.vx * n2.x + s.vy * n2.y;
              if (dot2 < 0) { s.vx -= 2 * dot2 * n2.x; s.vy -= 2 * dot2 * n2.y; }
              s.combo += 2; s.hits++;
              s.events.push({ t: 'bumper', x: bx2, y: by2, combo: s.combo });
              bounce(s, 'bumper');
              hitBumper = true;
              break;
            }
            continue;
          }
          var rx = Bd.cx(c), ry = Bd.cy(r);
          var q = closestOnRect(s.x, s.y, rx, ry, C.CELL, C.CELL);
          var dx = s.x - q.x, dy = s.y - q.y;
          var d = Math.hypot(dx, dy);
          if (d < R && d < bestD) { bestD = d; best = v; bestC = c; bestR = r; }
        }
        if (hitBumper) break;
      }
      if (hitBumper) break;
      if (!best) break;

      var rx2 = Bd.cx(bestC), ry2 = Bd.cy(bestR);
      var n;
      if (bestD < 1e-6) n = axisNormal(s.x, s.y, rx2, ry2, C.CELL, C.CELL);
      else {
        var q2 = closestOnRect(s.x, s.y, rx2, ry2, C.CELL, C.CELL);
        n = { x: (s.x - q2.x) / bestD, y: (s.y - q2.y) / bestD };
      }

      // 推出去一点，防止下一步又陷在里面
      s.x += n.x * (R - bestD + 0.05);
      s.y += n.y * (R - bestD + 0.05);

      var res = onHit(s, bestC, bestR, best);
      if (res === 'portalloop') return 'portalloop';
      if (res === 'portal') { bounce(s, 'portal'); return null; }

      if (res !== true) {
        // 还在：反射速度（只在"正在撞进去"时反射）
        var dot = s.vx * n.x + s.vy * n.y;
        if (dot < 0) { s.vx -= 2 * dot * n.x; s.vy -= 2 * dot * n.y; }
        bounce(s, best.t === 'steel' ? 'wall' : 'hit');
      }
    }

    // 离开所有传送门格子后才允许再次传送
    if (s.noPortal) {
      var pc = Bd.colAt(s.x), pr = Bd.rowAt(s.y);
      var cell = Bd.get(b, pc, pr);
      if (!cell || cell.t !== 'portal') s.noPortal = false;
    }

    if (s.steps >= C.MAX_STEPS) { s.alive = false; s.end = 'timeout'; return 'timeout'; }
    return null;
  }

  function bounce(s, kind) {
    s.bounces = (s.bounces || 0) + 1;   // 反弹次数 +1（寿命的"次数"维度就靠它）
    s.events.push({ t: 'bounce', x: s.x, y: s.y, kind: kind });
    s.segIdx.push(s.pts.length);
  }

  // 推进 n 个子步。返回 null（还活着）或结束原因
  function advance(s, n) {
    for (var i = 0; i < n; i++) {
      var e = step(s);
      s.sample++;
      if (s.sample % 2 === 0) s.pts.push({ x: s.x, y: s.y });
      if (e) { s.end = e; return e; }
      if (s.stopOnClear && s.tgtLeft <= 0) { s.end = 'clear'; return 'clear'; }
    }
    return null;
  }

  // 一口气跑完一发（预测 / 求解器用）
  function run(board, angle, opt) {
    var s = shot(board, angle, opt);
    while (s.alive && s.steps < C.MAX_STEPS) {
      var before = s.events.length;
      if (step(s)) break;
      s.sample++;
      if (s.sample % 2 === 0) s.pts.push({ x: s.x, y: s.y });
      // 预测虚线在传送门处截断：一发进了门，剩下的全是随机，画了也是骗人——只画到"进哪扇门"
      if (opt && opt.preview) {
        for (var e = before; e < s.events.length; e++) {
          if (s.events[e].t === 'portal') { s.end = 'portal'; s.truncated = true; return s; }
        }
      }
      if (s.stopOnClear && s.tgtLeft <= 0) { s.end = 'clear'; break; }
    }
    s.end = s.end || (s.alive ? 'timeout' : 'life');
    s.cleared = s.tgtLeft <= 0;
    return s;
  }

  // ---------- 多球（连发 + 球间弹性碰撞）----------
  // 两个球相撞：等质量弹性碰撞 = 沿连线法线的速度分量互换，垂直分量不变。
  // 这就是"往相反方向弹开、符合物理定律"；先按重叠量把两球推开，避免黏在一起反复触发。
  function collide(A, B) {
    var dx = B.x - A.x, dy = B.y - A.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var R = C.BALL_R;
    if (d >= 2 * R || d < 1e-6) return;
    var nx = dx / d, ny = dy / d;
    var overlap = 2 * R - d;
    A.x -= nx * overlap / 2; A.y -= ny * overlap / 2;
    B.x += nx * overlap / 2; B.y += ny * overlap / 2;
    var dvx = B.vx - A.vx, dvy = B.vy - A.vy;
    var vn = dvx * nx + dvy * ny;        // <0 表示正在靠近
    if (vn < 0) {
      A.vx += vn * nx; A.vy += vn * ny;
      B.vx -= vn * nx; B.vy -= vn * ny;
      A.events.push({ t: 'bbhit', x: A.x + nx * R, y: A.y + ny * R });
      B.events.push({ t: 'bbhit', x: B.x - nx * R, y: B.y - ny * R });
      A.segIdx.push(A.pts.length);
      B.segIdx.push(B.pts.length);
    }
  }

  // 多球同帧推进：每个子步先各自 step（撞墙/砖/门/弹板都在 step 里），再两两解这个球间碰撞，最后采样轨迹点。
  // 真实发射与预测都走它 → 多球下"预测虚线 = 真实弹道"依然成立（门后随机出口仍是唯一截断点）。
  function advanceMulti(balls, n) {
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < balls.length; j++) {
        var s = balls[j];
        if (!s.alive) continue;
        var before = s.events.length;
        step(s);
        if (s._truncatePortal) {    // 预测球：撞到传送门就截断（门后随机，画了骗人）
          for (var e = before; e < s.events.length; e++) {
            if (s.events[e].t === 'portal') { s.alive = false; s.truncated = true; s.end = 'portal'; break; }
          }
        }
        if (s.stopOnClear && s.tgtLeft <= 0) s.alive = false;
      }
      for (var a = 0; a < balls.length; a++) {
        for (var b2 = a + 1; b2 < balls.length; b2++) {
          if (balls[a].alive && balls[b2].alive) collide(balls[a], balls[b2]);
        }
      }
      for (var k = 0; k < balls.length; k++) {
        var sk = balls[k];
        if (!sk.alive) continue;
        sk.sample++;
        if (sk.sample % 2 === 0) sk.pts.push({ x: sk.x, y: sk.y });
      }
      var any = false;
      for (var m = 0; m < balls.length; m++) if (balls[m].alive) any = true;
      if (!any) break;
    }
  }

  // 多球预测：把"已在飞的其他球"克隆成预览球，和新球一起跑 advanceMulti。
  // 新球轨迹（含与其他球的碰撞拐点）就是预测虚线；所有预览球撞门即截断。
  function runMulti(board, existing, angle, opt) {
    var cb = Bd.clone(board);
    var balls = [];
    for (var i = 0; i < existing.length; i++) {
      var es = existing[i];
      var s = shot(cb, 0, { preview: true, mutate: true });
      s.x = es.x; s.y = es.y; s.vx = es.vx; s.vy = es.vy;
      s.alive = true; s.steps = es.steps || 0; s.sample = es.sample || 0;
      s.pts = [{ x: s.x, y: s.y }]; s.segIdx = [0];
      s.tgtLeft = es.tgtLeft != null ? es.tgtLeft : Bd.countTargets(cb);
      s._truncatePortal = true;
      balls.push(s);
    }
    var o = {}; for (var kk in opt) o[kk] = opt[kk];
    o.preview = true; o.mutate = true;
    var ns = shot(cb, angle, o);
    ns._truncatePortal = true;
    balls.push(ns);
    advanceMulti(balls, C.MAX_STEPS);
    ns.cleared = ns.tgtLeft <= 0;
    return ns;
  }

  // 只关心"这一发能打掉多少目标血"——求解器打分用，不算轨迹，快
  function evalAngle(board, angle, opt) {
    var o = {}; if (opt) for (var k in opt) o[k] = opt[k]; o.solve = true;  // 求解走"作者设定的 to"出口，确定性
    if (!o.spawn) o.spawn = { x: (board.launchX || C.BX + C.BW / 2), y: C.BY + C.BH - C.BALL_R - 2 };  // 新机制：默认从框内底部中心出生（四面墙封死）
    var s = shot(board, angle, o);
    var before = s.tgtLeft;
    var beforeHp = 0;
    for (var i = 0; i < s.board.cells.length; i++) {
      var v = s.board.cells[i]; if (v && v.t === 'brick') beforeHp += v.hp;
    }
    while (s.alive && s.steps < C.MAX_STEPS) {
      step(s);
      if (s.tgtLeft <= 0) break;   // 目标清完了，不用再算（求解器大半时间省在这）
    }
    var after = s.tgtLeft;
    var afterHp = 0;
    for (var j = 0; j < s.board.cells.length; j++) {
      var w = s.board.cells[j]; if (w && w.t === 'brick') afterHp += w.hp;
    }
    return {
      tgtKilled: before - after,
      hpDealt: beforeHp - afterHp,
      hits: s.hits, gained: s.gained,
      cleared: after === 0
    };
  }

  return {
    STEP: STEP, MAX_STEPS: C.MAX_STEPS,
    shot: shot, advance: advance, run: run, evalAngle: evalAngle, step: step,
    advanceMulti: advanceMulti, runMulti: runMulti,
    tick: tick, clock: function () { return clock; }
  };
})();

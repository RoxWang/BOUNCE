// render.js —— 全部画面都靠代码画，零素材。
// 风格：暗底 + 霓虹描边。颜色本身带信息：砖块颜色 = 它还剩几下。
var B = window.B = window.B || {};

B.Render = (function () {
  var C = B.C, Bd = B.Board, U = B.U, FX = B.FX;
  var FONT = '"PingFang SC","Noto Sans SC","Microsoft YaHei",-apple-system,sans-serif';

  var cv = null, ctx = null, dpr = 1;
  // 上下留给 DOM HUD 的空间。跳跃拾金没有底部按钮排，把下边距收窄，画面不会被一条空黑带压住。
  var insT = 54, insB = 124;
  function setInsets(top, bottom) { insT = top; insB = bottom; }
  var scale = 1, ox = 0, oy = 0, vw = 0, vh = 0;

  // 砖块血量 → 颜色（看颜色就知道还要打几下，不用读数字）
  var HPCOL = ['#4a7bff', '#3fd6ff', '#46e08a', '#ffb02e', '#ff7ae0', '#ff5a5a', '#ff2f5e'];
  function hpColor(hp) { return HPCOL[U.clamp(hp - 1, 0, HPCOL.length - 1)]; }

  // 关卡主题色：每 5 关换一个气质，背景光带 / 场边框 / 弹道虚线 / 球尾全跟着换。
  // 治"每关长一个样"的平——不用改玩法，换一种光就换了心情。
  var THEMES = [
    { main: '#3fd6ff', r: 63, g: 214, b: 255 },
    { main: '#a97bff', r: 169, g: 123, b: 255 },
    { main: '#46e08a', r: 70, g: 224, b: 138 },
    { main: '#ff7ae0', r: 255, g: 122, b: 224 },
    { main: '#5a86ff', r: 90, g: 134, b: 255 }
  ];
  var curTheme = THEMES[0];
  function setTheme(n) {
    curTheme = THEMES[(((n - 1) % THEMES.length) + THEMES.length) % THEMES.length];
    return curTheme;
  }
  function rgba(a) { var t = curTheme; return 'rgba(' + t.r + ',' + t.g + ',' + t.b + ',' + a + ')'; }

  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    // 预留顶栏(54)与底部 HUD 带(124：提示气泡 + 按钮)——棋盘只画在中间这条带里，
    // 这样无论关卡多大，棋盘都不会压到顶部状态栏 / 底部提示与按钮（彻底杜绝 UI 重叠）。
    var TOP = insT, BOT = insB;
    var avail = Math.max(220, vh - TOP - BOT);
    scale = Math.min(vw / C.W, avail / C.H);
    ox = (vw - C.W * scale) / 2;
    oy = TOP + (avail - C.H * scale) / 2;
  }

  // 屏幕坐标 → 世界坐标
  function toWorld(cx, cy) {
    return { x: (cx - ox) / scale, y: (cy - oy) / scale };
  }
  function view() { return { scale: scale, ox: ox, oy: oy, w: vw, h: vh }; }

  // ---------------- 背景 ----------------
  function bg(t) {
    ctx.save();
    var g = ctx.createRadialGradient(C.W / 2, C.H * 0.42, 40, C.W / 2, C.H * 0.5, C.H * 0.78);
    g.addColorStop(0, '#12162a'); g.addColorStop(1, '#070810');
    ctx.fillStyle = g; ctx.fillRect(0, 0, C.W, C.H);

    // 棋盘底纹
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
    for (var c = 0; c <= C.COLS; c++) {
      ctx.beginPath(); ctx.moveTo(Bd.cx(c), C.BY); ctx.lineTo(Bd.cx(c), C.BY + C.BH); ctx.stroke();
    }
    for (var r = 0; r <= C.ROWS; r++) {
      ctx.beginPath(); ctx.moveTo(C.BX, Bd.cy(r)); ctx.lineTo(C.BX + C.BW, Bd.cy(r)); ctx.stroke();
    }

    // 上下两条霓虹边
    var g2 = ctx.createLinearGradient(0, C.BY - 60, 0, C.BY + 30);
    g2.addColorStop(0, rgba(0)); g2.addColorStop(1, rgba(.10));
    ctx.fillStyle = g2; ctx.fillRect(C.BX - 20, C.BY - 60, C.BW + 40, 90);
    var g3 = ctx.createLinearGradient(0, C.BY + C.BH - 10, 0, C.BY + C.BH + 90);
    g3.addColorStop(0, 'rgba(255,176,46,.09)'); g3.addColorStop(1, 'rgba(255,176,46,0)');
    ctx.fillStyle = g3; ctx.fillRect(C.BX - 20, C.BY + C.BH - 10, C.BW + 40, 100);

    // 场边框：四面全是实心墙（封闭框，球进得去出不来）。画成一圈发光的厚边，一眼就是"被围死了"
    ctx.strokeStyle = 'rgba(120,200,255,.85)'; ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(120,200,255,.55)'; ctx.shadowBlur = 14;
    U.roundRect(ctx, C.BX - 2, C.BY - 2, C.BW + 4, C.BH + 4, 10); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(180,230,255,.4)'; ctx.lineWidth = 1.5;
    U.roundRect(ctx, C.BX - 6, C.BY - 6, C.BW + 12, C.BH + 12, 13); ctx.stroke();
    ctx.restore();
  }

  // ---------------- 格子 ----------------
  var PORTAL_COL = ['#a97bff', '#3fd6ff', '#46e08a', '#ff7ae0', '#ffb02e', '#ff5a5a'];
  function portalColor(gid) { return PORTAL_COL[((gid % PORTAL_COL.length) + PORTAL_COL.length) % PORTAL_COL.length]; }

  // 传送门之间的连线：全连接成一张"网"（每扇门都淡淡连到其它门），一眼读出"这是个随机网络——出来可能在任意一扇"。
  // 因为 live 模式里进 A 门会随机从 C/D 任意一扇出来，固定环线反而会骗人，所以用网代替。
  function portalLinks(board, t) {
    var pts = [];
    for (var r = 0; r < board.rows; r++) for (var c = 0; c < board.cols; c++) {
      var v = Bd.get(board, c, r);
      if (!v || v.t !== 'portal') continue;
      pts.push({ x: Bd.ccx(c), y: Bd.ccy(r) });
    }
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(169,123,255,0.14)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 9]);
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
      ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
    }
    ctx.restore();
  }

  // 引力场（PHASE 2）：井是"看不见的力场"，用半透明光晕 + 虚线外环 + 中心标记画出它的范围和吸/斥性质。
  // 颜色带信息：引力=青、斥力=粉。中心那条随时间旋转的指针让"场在动"的感觉更活。
  function wells(board, t) {
    if (!board.wells) return;
    for (var i = 0; i < board.wells.length; i++) {
      var W = board.wells[i];
      var col = W.type === 'repel' ? [255, 122, 224] : [63, 214, 255];
      var cs = col[0] + ',' + col[1] + ',' + col[2];
      // 光晕
      var rg = ctx.createRadialGradient(W.x, W.y, 4, W.x, W.y, W.radius);
      rg.addColorStop(0, 'rgba(' + cs + ',0.22)');
      rg.addColorStop(0.7, 'rgba(' + cs + ',0.07)');
      rg.addColorStop(1, 'rgba(' + cs + ',0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(W.x, W.y, W.radius, 0, Math.PI * 2); ctx.fill();
      // 外环（虚线，标出作用边界）
      ctx.strokeStyle = 'rgba(' + cs + ',0.5)'; ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.arc(W.x, W.y, W.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // 中心核
      ctx.fillStyle = 'rgba(' + cs + ',0.9)';
      ctx.beginPath(); ctx.arc(W.x, W.y, 7, 0, Math.PI * 2); ctx.fill();
      // 旋转指针：引力向内(往外画箭头收向中心)，斥力向外——这里只用一条旋转短线表"场在作用"
      var ang = t * (W.type === 'repel' ? 1.2 : -1.2);
      var ax = Math.cos(ang), ay = Math.sin(ang);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W.x - ax * 13, W.y - ay * 13);
      ctx.lineTo(W.x + ax * 13, W.y + ay * 13);
      ctx.stroke();
    }
  }

  function cells(board, t) {
    portalLinks(board, t);
    for (var r = 0; r < board.rows; r++) {
      for (var c = 0; c < board.cols; c++) {
        var v = Bd.get(board, c, r);
        if (!v) continue;
        var x = Bd.cx(c), y = Bd.cy(r);
        if (v.t === 'brick') { if (v.mover == null) brick(x, y, v, t, c, r); }   // 动块单独画（带轨道+滑动）
        else if (v.t === 'steel') steel(x, y);
        else if (v.t === 'bomb') bomb(x, y, t);
        else if (v.t === 'portal') portal(x, y, v.gid, v.dir, t, c, r, board);
        else if (v.t === 'plus') plus(x, y, t);
        else if (v.t === 'crack') crack(x, y, t);
        else if (v.t === 'coin') coinCell(x, y, t);
        else if (v.t === 'bumper') bumper(x, y, t);
      }
    }
  }

  function brick(x, y, v, t, c, r) {
    var pad = 4, s = C.CELL - pad * 2;
    var x0 = x + pad, y0 = y + pad;
    ctx.save();
    if (v.target) {
      // 目标砖：金色 + 呼吸光 + 准星，一眼能认出来
      var pulse = 0.5 + 0.5 * Math.sin(t * 3 + (c + r) * 0.7);
      ctx.shadowColor = 'rgba(255,176,46,' + (0.5 + pulse * 0.5) + ')';
      ctx.shadowBlur = 16 + pulse * 14;
      var gg = ctx.createLinearGradient(x0, y0, x0, y0 + s);
      gg.addColorStop(0, '#ffe08a'); gg.addColorStop(1, '#e08b12');
      ctx.fillStyle = gg;
      U.roundRect(ctx, x0, y0, s, s, 11); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      U.roundRect(ctx, x0 + 1.5, y0 + 1.5, s - 3, s - 3, 10); ctx.stroke();
      // 准星
      var mx = x0 + s / 2, my = y0 + s / 2;
      ctx.strokeStyle = 'rgba(60,30,0,.5)'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx - 11, my); ctx.lineTo(mx + 11, my);
      ctx.moveTo(mx, my - 11); ctx.lineTo(mx, my + 11);
      ctx.stroke();
      ctx.fillStyle = '#3a1f00';
      ctx.font = '900 26px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(v.hp), mx, my + 1);
    } else {
      var col = hpColor(v.hp);
      var gg2 = ctx.createLinearGradient(x0, y0, x0, y0 + s);
      gg2.addColorStop(0, col); gg2.addColorStop(1, shade(col, -0.42));
      ctx.fillStyle = gg2;
      U.roundRect(ctx, x0, y0, s, s, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5;
      U.roundRect(ctx, x0 + 1, y0 + 1, s - 2, s - 2, 9); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '900 25px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(v.hp), x0 + s / 2, y0 + s / 2 + 1);
    }
    ctx.restore();
  }

  function steel(x, y) {
    var pad = 4, s = C.CELL - pad * 2, x0 = x + pad, y0 = y + pad;
    ctx.save();
    var g = ctx.createLinearGradient(x0, y0, x0, y0 + s);
    g.addColorStop(0, '#98a2b8'); g.addColorStop(1, '#48505f');
    ctx.fillStyle = g;
    U.roundRect(ctx, x0, y0, s, s, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5;
    U.roundRect(ctx, x0 + 1, y0 + 1, s - 2, s - 2, 7); ctx.stroke();
    // 斜纹：一看就是"打不动的东西"
    ctx.save();
    U.roundRect(ctx, x0, y0, s, s, 8); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 5;
    for (var i = -s; i < s * 2; i += 14) {
      ctx.beginPath(); ctx.moveTo(x0 + i, y0); ctx.lineTo(x0 + i + s, y0 + s); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    [[x0 + 9, y0 + 9], [x0 + s - 9, y0 + 9], [x0 + 9, y0 + s - 9], [x0 + s - 9, y0 + s - 9]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.2, 0, 6.2832); ctx.fill();
    });
    ctx.restore();
  }

  function bomb(x, y, t) {
    var cx = x + C.CELL / 2, cy = y + C.CELL / 2;
    var pulse = 0.5 + 0.5 * Math.sin(t * 5);
    ctx.save();
    ctx.shadowColor = 'rgba(255,90,60,' + (0.45 + pulse * 0.4) + ')';
    ctx.shadowBlur = 14 + pulse * 10;
    var g = ctx.createRadialGradient(cx - 6, cy - 7, 3, cx, cy, 26);
    g.addColorStop(0, '#ff9d7a'); g.addColorStop(1, '#a3230f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 22 + pulse * 1.5, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    // 引信
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx + 12, cy - 18); ctx.quadraticCurveTo(cx + 24, cy - 28, cx + 20, cy - 36); ctx.stroke();
    ctx.fillStyle = '#ffd04a';
    ctx.beginPath(); ctx.arc(cx + 20, cy - 36, 3.4 + pulse * 1.6, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  function portal(x, y, gid, dir, t, c, r, board) {
    var cx = x + C.CELL / 2, cy = y + C.CELL / 2;
    var col = portalColor(gid);
    var dv = B.Board.dirVec(dir);
    var ang = Math.atan2(dv.y, dv.x);
    ctx.save();
    // 外环（发光）
    ctx.shadowColor = col; ctx.shadowBlur = 16;
    ctx.strokeStyle = col; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, 6.2832); ctx.stroke();
    ctx.shadowBlur = 0;
    // 转动的虚线圈（给"在转"的视觉暗示）
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t * (gid % 2 ? -1.6 : 1.6));
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; ctx.setLineDash([7, 8]);
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, 6.2832); ctx.stroke();
    ctx.restore();
    // 中心脉冲
    var pl = 0.5 + 0.5 * Math.sin(t * 4 + gid);
    ctx.fillStyle = col; ctx.globalAlpha = 0.6 + pl * 0.4;
    ctx.beginPath(); ctx.arc(cx, cy, 5 + pl * 2, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    // 出口"炮口/喷嘴"：一个明显不对称、伸出圆环外的尖角三角，球就从这条线喷出。
    // 旋转门（dir 随时间变）时这个喷嘴跟着 360° 转，一眼看出"门在转、球往哪喷"。
    var len = 36, ex = cx + dv.x * len, ey = cy + dv.y * len;          // 喷嘴尖端（明显超出外环 22）
    var w = 9;                                                         // 喷嘴半宽
    var px = -dv.y, py = dv.x;                                        // 垂直于方向的法线
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cx + dv.x * 20, cy + dv.y * 20);                       // 根部贴着环
    ctx.lineTo(ex, ey);                                               // 尖端朝外
    ctx.lineTo(cx + dv.x * 20 + px * w, cy + dv.y * 20 + py * w);     // 一侧翼
    ctx.lineTo(cx + dv.x * 20 - px * w, cy + dv.y * 20 - py * w);     // 另一侧翼
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // 尖端高光点
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, 3, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  // 动体方块：先画轨道（路径虚线 + 路点），再在"平滑滑动"后的视觉位置画青色发光砖。
  // 碰撞永远按网格格子算，这里只是把两发之间的挪动补成一段看得见的滑动。
  function drawMovers(board, t) {
    if (!board.movers) return;
    var dur = 0.22;
    for (var mi = 0; mi < board.movers.length; mi++) {
      var m = board.movers[mi];
      if (!m.path || m.path.length < 2) continue;
      // 被球击碎后，格子变 null：整条轨道和方块都不画，不留"幽灵青块"
      if (!board.cells[m.r * board.cols + m.c]) continue;
      // 轨道：路径相邻格中心之间的虚线 + 路点小圆（加亮，让"在动"看得见）
      ctx.save();
      ctx.strokeStyle = 'rgba(94,234,212,.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]);
      ctx.beginPath();
      for (var pi = 0; pi < m.path.length; pi++) {
        var pc = Bd.ccx(m.path[pi].c), pr = Bd.ccy(m.path[pi].r);
        if (pi === 0) ctx.moveTo(pc, pr); else ctx.lineTo(pc, pr);
      }
      ctx.stroke(); ctx.setLineDash([]);
      for (var pj = 0; pj < m.path.length; pj++) {
        ctx.fillStyle = 'rgba(94,234,212,.85)';
        ctx.beginPath(); ctx.arc(Bd.ccx(m.path[pj].c), Bd.ccy(m.path[pj].r), 3.5, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
      // 视觉位置：旧格中心 → 新格中心 缓动
      var prog = U.clamp((t - (m.animStart || 0)) / dur, 0, 1);
      var ease = prog * prog * (3 - 2 * prog);
      var vx = (m.fromX != null) ? m.fromX + (m.toX - m.fromX) * ease : Bd.ccx(m.c);
      var vy = (m.fromY != null) ? m.fromY + (m.toY - m.fromY) * ease : Bd.ccy(m.r);
      // 移动方向（用于画小箭头）：动画中看 from→to，静止时看下一步
      var hx = m.toX - m.fromX, hy = m.toY - m.fromY;
      if (prog >= 1) {
        var ni = m.idx + m.dir;
        if (ni < 0 || ni >= m.path.length) ni = m.idx - m.dir;
        if (ni >= 0 && ni < m.path.length) { hx = Bd.ccx(m.path[ni].c) - vx; hy = Bd.ccy(m.path[ni].r) - vy; }
      }
      var hlen = Math.hypot(hx, hy) || 1; hx /= hlen; hy /= hlen;
      // 青色发光砖
      var s = C.CELL - 8, x0 = vx - s / 2, y0 = vy - s / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(94,234,212,.9)'; ctx.shadowBlur = 16;
      var g = ctx.createLinearGradient(x0, y0, x0, y0 + s);
      g.addColorStop(0, '#7af5e0'); g.addColorStop(1, '#1f9c8a');
      ctx.fillStyle = g;
      U.roundRect(ctx, x0, y0, s, s, 10); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
      U.roundRect(ctx, x0 + 1.5, y0 + 1.5, s - 3, s - 3, 9); ctx.stroke();
      // 方向小箭头（双向，示意"来回"）——放大更显眼
      var mx = vx, my = vy, a = 19;
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      ctx.moveTo(mx + hx * a, my + hy * a);
      ctx.lineTo(mx + hx * a - Math.cos(Math.atan2(hy, hx) - 0.5) * 10, my + hy * a - Math.sin(Math.atan2(hy, hx) - 0.5) * 10);
      ctx.lineTo(mx + hx * a - Math.cos(Math.atan2(hy, hx) + 0.5) * 10, my + hy * a - Math.sin(Math.atan2(hy, hx) + 0.5) * 10);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(mx - hx * a, my - hy * a);
      ctx.lineTo(mx - hx * a + Math.cos(Math.atan2(hy, hx) - 0.5) * 10, my - hy * a + Math.sin(Math.atan2(hy, hx) - 0.5) * 10);
      ctx.lineTo(mx - hx * a + Math.cos(Math.atan2(hy, hx) + 0.5) * 10, my - hy * a + Math.sin(Math.atan2(hy, hx) + 0.5) * 10);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function plus(x, y, t) {
    var cx = x + C.CELL / 2, cy = y + C.CELL / 2;
    var pl = 0.5 + 0.5 * Math.sin(t * 3.6);
    ctx.save();
    ctx.shadowColor = '#46e08a'; ctx.shadowBlur = 12 + pl * 10;
    ctx.fillStyle = '#46e08a';
    ctx.beginPath(); ctx.arc(cx, cy, 19 + pl * 1.5, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#08240f'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 9);
    ctx.stroke();
    ctx.restore();
  }

  // 裂缝砖：灰白底 + 爬满裂纹。一眼读出"这玩意碎了全场跟着塌"。
  function crack(x, y, t) {
    var pad = 4, s = C.CELL - pad * 2, x0 = x + pad, y0 = y + pad;
    ctx.save();
    ctx.shadowColor = 'rgba(255,138,106,' + (0.3 + 0.2 * Math.sin(t * 4)) + ')';
    ctx.shadowBlur = 10;
    var g = ctx.createLinearGradient(x0, y0, x0, y0 + s);
    g.addColorStop(0, '#c8ccd8'); g.addColorStop(1, '#7a7f90');
    ctx.fillStyle = g;
    U.roundRect(ctx, x0, y0, s, s, 10); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,110,80,.85)'; ctx.lineWidth = 2;
    var mx = x0 + s / 2, my = y0 + s / 2;
    ctx.beginPath();
    ctx.moveTo(mx - 20, my - 8); ctx.lineTo(mx - 6, my - 2); ctx.lineTo(mx - 12, my + 10); ctx.lineTo(mx + 4, my + 4);
    ctx.moveTo(mx - 6, my - 2); ctx.lineTo(mx + 10, my - 12); ctx.lineTo(mx + 18, my - 4);
    ctx.moveTo(mx + 4, my + 4); ctx.lineTo(mx + 14, my + 16);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5;
    U.roundRect(ctx, x0 + 1, y0 + 1, s - 2, s - 2, 9); ctx.stroke();
    ctx.restore();
  }

  // 金币砖：转动的金币
  function coinCell(x, y, t) {
    var cx = x + C.CELL / 2, cy = y + C.CELL / 2;
    var w = Math.abs(Math.cos(t * 2.4)) * 15 + 3;   // 硬币绕竖轴翻转的错觉
    ctx.save();
    ctx.shadowColor = '#ffd04a'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd04a';
    ctx.beginPath(); ctx.ellipse(cx, cy, w, 17, 0, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8a6200';
    ctx.font = '900 16px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (w > 9) ctx.fillText('◈', cx, cy + 1);
    ctx.restore();
  }

  // 弹板：圆形琥珀弹板，蓄力呼吸
  function bumper(x, y, t) {
    var cx = x + C.CELL / 2, cy = y + C.CELL / 2;
    var pl = 0.5 + 0.5 * Math.sin(t * 4.2);
    ctx.save();
    ctx.shadowColor = '#ffb02e'; ctx.shadowBlur = 14 + pl * 8;
    ctx.fillStyle = '#2a1a05';
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffb02e'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,140,' + (0.35 + pl * 0.5) + ')'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, 16 + pl * 4, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = '#ffd04a';
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  // ---------------- 预测轨迹 ----------------
  // 这是整个游戏的核心：松手之前你就知道球会怎么走。
  function trace(s, segs, t) {
    if (!s || !s.pts.length) return;
    var endIdx = s.segIdx[segs] != null ? s.segIdx[segs] : s.pts.length;
    endIdx = Math.min(endIdx, s.pts.length);
    if (endIdx < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    // 分段画：越往后越淡，玩家一眼看出"我能看到第几段"
    for (var k = 0; k < segs; k++) {
      var a0 = s.segIdx[k], a1 = (s.segIdx[k + 1] != null ? s.segIdx[k + 1] : s.pts.length);
      if (a0 == null || a1 == null) break;
      a1 = Math.min(a1, endIdx);
      if (a1 - a0 < 1) break;
      var al = 0.85 - k * 0.16;
      ctx.globalAlpha = Math.max(0.16, al);
      ctx.strokeStyle = curTheme.main;
      ctx.lineWidth = 3 - k * 0.35;
      ctx.setLineDash([9, 8]);
      ctx.lineDashOffset = -t * 34;      // 流动的虚线，看着像"要往那边走"
      ctx.beginPath();
      ctx.moveTo(s.pts[a0].x, s.pts[a0].y);
      for (var i = a0 + 1; i < a1; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
      ctx.stroke();
      // 反弹点：小空心圆，一眼知道这是"拐点"不是终点
      if (a1 < s.pts.length) {
        ctx.setLineDash([]);
        ctx.strokeStyle = curTheme.main; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.pts[a1].x, s.pts[a1].y, 4.2, 0, 6.2832); ctx.stroke();
      }
    }
    // 末端：画到头了会显示结果，没画到头就画个省略号
    ctx.setLineDash([]);
    var last = s.pts[endIdx - 1];
    if (endIdx >= s.pts.length) {
      if (s.cleared) {
        ctx.fillStyle = '#46e08a'; ctx.font = '900 22px ' + FONT;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = '#46e08a'; ctx.shadowBlur = 12;
        ctx.fillText('✓', last.x, last.y - 14);
      }
    } else if (s.truncated) {
      // 预测线在传送门处被截断：画一个旋转的双环，提示"门后面全是随机出口，自己进去探"
      ctx.save();
      ctx.translate(last.x, last.y - 14); ctx.rotate(t * 2.2);
      ctx.strokeStyle = '#a97bff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.2832); ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = rgba(.78);
      ctx.font = '900 22px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('···', last.x, last.y - 12);
    }
    ctx.restore();
  }

  // ---------------- 球 ----------------
  // 连击烧到 12 以上，球尾烧成金色——肉眼可见的"这颗球现在是烫的"
  function ball(b, trail, combo) {
    var i;
    var hot = combo >= 12;
    var col = hot ? '#ffd24a' : curTheme.main;
    var lite = hot ? '#fff3c8' : '#9beaff';
    // 拖尾
    if (trail && trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (i = 1; i < trail.length; i++) {
        var k = i / trail.length;
        ctx.globalAlpha = k * 0.5;
        ctx.strokeStyle = lite;
        ctx.lineWidth = C.BALL_R * 1.7 * k;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 22 + (hot ? 12 : 0);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, C.BALL_R, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = hot ? 'rgba(255,210,74,.6)' : rgba(.55);
    ctx.beginPath(); ctx.arc(b.x, b.y, C.BALL_R * 1.75, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  // ---------------- 发射标记 ----------------
  // 标记恒在边框上：球从框外沿玩家定的方向打进来（四面实心墙封死，进得去出不来）。带十字准星 + 呼吸光环。
  function launcher(g, t) {
    var m = g.marker || { x: g.board.launchX, y: C.BY + C.BH - C.BALL_R - 2 };
    var x = m.x, y = m.y;
    var lastOne = g.balls === 1 && g.state === 'aim';   // 最后一颗：全场进入紧张态
    ctx.save();
    // 光环（呼吸）
    var pl = 0.5 + 0.5 * Math.sin(t * (lastOne ? 7 : 3));
    var hotCol = lastOne ? 'rgba(255,90,90,' : 'rgba(255,176,46,';
    ctx.strokeStyle = hotCol + '.9)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, 6.2832); ctx.stroke();
    ctx.fillStyle = hotCol + (0.25 + pl * 0.45) + ')';
    ctx.beginPath(); ctx.arc(x, y, 7 + pl * 2.5, 0, 6.2832); ctx.fill();
    // 十字准星（指向"这就是进框点"）
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 20, y); ctx.lineTo(x - 9, y);
    ctx.moveTo(x + 9, y); ctx.lineTo(x + 20, y);
    ctx.moveTo(x, y - 20); ctx.lineTo(x, y - 9);
    ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 20);
    ctx.stroke();
    if (lastOne) {
      ctx.fillStyle = 'rgba(255,120,120,.95)';
      ctx.font = '900 13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('最后一颗', x, y - 30);
    }
    // 还剩几颗球：标记右侧排一排（夹在框内，不跑出世界），最右边那颗是下一发（更大更亮）
    var n = g.balls;
    var shown = Math.min(n, 14);
    var startX = x + 24;
    var totalW = shown * 12;
    if (startX + totalW > C.BX + C.BW) startX = C.BX + C.BW - totalW;   // 太靠右就往左挪
    for (var i = 0; i < shown; i++) {
      var bx = startX + i * 12, by = y;
      var isNext = i === shown - 1;
      ctx.fillStyle = lastOne ? '#ff7a7a' : (isNext ? '#9beaff' : rgba(.55));
      ctx.beginPath(); ctx.arc(bx, by, isNext ? 5.6 : 4.2, 0, 6.2832); ctx.fill();
    }
    if (n > 14) {
      ctx.fillStyle = curTheme.main; ctx.font = '900 13px ' + FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('+' + (n - 14), startX + totalW + 4, y);
    }
    ctx.restore();
  }

  // 瞄准中的那条短线（沿当前 aimAngle，从边框入口指向框内）
  function aim(g) {
    if (g.state !== 'aim' && g.state !== 'fly') return;   // 飞行途中瞄准下一颗也画瞄准线
    var m = g.marker || { x: g.board.launchX, y: C.BY + C.BH - C.BALL_R - 2 };
    var x = m.x, y = m.y;
    var d = U.norm(Math.cos(g.aimAngle), Math.sin(g.aimAngle));
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + d.x * 18, y + d.y * 18);
    ctx.lineTo(x + d.x * 52, y + d.y * 52);
    ctx.stroke();
    ctx.restore();
  }

  function shade(hex, k) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    var r = parseInt(m[1], 16), g2 = parseInt(m[2], 16), b = parseInt(m[3], 16);
    var f = function (v) { return U.clamp(Math.round(v + (k < 0 ? v * k : (255 - v) * k)), 0, 255); };
    return 'rgb(' + f(r) + ',' + f(g2) + ',' + f(b) + ')';
  }

  // ---------------- 每帧 ----------------
  function frame(g, t) {
    if (typeof t !== 'number' || !isFinite(t)) t = 0;   // 防御：漏传/NaN 的时间不当场崩整帧
    setTheme(g.n || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = '#05060c'; ctx.fillRect(0, 0, vw, vh);

    var sh = FX.shakeXY();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sh.x * scale), dpr * (oy + sh.y * scale));

    // 只在世界范围内画（外面是黑边）
    ctx.save();
    ctx.beginPath(); ctx.rect(-4, -4, C.W + 8, C.H + 8); ctx.clip();

    bg(t);
    wells(g.board, t);
    cells(g.board, t);
    drawMovers(g.board, t);   // 动体方块的轨道 + 平滑滑动（在 cells 之后画，压在普通格子上）

    if (g.preview) trace(g.preview, g.segs, t);
    // 所有在飞的球（连发时可能同时多颗），各自带拖尾，连击烧高烧成金色
    if (g.shots) for (var bi = 0; bi < g.shots.length; bi++) {
      var sh = g.shots[bi];
      ball(sh.ball, sh.trail, sh.s.combo);
    }

    FX.draw(ctx);

    launcher(g, t);
    aim(g);

    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    FX.drawFlash(ctx, vw, vh);
  }

  // 街机通用每帧：复用世界坐标系变换，让 runner.draw / hop.draw 直接在世界坐标里画。
  // 固定宽高比会在上下留黑边；模块自带 bgColor 时把留白染成画面底色，看起来是连续的。
  function frameRunner(runner, t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.fillStyle = (runner && runner.bgColor) || '#05060c'; ctx.fillRect(0, 0, vw, vh);

    var sh = FX.shakeXY();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + sh.x * scale), dpr * (oy + sh.y * scale));

    ctx.save();
    ctx.beginPath(); ctx.rect(-4, -4, C.W + 8, C.H + 8); ctx.clip();
    runner.draw(ctx, t);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    FX.drawFlash(ctx, vw, vh);
  }

  return {
    init: init, resize: resize, setInsets: setInsets, frame: frame, frameRunner: frameRunner,
    // 同一个通用画布入口：只要模块有 draw(ctx, t) 就能挂进主循环（runner / hop 共用）
    frameArcade: frameRunner, toWorld: toWorld, view: view,
    hpColor: hpColor, ctx: function () { return ctx; }
  };
})();

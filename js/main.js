// main.js —— 启动、输入、主循环
var B = window.B = window.B || {};

(function () {
  var canvas, last = 0, started = false;

  function fail(msg) {
    var ov = document.getElementById('errOverlay');
    var tx = document.getElementById('errText');
    if (ov && tx) { tx.textContent = msg; ov.classList.remove('hidden'); }
    if (window.console) console.error(msg);
  }
  window.addEventListener('error', function (e) {
    fail('运行出错：\n' + (e.message || e) + '\n' + (e.filename || '') + ':' + (e.lineno || ''));
  });

  function bindInput() {
    var dragging = false;

    function toW(e) { return B.Render.toWorld(e.clientX, e.clientY); }

    canvas.addEventListener('pointerdown', function (e) {
      B.A.unlock();
      var w = toW(e);
      if (B.Game.g.mode === 'runner') {
        if (B.Runner.state() && B.Runner.state().dead) B.Runner.restart();  // 死亡后点击=重来（与屏幕提示一致）
        else B.Runner.setTarget(w.x);
        dragging = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
        e.preventDefault();
        return;
      }
      if (B.Game.g.mode === 'hop') {
        // 按住画布左 / 右半区 = 往那边持续跑，松手停；起跳交给空格或屏幕 ⤴ 按钮。
        // 通关/阵亡由 DOM 结算页接管，画布不再响应重来，避免和结算按钮打架。
        var hst = B.Hop.state();
        if (hst && !hst.dead && !hst.won) B.Hop.setDir(w.x < B.C.W / 2 ? -1 : 1);
        dragging = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
        e.preventDefault();
        return;
      }
      if (B.Game.state() !== 'aim') return;
      dragging = true;
      B.Game.aimStart(w.x, w.y);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      var w = toW(e);
      if (B.Game.g.mode === 'runner') {
        if (dragging) { B.Runner.setTarget(w.x); e.preventDefault(); }
        return;
      }
      if (B.Game.g.mode === 'hop') {
        if (dragging) { B.Hop.setDir(w.x < B.C.W / 2 ? -1 : 1); e.preventDefault(); }
        return;
      }
      B.Game.g.mx = w.x; B.Game.g.my = w.y;
      if (dragging) { B.Game.aimMove(w.x, w.y); e.preventDefault(); }
    });

    function up(e) {
      if (!dragging) return;
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { }
      if (B.Game.g.mode === 'runner') return;   // 无尽冲刺是拖动即移动，没有"松手发射"
      if (B.Game.g.mode === 'hop') { B.Hop.setDir(0); return; }
      B.Game.aimEnd();
      B.UI.syncHud(true);
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', function () {
      dragging = false;
      if (B.Game.g.mode === 'hop') { B.Hop.setDir(0); return; }
      if (B.Game.g.mode !== 'runner') B.Game.aimCancel();
    });
    window.addEventListener('blur', function () {
      dragging = false;
      if (B.Game.g.mode === 'hop') { B.Hop.setDir(0); return; }
      if (B.Game.g.mode !== 'runner') B.Game.aimCancel();
    });

    // 拦掉触控板/鼠标的双击选中和右键菜单，拖动手感才干净
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', function (e) {
      B.A.unlock();
      B.UI.key(e);
    });
    // 街机模式：方向键按住=持续移动，松开=停；跳跃松开=短跳（砍上升速度）。
    window.addEventListener('keyup', function (e) {
      var k = (e.key || '').toLowerCase();
      if (B.Game.g.mode === 'hop') {
        var hs = B.Hop.state();
        if (k === 'arrowleft' || k === 'a') { if (hs && hs.dir < 0) B.Hop.setDir(0); }
        else if (k === 'arrowright' || k === 'd') { if (hs && hs.dir > 0) B.Hop.setDir(0); }
        else if (k === ' ' || k === 'arrowup' || k === 'w') B.Hop.setJumpHeld(false);
        return;
      }
      if (B.Game.g.mode !== 'runner') return;
      if (k === 'arrowleft' || k === 'arrowright') B.Runner.setDir(0);
    });
  }

  function frame(now) {
    if (!started) { last = now; started = true; }
    var rawDt = (now - last) / 1000;
    last = now;
    if (rawDt > 0.05) rawDt = 0.05;          // 切标签页回来别让球瞬移
    if (rawDt < 0) rawDt = 0;

    // 无尽冲刺：完全不同的操作与物理（方向键 / 拖拽的无尽躲避），主循环走另一条链路
    if (B.Game.g.mode === 'runner') {
      B.Runner.update(rawDt);
      B.Render.frameRunner(B.Runner, now / 1000);
      B.UI.syncHud(false);
      return;
    }

    // 跳跃拾金：横版跑跳，与弹珠 / 无尽冲刺并列第三条主循环链路
    if (B.Game.g.mode === 'hop') {
      B.Hop.update(rawDt);
      B.Render.frameArcade(B.Hop, now / 1000);
      B.UI.syncHud(false);
      return;
    }

    var ts = B.FX.timeScale();
    B.Game.update(rawDt * ts, rawDt);
    B.Render.frame(B.Game.g, now / 1000);
    B.UI.syncHud(false);
  }

  function loop(now) {
    frame(now);
    requestAnimationFrame(loop);
  }

  // URL 调试入口（不影响正常玩）：
  //   ?autostart=N   自动进第 N 关
  //   ?autoplay=1    进关后自动找一个能清场的角度发射
  //   ?clutch=1      发射前把球置成 1 颗（测绝杀流程）
  //   结果写进 document.title：SELFTEST WIN/LOSE clutch=... coin=... stars=...
  function debugHooks() {
    try {
      var q = new URLSearchParams(location.search);
      // 信标地址必须在任何用到它的分支之前声明。旧版把它写在函数末尾，
      // 靠 var 提升变成 undefined，?selftest=1&beacon=1 的实时上报整段永远不触发（真 bug）。
      var _bn = q.get('beacon') ? q.get('beaconurl') : null;
      if (_bn) { try { new Image().src = _bn + '?d=' + encodeURIComponent('HOOK_RAN mode=' + (B.Game ? B.Game.g.mode : '?')); } catch (e) { } }

      // 同步模拟无尽冲刺（无头模式下 setInterval/rAF 会被压制，无法靠定时器跑；这里直接在 debugHooks 里
      // 同步跑 N 帧，完整复刻 frame() 的 update+render 链路，把结果写进 document.title 供 --dump-dom 抓取）。
      // 仅 ?simrunner=N 时启用，正常玩完全不受影响。
      if (q.get('simrunner')) {
        try {
          B.Game.startRunner();            // 进入无尽冲刺（runner 模式 + Runner.init）
          var frames = parseInt(q.get('simrunner'), 10) || 600;
          var t = 0, renderErr = '';
          for (var fi = 0; fi < frames; fi++) {
            try { B.Runner.update(1 / 60); } catch (e) { renderErr = 'UPDERR ' + e.message; break; }
            try { B.Render.frameRunner(B.Runner, t); } catch (e) { renderErr = 'RENDERERR ' + e.message; break; }
            t += 1 / 60;
            if (B.Runner.state() && B.Runner.state().dead) break;
          }
          var s = B.Runner.state() || {};
          document.title = 'RUNNER mode=' + B.Game.g.mode + ' score=' + Math.floor(s.score || 0) +
            ' lives=' + (s.lives || 0) + ' coins=' + (s.coins || 0) + ' shield=' + (s.shield || 0) +
            ' dead=' + !!s.dead + ' reachBad=' + (s._reachBad || 0) + (renderErr ? ' ' + renderErr : '');
        } catch (e) { document.title = 'SIMERR ' + (e && e.message); }
      }
      // 跳跃拾金同步自检：?simhop=N[&simhoplevel=M] 用真实 update + render 跑一个只会向右跑、
      // 到平台边缘/尖刺前起跳的机器人，验证固定关卡真的能走到旗子。正常玩不受影响。
      if (q.get('simhop')) {
        try {
          B.UI.startHop(parseInt(q.get('simhoplevel'), 10) || 1);
          B.Hop.setJumpHeld(true);                       // 全程大跳，不砍上升速度
          var hf = parseInt(q.get('simhop'), 10) || 900, herr = '';
          for (var hj = 0; hj < hf; hj++) {
            var hs = B.Hop.state();
            if (!hs || hs.dead || hs.won) break;
            var hp = hs.p, foot = null;
            for (var qi = 0; qi < hs.plats.length; qi++) {
              var q2 = hs.plats[qi];
              if (q2.kind === 'high') continue;
              if (hp.x + 16 >= q2.x && hp.x + 16 <= q2.x + q2.w &&
                  Math.abs(hp.y + 46 - q2.y) < 6) { foot = q2; break; }
            }
            var need = false;
            if (foot && hp.grounded) {
              if (foot.x + foot.w - (hp.x + 32) < 78) need = true;   // 快到边缘
              for (var spi = 0; spi < hs.spikes.length; spi++) {
                var sk = hs.spikes[spi];
                if (sk.x > hp.x && sk.x - hp.x < 96 && Math.abs(sk.y - (hp.y + 46)) < 40) need = true;
              }
            }
            if (need) B.Hop.jump();
            B.Hop.setDir(1);
            try { B.Hop.update(1 / 60); } catch (e) { herr = 'UPDERR ' + e.message; break; }
            try { B.Render.frameArcade(B.Hop, hj / 60); } catch (e) { herr = 'RENDERERR ' + e.message; break; }
          }
          var hs2 = B.Hop.state() || {};
          document.title = 'HOP mode=' + B.Game.g.mode + ' level=' + hs2.level +
            ' x=' + Math.floor(hs2.p ? hs2.p.x : -1) + ' goal=' + Math.floor(hs2.goalX || 0) +
            ' stars=' + (hs2.stars || 0) + ' coins=' + (hs2.coinsGot || 0) + '/' + (hs2.coinsTotal || 0) +
            ' lives=' + (hs2.lives || 0) + ' genBad=' + (hs2.genBad || 0) +
            ' falls=' + (hs2.falls || 0) + ' won=' + !!hs2.won + ' dead=' + !!hs2.dead +
            ' plats=' + (hs2.plats ? hs2.plats.length : 0) + (herr ? ' ' + herr : ' ok=1');
        } catch (e) { document.title = 'HOPERR ' + (e && e.message); }
      }
      // 弹珠 100+ 关同步自检（无头校验用，与 simrunner 同思路）：?marbletest=N 同步进第 N 关，
      // 跑通"建关 + 几何对齐 + 首帧预测渲染"全链路，把 cols/rows/目标数写进 title 供 --dump-dom 抓取。
      // 正常玩完全不受影响。
      if (q.get('marbletest')) {
        try {
          var mn = parseInt(q.get('marbletest'), 10) || 150;
          B.Game.load(mn);
          var g = B.Game.g, b = g.board;
          var mf = parseInt(q.get('mf'), 10) || 3;
          for (var mi = 0; mi < mf; mi++) {
            try { B.Game.update(1 / 60); } catch (e) { document.title = 'MERR upd ' + e.message; return; }
            try { B.Render.frame(g, g.t); } catch (e) { document.title = 'MERR rnd ' + e.message; return; }
          }
          var pc = 0;
          for (var pi = 0; pi < b.cells.length; pi++) { if (b.cells[pi] && b.cells[pi].t === 'portal') pc++; }
          document.title = 'MARBLE n=' + g.n + ' mode=' + g.mode + ' cols=' + b.cols + ' rows=' + b.rows +
            ' targets=' + (b.cells ? B.Board.countTargets(b) : '?') + ' portals=' + pc + ' ok=1';
        } catch (e) { document.title = 'MERR ' + (e && e.message); }
      }
      // 多球（连发 + 球间弹性碰撞）真实游戏路径自检：?multiballtest=1
      // 直接驱动真实游戏代码：连发两球（第一颗还在飞就射第二颗）→ 推进 update 真实链路 → runMulti 含在飞球预测 → 头对头碰撞交换速度。
      // 正常玩完全不受影响。
      if (q.get('multiballtest')) {
        try {
          B.Game.load(5);
          var g = B.Game.g, b = g.board;
          g.state = 'aim'; g.aiming = true; g.balls = 9;          // 给足余弹
          g.aimAnchor = { x: B.C.BX + B.C.BW / 2, y: B.C.BY + B.C.BH / 2 };
          B.Game.aimSet(-Math.PI / 2);                              // 竖直向上，入口在底边
          B.Game.fire();                                           // 第一颗
          var mbS1 = g.shots.length, mbSt1 = g.state;
          g.aimAnchor = { x: B.C.BX + B.C.BW / 2 - 70, y: B.C.BY + B.C.BH / 2 };  // 第二颗换个入口
          B.Game.fire();                                           // 连发：第一颗还在飞，直接射第二颗
          var mbS2 = g.shots.length, mbSt2 = g.state;
          var mbCrash = '';
          for (var ki = 0; ki < 80; ki++) {                        // 真实 update 链路（advanceMulti + 球间碰撞）
            try { B.Game.update(1 / 60); } catch (e) { mbCrash = 'UPDERR ' + e.message; break; }
          }
          var mbPred = null, mbPredErr = '';
          try {
            if (g.shots.length) mbPred = B.Phys.runMulti(b, g.shots.map(function (x) { return x.s; }), -Math.PI / 2, { preview: true, power: 1 });
          } catch (e) { mbPredErr = 'PREDIERR ' + e.message; }
          // 头对头碰撞：用空棋盘（避开真实关卡砖块干扰），在真实 shot 对象上验证 collide 交换速度（反向 + 动量守恒）
          var er = []; for (var ei = 0; ei < 11; ei++) er.push('.........'); er[0] = '........*';
          var eb = B.Board.fromLevel({ rows: er });
          var ca = B.Phys.shot(eb, 0, { mutate: true }); ca.x = 300; ca.y = 480; ca.vx = 300; ca.vy = 0; ca.alive = true; ca.tgtLeft = 1; ca.stopOnClear = false; ca.pts = [{ x: 300, y: 480 }]; ca.segIdx = [0]; ca.sample = 0;
          var cbb = B.Phys.shot(eb, 0, { mutate: true }); cbb.x = 460; cbb.y = 480; cbb.vx = -300; cbb.vy = 0; cbb.alive = true; cbb.tgtLeft = 1; cbb.stopOnClear = false; cbb.pts = [{ x: 460, y: 480 }]; cbb.segIdx = [0]; cbb.sample = 0;
          B.Phys.advanceMulti([ca, cbb], 400);
          var mbCollOk = (ca.vx < 0 && cbb.vx > 0) && Math.abs((ca.vx + cbb.vx) - 0) < 1e-3;
          document.title = 'MB s1=' + mbS1 + ' st1=' + mbSt1 + ' s2=' + mbS2 + ' st2=' + mbSt2 +
            ' afterUpdShots=' + g.shots.length + ' pred=' + (!!mbPred) + ' collOk=' + mbCollOk +
            (mbCrash ? ' CRASH ' + mbCrash : '') + (mbPredErr ? ' ' + mbPredErr : '') + (mbCrash || mbPredErr ? '' : ' ok=1');
        } catch (e) { document.title = 'MBERR ' + (e && e.message); }
      }
      // 封闭框自检：?boxtest=1 同步驱动真实游戏链路，验证"球进得去出不来 + 连发共存 + 寿命到顶消失"。
      // 正常玩完全不受影响（仅 ?boxtest 时启用）。
      if (q.get('boxtest')) {
        try {
          function _inBox(p) { return p.x >= C.BX && p.x <= C.BX + C.BW && p.y >= C.BY && p.y <= C.BY + C.BH; }
          B.Game.load(10);
          var g = B.Game.g, b = g.board, C = B.C;
          // 连发两颗：第一颗在底部中心，第二颗在框内偏左（飞行途中连发）
          g.state = 'aim'; g.aiming = true; g.balls = 9;
          g.aimAnchor = { x: C.BX + C.BW / 2, y: C.BY + C.BH / 2 };
          g.aimAngle = -Math.PI / 2; B.Game.fire();
          var _b1 = g.shots.length;
          g.aimAnchor = { x: C.BX + C.BW / 2 - 70, y: C.BY + C.BH * 0.62 };
          g.aimAngle = -Math.PI / 2; B.Game.fire();
          var _b2 = g.shots.length;
          var _updErr = '', _escaped = false;
          for (var _ki = 0; _ki < 200; _ki++) {
            try { B.Game.update(1 / 60); } catch (e) { _updErr = 'UPDERR ' + e.message; break; }
            for (var _sj = 0; _sj < g.shots.length; _sj++) { if (!_inBox(g.shots[_sj].s)) _escaped = true; }
            try { B.Render.frame(g, g.t); } catch (e) { _updErr = 'RNDERR ' + e.message; break; }
          }
          // 寿命：单发一直推到死，确认 end=life（不是越界逃出 / 不是退化 timeout）
          B.Game.load(10);
          var _g2 = B.Game.g;
          _g2.state = 'aim'; _g2.aiming = true; _g2.balls = 9;
          _g2.aimAnchor = { x: C.BX + C.BW / 2, y: C.BY + C.BH / 2 };
          _g2.aimAngle = -Math.PI / 2; B.Game.fire();
          var _s0 = _g2.shots[0].s;
          for (var _li = 0; _li < 4000 && _s0.alive; _li++) B.Phys.step(_s0);
          document.title = 'BOX b1=' + _b1 + ' b2=' + _b2 + ' escaped=' + (_escaped ? 1 : 0) +
            ' updErr=' + (_updErr ? 1 : 0) + ' lifeEnd=' + _s0.end +
            (_updErr || _escaped || _b1 !== 1 || _b2 !== 2 || _s0.end !== 'life' ? ' FAIL' : ' ok=1');
        } catch (e) { document.title = 'BOXERR ' + (e && e.message); }
      }
      // 深链某个界面（调试用，正常玩不会带这个参数）：?screen=screenRunnerShop 之类
      var sk = q.get('screen');
      if (sk) { try { B.UI.show(sk); } catch (e) { } }
      // 自检模式：无头 Chrome 的虚拟时间下 rAF 可能不触发，用定时器驱动主循环
      if (q.get('selftest')) {
        setInterval(function () { frame(performance.now()); }, 16);
      }
      // 无尽冲刺自检信标：把实时分数 / 命数 / 金币 / 死局次数打回服务端，便于无头验证（仅 ?selftest=1&beacon=1 时）
      if (_bn && q.get('selftest')) {
        setInterval(function () {
          try {
            var gm = B.Game.g;
            var mode = gm ? (gm.mode || '?') : 'nog';
            if (gm && gm.mode === 'runner' && B.Runner && B.Runner.state()) {
              var s = B.Runner.state();
              report('RUNNER mode=' + mode + ' score=' + Math.floor(s.score) + ' lives=' + s.lives + ' coins=' + s.coins + ' shield=' + s.shield + ' dead=' + s.dead + ' reachBad=' + s._reachBad);
            } else {
              report('MODE mode=' + mode);   // 心跳：无论什么模式都回报一次，便于定位"没进无尽冲刺"还是"信标没通"
            }
          } catch (e) { report('ERR ' + (e && e.message)); }
        }, 500);
      }
      // 自检结果回传（仅 &beacon=1&beaconurl=... 时启用，正常玩不触发）：
      // 无头环境 --dump-dom 会因无限定时器抢不到时机，改用本地 HTTP 信标把结果打到服务端日志。
      // _bn 已在 debugHooks 开头声明，这里只定义 report。
      function report(t) {
        document.title = t;
        if (_bn) { try { new Image().src = _bn + '?d=' + encodeURIComponent(t); } catch (e) { } }
      }
      var n = parseInt(q.get('autostart'), 10);
      if (!(n > 0)) return;
      setTimeout(function () {
        B.UI.startLevel(n);
        if (!q.get('autoplay')) return;
        // 自动游玩机器人：每发都用"贪心选最佳角度"打（与生成器求解器同思路），
        // 直到过关/失败或打满 30 发。这样能端到端验证多目标关卡（含引力场）真的能通。
        var botShots = 0;
        var botIv = setInterval(function () {
          var g = B.Game.g;
          if (g.state !== 'aim') return;                 // 等这一发飞完
          if (botShots >= 30) { clearInterval(botIv); report('SELFTEST BOT-STUCK shots=' + botShots); return; }
          if (q.get('clutch') && botShots === 0) { g.totalBalls = 4; g.balls = 1; }  // 绝杀流程：压成 1 颗
          var st = B.Meta.stats();
          var bestA = -Math.PI / 2, bestScore = -1;
          for (var k = 0; k < 24; k++) {
            var a = B.U.AMIN + (B.U.AMAX - B.U.AMIN) * (k / 23);
            var ev = B.Phys.evalAngle(B.Board.clone(g.board), a, { dmg: st.dmg, boomR: st.boomR, boomDmg: st.boomDmg, chain: st.chain });
            var sc = ev.tgtKilled * 1000 + ev.hpDealt * 10 + ev.gained * 400 + (ev.cleared ? 1e6 : 0);
            if (sc > bestScore) { bestScore = sc; bestA = a; }
          }
          botShots++;
          // 机器人的角度是求解器按"底边正中出生"算出来的；把锚点放在那条射线上，
          // 反推出来的边框入口才会跟求解器一致，否则选出的角度打出来是另一条线。
          var sp = { x: g.board.launchX, y: B.C.BY + B.C.BH - B.C.BALL_R - 2 };
          g.aimAnchor = { x: sp.x + Math.cos(bestA) * 180, y: sp.y + Math.sin(bestA) * 180 };
          B.Game.aimSet(bestA); B.Game.fire();
        }, 300);
        var watch = setInterval(function () {
          var g = B.Game.g;
          if (g.state === 'result' || g.result) {
            clearInterval(botIv); clearInterval(watch);
            var r = g.result;
            report(r
              ? 'SELFTEST ' + (r.won ? 'WIN' : 'LOSE') + ' clutch=' + !!r.clutch + ' coin=' + r.coin + ' stars=' + r.stars + ' shots=' + r.shots
              : 'SELFTEST NO-RESULT state=' + B.Game.state() + ' targets=' + B.Game.targetsLeft());
          }
        }, 250);
      }, 400);
    } catch (e) { }
  }

  function boot() {
    canvas = document.getElementById('game');
    if (!canvas) { fail('找不到 canvas'); return; }
    B.Render.init(canvas);
    B.Meta.load();
    // 先加载第 1 关当菜单背景（画面不至于空着）
    B.Game.load(1);
    B.UI.boot();
    bindInput();
    debugHooks();
    // 注册 Service Worker：让游戏可"安装为独立 App"且离线可玩（仅 http/https 下生效，file:// 忽略）
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js?v=32').catch(function () { });
      });
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

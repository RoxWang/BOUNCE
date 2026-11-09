// ui.js —— 界面：游戏大厅 / 各游戏菜单 / 选关 / 强化 / 结算 / 玩法介绍 / HUD
// 大厅只认 B.Games 注册表；加游戏不用改这里。
var B = window.B = window.B || {};

B.UI = (function () {
  var Meta = B.Meta, Game = B.Game, A = B.A, U = B.U, Gen = B.Gen;
  var $ = function (id) { return document.getElementById(id); };
  var SCREENS = ['screenHub', 'screenMenu', 'screenLevels', 'screenUpgrades', 'screenRunnerShop', 'screenHopShop', 'screenResult', 'screenHow'];
  var cur = 'screenHub';
  var howReturn = 'screenHub';       // 从哪个界面进的「玩法介绍」，关闭后就回哪
  var hubFilter = { cat: '全部', q: '' };
  var lvRange = 0;                   // 选关分段 0..3（1–50 / 51–100 / 101–150 / 151–200）

  // 离开街机类游戏（无尽冲刺 / 跳跃拾金）：把主循环切回弹珠并停掉音乐，
  // 否则它们的循环会在大厅背后继续跑、把死局画面卡在菜单后面。
  // load(1) 内部会 applyGeo 复位 C.W/C.H（跳跃拾金把视口改成横屏过）并重算渲染缩放。
  function leaveArcade() {
    if (Game.g.mode !== 'runner' && Game.g.mode !== 'hop') return;
    if (Game.g.mode === 'hop' && B.Hop && B.Hop.cashOut) B.Hop.cashOut();  // 退出前结算本局金币
    Game.g.mode = 'marble';
    Game.load(1);
    // 虚拟按键立刻切回弹珠那套，别等下一帧主循环 —— 否则退出大厅的瞬间还挂着跳跃键。
    var mp = $('pad'), hp = $('hopPad'), he = $('hud');
    if (mp) mp.classList.remove('hidden');
    if (hp) hp.classList.add('hidden');
    if (he) he.classList.remove('hop-mode');
  }

  function show(name) {
    leaveArcade();
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $(SCREENS[i]);
      if (el) el.classList.toggle('hidden', SCREENS[i] !== name);
    }
    cur = name;
    $('hud').classList.toggle('hidden', name !== null);
    if (name === 'screenMenu') syncMenu();
    if (name === 'screenLevels') syncLevels();
    if (name === 'screenUpgrades') syncUpgrades();
    if (name === 'screenRunnerShop') syncRunnerShop();
    if (name === 'screenHopShop') syncHopShop();
    if (name === 'screenHub') syncHub();
  }

  function inGame() {
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $(SCREENS[i]); if (el) el.classList.add('hidden');
    }
    cur = null;
    $('hud').classList.remove('hidden');
  }

  // 从大厅进无尽冲刺：必须先关掉大厅这层界面，否则游戏在背后跑、玩家什么都看不见。
  function startRunner() {
    inGame();
    Game.startRunner();
    syncHud(true);
  }

  // 从大厅进跳跃拾金：同样必须先关掉大厅这层界面，否则游戏在背后跑。
  function startHop() {
    inGame();
    Game.startHop();
    syncHud(true);
  }

  // ---------- 游戏大厅 ----------
  function syncHub() {
    $('hCoin').textContent = U.fmt(U.coins());

    var last = B.Games.last();
    var cont = $('hubContinue');
    if (last) {
      cont.classList.remove('hidden');
      $('hubLastName').textContent = last.name;
      $('btnHubContinue').onclick = function () { A.unlock(); A.play('click'); B.Games.resumeGame(last.id); };
    } else {
      cont.classList.add('hidden');
    }

    // 只有几个游戏时，分类和搜索只是碍事的小字；游戏多了再自动出现。
    var lean = B.Games.list().length <= 3;
    $('hubToolbar').classList.toggle('hidden', lean);
    if (lean) { hubFilter.cat = '全部'; hubFilter.q = ''; $('hubSearch').value = ''; }

    var cats = ['全部'].concat(B.Games.categories());
    var catWrap = $('hubCats');
    catWrap.innerHTML = '';
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'cat' + (hubFilter.cat === c ? ' on' : '');
      b.textContent = c;
      b.onclick = function () { A.play('click'); hubFilter.cat = c; syncHub(); };
      catWrap.appendChild(b);
    });

    var q = hubFilter.q.trim().toLowerCase();
    var items = B.Games.list().filter(function (g) {
      if (hubFilter.cat !== '全部' && (g.category || '其它') !== hubFilter.cat) return false;
      if (!q) return true;
      return ((g.name || '') + ' ' + (g.desc || '')).toLowerCase().indexOf(q) >= 0;
    });

    var wrap = $('gameCards');
    wrap.innerHTML = '';
    items.forEach(function (g) {
      var acts = '<button class="btn primary genter">开始</button>';
      if (g.shop) acts += '<button class="btn ghost small gshop">强化</button>';
      var card = document.createElement('article');
      card.className = 'gcard';
      card.innerHTML =
        '<div class="gico">' + (g.icon || '◉') + '</div>' +
        '<div class="gbody"><b>' + g.name + '</b>' +
        '<span class="gdesc">' + (g.desc || '') + '</span></div>' +
        '<div class="gacts">' + acts + '</div>';
      card.querySelector('.genter').onclick = function () { A.unlock(); A.play('click'); B.Games.enterGame(g.id); };
      if (g.shop) card.querySelector('.gshop').onclick = function () { A.unlock(); A.play('click'); g.shop(); };
      wrap.appendChild(card);
    });
    $('hubEmpty').classList.toggle('hidden', items.length > 0);
  }

  // ---------- 弹珠解谜菜单 ----------
  function syncMenu() {
    var S = Meta.data();
    $('mCoin').textContent = U.fmt(U.coins());
    $('mDone').textContent = Meta.clearedCount();
    $('mBest').textContent = S.maxLevel > 1 ? ('第 ' + (S.maxLevel - 1) + ' 关') : '—';
    $('mNext').textContent = S.cur || 1;
  }

  // ---------- 选关：分段 + 跳关，200 关全开 ----------
  var RANGES = [[1, 50], [51, 100], [101, 150], [151, 200]];
  function syncLevels() {
    var S = Meta.data();
    var grid = $('lvGrid');
    grid.innerHTML = '';
    var lo = RANGES[lvRange][0], hi = RANGES[lvRange][1];
    $('lvProgress').textContent = '全部 200 关 · 已通关 ' + Meta.clearedCount();
    var btns = document.querySelectorAll('#lvRanges .range');
    for (var bi = 0; bi < btns.length; bi++) btns[bi].classList.toggle('on', bi === lvRange);
    for (var n = lo; n <= hi; n++) {
      (function (n) {
        var d = document.createElement('button');
        d.className = 'gcell';
        if (Meta.isCleared(n)) d.classList.add('done');
        if (n === (S.cur || 1)) d.classList.add('cur');
        var st = Meta.starsOf(n);
        d.innerHTML = '<b>' + n + '</b>' +
          (st ? '<span class="st">' + '★'.repeat(st) + '</span>' : '<small>' + (n <= Gen.count() ? '教学' : '') + '</small>');
        d.onclick = function () { A.play('click'); startLevel(n); };
        grid.appendChild(d);
      })(n);
    }
  }

  // ---------- 弹珠解谜强化 ----------
  function syncUpgrades() {
    $('upCoin').textContent = U.fmt(U.coins());
    var list = $('upList');
    list.innerHTML = '';
    Meta.UPS.forEach(function (u) {
      var lv = Meta.level(u.id);
      var maxed = lv >= u.max;
      var cost = Meta.costOf(u.id);
      var row = document.createElement('div');
      row.className = 'up' + (maxed ? ' max' : '');
      var pips = '';
      for (var i = 0; i < u.max; i++) pips += '<em class="' + (i < lv ? 'on' : '') + '"></em>';
      row.innerHTML =
        '<i>' + u.icon + '</i>' +
        '<div class="info"><b>' + u.name + ' <span style="color:var(--t3);font-size:12px">Lv.' + lv + '/' + u.max + '</span></b>' +
        '<span>' + u.desc + '</span><div class="pips">' + pips + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'buy' + (maxed ? ' done' : '');
      if (maxed) { btn.textContent = 'MAX'; btn.disabled = true; }
      else {
        btn.textContent = '◈ ' + U.fmt(cost);
        btn.disabled = U.coins() < cost;
        btn.onclick = function () { if (Meta.buy(u.id)) { A.play('buy'); syncUpgrades(); } };
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  // ---------- 无尽冲刺强化 ----------
  function syncRunnerShop() {
    var data = B.Runner.shopData();
    $('runnerWallet').textContent = U.fmt(data.wallet);
    var mb = $('btnRunnerMute');
    if (mb) mb.textContent = B.Music.isMuted() ? '🔇 音乐：关' : '🔊 音乐：开';
    var list = $('runnerUpList');
    list.innerHTML = '';
    data.defs.forEach(function (u) {
      var lv = data.up[u.id] || 0;
      var maxed = lv >= u.max;
      var cost = B.Runner.costOf(u.id);
      var row = document.createElement('div');
      row.className = 'up' + (maxed ? ' max' : '');
      var pips = '';
      for (var i = 0; i < u.max; i++) pips += '<em class="' + (i < lv ? 'on' : '') + '"></em>';
      row.innerHTML =
        '<i>' + u.icon + '</i>' +
        '<div class="info"><b>' + u.name + ' <span style="color:var(--t3);font-size:12px">Lv.' + lv + '/' + u.max + '</span></b>' +
        '<span>' + u.desc + '</span><div class="pips">' + pips + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'buy' + (maxed ? ' done' : '');
      if (maxed) { btn.textContent = 'MAX'; btn.disabled = true; }
      else {
        btn.textContent = '◈ ' + U.fmt(cost);
        btn.disabled = data.wallet < cost;
        btn.onclick = function () { if (B.Runner.buy(u.id)) { A.play('buy'); syncRunnerShop(); } };
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  // ---------- 跳跃拾金强化 ----------
  function syncHopShop() {
    var data = B.Hop.shopData();
    $('hopWallet').textContent = U.fmt(data.wallet);
    var list = $('hopUpList');
    list.innerHTML = '';
    data.defs.forEach(function (u) {
      var lv = data.up[u.id] || 0;
      var maxed = lv >= u.max;
      var cost = B.Hop.costOf(u.id);
      var row = document.createElement('div');
      row.className = 'up' + (maxed ? ' max' : '');
      var pips = '';
      for (var i = 0; i < u.max; i++) pips += '<em class="' + (i < lv ? 'on' : '') + '"></em>';
      row.innerHTML =
        '<i>' + u.icon + '</i>' +
        '<div class="info"><b>' + u.name + ' <span style="color:var(--t3);font-size:12px">Lv.' + lv + '/' + u.max + '</span></b>' +
        '<span>' + u.desc + '</span><div class="pips">' + pips + '</div></div>';
      var btn = document.createElement('button');
      btn.className = 'buy' + (maxed ? ' done' : '');
      if (maxed) { btn.textContent = 'MAX'; btn.disabled = true; }
      else {
        btn.textContent = '◈ ' + U.fmt(cost);
        btn.disabled = data.wallet < cost;
        btn.onclick = function () { if (B.Hop.buy(u.id)) { A.play('buy'); syncHopShop(); } };
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  // ---------- 进关 ----------
  function startLevel(n) {
    inGame();
    $('hudName').textContent = '第 ' + n + ' 关';
    $('hudGoal').textContent = '生成中…';
    $('hudAuto').textContent = '';
    setTimeout(function () {
      Game.load(n);
      syncHud(true);
    }, 24);
  }

  // ---------- HUD ----------
  var lastBalls = -1, lastTargets = -1, lastCombo = -1;
  function syncHud(force) {
    var g = Game.g;
    $('hudCoin').textContent = '◈ ' + U.fmt(U.coins());
    // 跳跃拾金用一套精简 HUD：顶栏不重复显示金币，底部提示下移到虚拟按键那一排。
    var hudEl = $('hud');
    if (hudEl) hudEl.classList.toggle('hop-mode', g.mode === 'hop');
    // 虚拟按键按模式互斥：弹珠用 #pad，跳跃拾金用 #hopPad，无尽冲刺两者都不要。
    var mp = $('pad'), hp = $('hopPad');
    if (mp) mp.classList.toggle('hidden', g.mode !== 'marble');
    if (hp) hp.classList.toggle('hidden', g.mode !== 'hop');
    if (g.mode === 'runner') {
      $('hudName').textContent = '无尽冲刺';
      $('hudGoal').textContent = '方向键 / 拖动 躲开下落方块';
      var sb = document.querySelector('.statusbar');
      if (sb) sb.style.display = 'none';
      $('btnMenu').classList.add('hidden');
      $('btnUndo').classList.add('hidden');
      $('btnNext').classList.add('hidden');
      $('btnRestart').classList.add('hidden');
      var al = $('hudAuto');
      al.textContent = '← → 或拖动屏幕 · 撞到就结束 · 空格 / 点击重来';
      al.style.opacity = 1; al.className = 'autoline';
      return;
    }
    if (g.mode === 'hop') {
      $('hudName').textContent = '跳跃拾金';
      $('hudGoal').textContent = '';
      var sbh = document.querySelector('.statusbar');
      if (sbh) sbh.style.display = 'none';
      $('btnMenu').classList.add('hidden');
      $('btnUndo').classList.add('hidden');
      $('btnNext').classList.add('hidden');
      $('btnRestart').classList.add('hidden');
      var alh = $('hudAuto');
      alh.textContent = '← → 跑 · 空格 跳';
      alh.style.opacity = 1; alh.className = 'autoline';
      return;
    }
    var sb2 = document.querySelector('.statusbar');
    if (sb2) sb2.style.display = '';
    $('btnMenu').classList.remove('hidden');
    $('btnRestart').classList.remove('hidden');
    if (!g.board) return;
    $('hudName').textContent = '第 ' + g.n + ' 关' + (g.level && g.level.name ? ' · ' + g.level.name : '');
    var tl = Game.targetsLeft();
    $('hudGoal').textContent = '剩余目标：' + tl;

    if (g.balls !== lastBalls || force) {
      $('hudBalls').textContent = g.balls;
      if (!force) flash('hudBalls'); lastBalls = g.balls;
    }
    if (tl !== lastTargets || force) {
      $('hudTargets').textContent = tl;
      if (!force) flash('hudTargets'); lastTargets = tl;
    }
    if (g.combo !== lastCombo || force) {
      $('hudCombo').textContent = g.combo;
      if (!force && g.combo > 0) flash('hudCombo'); lastCombo = g.combo;
    }

    var line = $('hudAuto');
    if (g.state === 'aim') {
      var txt;
      if (g.preview && g.preview.cleared) {
        txt = '这一发能清完目标 —— 松手';
        line.className = 'autoline good';
      } else if (g.balls === 1) {
        txt = '最后一颗 · 打完就见分晓';
        line.className = 'autoline warn';
      } else if (g.aiming) {
        txt = '松手发射 · 虚线就是球会走的路';
        line.className = 'autoline';
      } else {
        txt = '拖动定方向 · 球从边框打进来';   // 四面都是墙，上下左右都能进
        line.className = 'autoline';
      }
      line.textContent = txt;
      line.style.opacity = 1;
    } else {
      line.style.opacity = 0;
    }

    $('hudBalls').style.color = g.balls === 1 && g.state === 'aim' ? 'var(--red)' : '';
    $('btnUndo').classList.toggle('hidden', !(g.state === 'aim' && g.snap));
    $('btnNext').classList.toggle('hidden', g.state !== 'over');
  }

  function flash(id) {
    var box = $(id);
    if (!box || !box.parentElement) return;
    var p = box.parentElement;
    p.classList.remove('flash');
    void p.offsetWidth;
    p.classList.add('flash');
  }

  // ---------- 结算 ----------
  function showResult(r) {
    $('rTitle').textContent = r.won ? (r.clutch ? '绝杀！' : '过关') : '游戏结束';
    $('rTitle').className = 'rtitle ' + (r.won ? (r.clutch ? 'clutch' : 'win') : 'lose');
    $('rStars').textContent = r.won ? ('★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)) : '';
    var rows = '';
    if (r.won) {
      if (r.clutch) rows += '<div class="hl"><span>最后一颗球收的场</span><b>金币 ×2</b></div>';
      rows += '<div><span>用了几颗球</span><b>' + r.shots + ' / ' + r.total + '</b></div>';
      rows += '<div><span>剩多少没用</span><b>' + r.left + '</b></div>';
      rows += '<div><span>最高连击</span><b>' + r.combo + '</b></div>';
      if (r.coins > 0) rows += '<div><span>来自砖块</span><b>◈ ' + r.coins + '</b></div>';
      rows += '<div class="hl"><span>获得金币</span><b>◈ ' + U.fmt(r.coin) + '</b></div>';
    } else {
      rows += '<div class="hl"><span>结束原因</span><b>球用光了</b></div>';
      rows += '<div><span>剩余目标</span><b>' + Game.targetsLeft() + '</b></div>';
      rows += '<div><span>最高连击</span><b>' + r.combo + '</b></div>';
      rows += '<div><span>本关失败次数</span><b>' + Meta.fails(r.n) + '</b></div>';
      if (Meta.mercyBalls(r.n) > 0) {
        rows += '<div><span>下局奖励</span><b>+' + Meta.mercyBalls(r.n) + '</b></div>';
      } else {
        rows += '<div><span>再输 2 次 → 下局多给球</span><b>—</b></div>';
      }
    }
    $('rStats').innerHTML = rows;
    $('btnNext2').textContent = r.won ? '下一关' : '跳过这关';
    show('screenResult');
  }

  // ---------- 绑定 ----------
  function toggleSound() {
    var on = A.toggle();
    Meta.setSound(on);
    $('btnSound').textContent = on ? '♪' : '✕';
    var hb = $('btnHubSound');
    if (hb) hb.textContent = on ? '♪' : '✕';
  }

  function bind() {
    // 大厅
    $('hubSearch').addEventListener('input', function (e) { hubFilter.q = e.target.value; syncHub(); });
    $('btnHubSound').onclick = function () { A.unlock(); toggleSound(); };
    $('btnHubReset').onclick = function () {
      if (confirm('清空所有存档？关卡、金币和强化都会丢失。')) { Meta.reset(); syncHub(); syncMenu(); }
    };

    // 弹珠解谜菜单
    $('btnPlay2').onclick = function () { A.unlock(); A.play('click'); startLevel(Meta.data().cur || 1); };
    $('btnLv').onclick = function () { A.unlock(); A.play('click'); lvRange = Math.floor(((Meta.data().cur || 1) - 1) / 50); if (lvRange > 3) lvRange = 3; show('screenLevels'); };
    $('btnUp').onclick = function () { A.unlock(); A.play('click'); show('screenUpgrades'); };
    $('btnHow').onclick = function () { A.unlock(); A.play('click'); howReturn = 'screenMenu'; show('screenHow'); };
    $('btnReset').onclick = function () {
      if (confirm('清空所有存档？关卡、金币和强化都会丢失。')) { Meta.reset(); syncHub(); syncMenu(); }
    };
    $('btnMenuBack').onclick = function () { A.play('click'); show('screenHub'); };

    // 选关：返回 / 分段 / 跳关
    $('btnLvBack').onclick = function () { A.play('click'); show('screenMenu'); };
    var rb = document.querySelectorAll('#lvRanges .range');
    for (var ri = 0; ri < rb.length; ri++) {
      (function (btn, idx) {
        btn.onclick = function () { A.play('click'); lvRange = idx; syncLevels(); };
      })(rb[ri], ri);
    }
    $('btnLvJump').onclick = function () {
      var n = parseInt($('lvJump').value, 10);
      if (!(n >= 1 && n <= 200)) { $('lvJump').focus(); return; }
      A.play('click'); startLevel(n);
    };
    $('lvJump').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.stopPropagation(); $('btnLvJump').click(); }
    });
    $('btnUpBack').onclick = function () { A.play('click'); show('screenMenu'); };

    // 无尽冲刺强化
    $('btnRunnerMute').onclick = function () {
      var m = B.Music.toggleMute();
      $('btnRunnerMute').textContent = m ? '🔇 音乐：关' : '🔊 音乐：开';
    };
    $('btnRunnerBack').onclick = function () { B.Music.stop(); A.play('click'); show('screenHub'); };

    // 跳跃拾金强化 + 虚拟按键（按住左右持续跑、跳跃按下起跳 / 松开收成小跳）
    $('btnHopBack').onclick = function () { A.play('click'); show('screenHub'); };
    function hopBtn(id, down, up) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        A.unlock();
        try { el.setPointerCapture(e.pointerId); } catch (err) { }
        down(); e.preventDefault();
      });
      el.addEventListener('pointerup', function (e) { if (up) up(); e.preventDefault(); });
      el.addEventListener('pointercancel', function () { if (up) up(); });
    }
    hopBtn('hopLeft', function () { B.Hop.setDir(-1); }, function () { if (B.Hop.state() && B.Hop.state().dir < 0) B.Hop.setDir(0); });
    hopBtn('hopRight', function () { B.Hop.setDir(1); }, function () { if (B.Hop.state() && B.Hop.state().dir > 0) B.Hop.setDir(0); });
    hopBtn('hopJump', function () {
      if (B.Hop.state() && B.Hop.state().dead) { B.Hop.restart(); return; }
      B.Hop.setJumpHeld(true); B.Hop.jump();
    }, function () { B.Hop.setJumpHeld(false); });

    $('btnHowBack').onclick = function () { A.play('click'); show(howReturn); };

    // 对局内：一键回大厅 + 弹珠自己的菜单
    $('btnBack').onclick = function () { A.play('click'); show('screenHub'); };
    $('btnMenu').onclick = function () { A.play('click'); show('screenMenu'); };
    $('btnRestart').onclick = function () { Game.restart(); syncHud(true); };
    $('btnUndo').onclick = function () { if (Game.undo()) syncHud(true); };
    $('btnNext').onclick = function () { next(); };
    $('btnSound').onclick = function () { A.unlock(); toggleSound(); };

    $('btnAgain').onclick = function () { A.play('click'); Game.restart(); inGame(); syncHud(true); };
    $('btnNext2').onclick = function () { A.play('click'); next(); };
    $('btnHome').onclick = function () { A.play('click'); show('screenLevels'); };
    $('btnResultHub').onclick = function () { A.play('click'); show('screenHub'); };

    // 触屏方向键（与键盘同一套 nudge/fire）
    function pad(id, fn) {
      var el = $(id);
      if (el) el.onclick = function () { A.unlock(); A.play('click'); fn(); syncHud(true); };
    }
    pad('padRotL', function () { Game.nudgeAngle(-B.C.ROT_STEP); });
    pad('padRotR', function () { Game.nudgeAngle(B.C.ROT_STEP); });
    pad('padPwrU', function () { Game.nudgePower(0.05); });
    pad('padPwrD', function () { Game.nudgePower(-0.05); });
    pad('padFire', function () { if (Game.g.state === 'aim') Game.fire(); });

    $('howSeg').textContent = Meta.stats().segs;
  }

  function next() {
    var n = Game.g.n + 1;
    if (n > 200) { show('screenHub'); return; }
    startLevel(n);
  }

  // ---------- 键盘：Esc 一律回大厅，随时能停 ----------
  function key(e) {
    var k = e.key.toLowerCase();
    if (Game.g.mode === 'runner') {
      if (k === 'arrowleft') { B.Runner.setDir(-1); e.preventDefault(); }
      else if (k === 'arrowright') { B.Runner.setDir(1); e.preventDefault(); }
      else if (k === ' ' || k === 'enter') {
        if (B.Runner.state() && B.Runner.state().dead) B.Runner.restart();
        e.preventDefault();
      }
      else if (k === 'escape') { show('screenHub'); }
      return;
    }
    if (Game.g.mode === 'hop') {
      if (k === 'arrowleft' || k === 'a') { B.Hop.setDir(-1); e.preventDefault(); }
      else if (k === 'arrowright' || k === 'd') { B.Hop.setDir(1); e.preventDefault(); }
      else if (k === 'arrowup' || k === 'w' || k === ' ') {
        var hk = B.Hop.state();
        if (hk && hk.dead) B.Hop.restart();
        else if (!e.repeat) { B.Hop.setJumpHeld(true); B.Hop.jump(); }
        e.preventDefault();
      }
      else if (k === 'r') { B.Hop.restart(); }
      else if (k === 'escape') { show('screenHub'); }
      return;
    }
    if (cur === 'screenHow' && (k === 'escape' || k === 'enter')) { $('btnHowBack').click(); return; }
    if (cur === 'screenResult') {
      if (k === 'n' || k === 'enter') next();
      else if (k === 'r') { Game.restart(); inGame(); syncHud(true); }
      else if (k === 'escape') show('screenHub');
      return;
    }
    if (cur === 'screenLevels' || cur === 'screenUpgrades' || cur === 'screenRunnerShop' || cur === 'screenHopShop' || cur === 'screenMenu') {
      if (k === 'escape') show(cur === 'screenMenu' ? 'screenHub' : ((cur === 'screenRunnerShop' || cur === 'screenHopShop') ? 'screenHub' : 'screenMenu'));
      return;
    }
    // 输入框里别抢按键
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    // 对局中
    if (k === 'arrowleft') { Game.nudgeAngle(-B.C.ROT_STEP); e.preventDefault(); }
    else if (k === 'arrowright') { Game.nudgeAngle(B.C.ROT_STEP); e.preventDefault(); }
    else if (k === 'arrowup') { Game.nudgePower(0.05); e.preventDefault(); }
    else if (k === 'arrowdown') { Game.nudgePower(-0.05); e.preventDefault(); }
    else if (k === ' ' || k === 'enter') { if (Game.g.state === 'aim') { Game.fire(); syncHud(true); } e.preventDefault(); }
    else if (k === 'r') { Game.restart(); syncHud(true); }
    else if (k === 'z') { if (Game.undo()) syncHud(true); }
    else if (k === 'n' && Game.g.state === 'over') next();
    else if (k === 'escape') show('screenHub');
  }

  function boot() {
    Meta.load();
    bind();
    var S = Meta.data();
    $('btnSound').textContent = S.sound ? '♪' : '✕';
    $('btnHubSound').textContent = S.sound ? '♪' : '✕';
    if (!S.sound) A.toggle();
    show('screenHub');
  }

  return {
    show: show, inGame: inGame, boot: boot, syncHud: syncHud, syncMenu: syncMenu,
    key: key, showResult: showResult, startLevel: startLevel, startRunner: startRunner, startHop: startHop, next: next
  };
})();

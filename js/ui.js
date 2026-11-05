// ui.js —— 界面：菜单 / 选关 / 强化站 / 结算 / 怎么玩，以及 HUD 同步
var B = window.B = window.B || {};

B.UI = (function () {
  var Meta = B.Meta, Game = B.Game, A = B.A, U = B.U, Gen = B.Gen;
  var $ = function (id) { return document.getElementById(id); };
  var SCREENS = ['screenHub', 'screenMenu', 'screenLevels', 'screenUpgrades', 'screenS2Shop', 'screenResult', 'screenHow'];
  var cur = 'screenHub';
  var howReturn = 'screenHub';   // 从哪个界面进的「玩法介绍」，关闭后就回哪

  function show(name) {
    // 切到任意"界面"（非对局）时：如果刚在无尽冲刺里，先把模式复位成弹珠背景，
    // 否则第二季的循环会在主菜单背后继续跑、并把死局画面卡在菜单后面。
    if (name && B.Game.g.mode === 's2') { B.Game.g.mode = 'marble'; B.Game.load(1); }
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $(SCREENS[i]);
      if (el) el.classList.toggle('hidden', SCREENS[i] !== name);
    }
    cur = name;
    $('hud').classList.toggle('hidden', name !== null);
    if (name === 'screenMenu') syncMenu();
    if (name === 'screenLevels') syncLevels();
    if (name === 'screenUpgrades') syncUpgrades();
    if (name === 'screenS2Shop') syncS2Shop();
    if (name === 'screenHub') syncHub();
  }

  function inGame() {
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $(SCREENS[i]); if (el) el.classList.add('hidden');
    }
    cur = null;
    $('hud').classList.remove('hidden');
  }

  // ---------- 合集首页（BOUNCE 外壳）----------
  function syncHub() {
    $('hCoin').textContent = U.fmt(B.U.coins());     // 合集统一金库
    $('hDone').textContent = Meta.clearedCount();
    var wrap = $('gameCards');
    wrap.innerHTML = '';
    // 游戏卡片全部由 B.Games 注册表驱动 —— 加新游戏只需在 game.js 里 B.Games.add(...)，这里自动多一张卡
    B.Games.list().forEach(function (g) {
      var card = document.createElement('div');
      card.className = 'gcard';
      var acts = '<button class="btn primary genter">进入</button>';
      if (g.shop) acts += '<button class="btn ghost small gshop">强化</button>';
      card.innerHTML =
        '<div class="gico">' + g.icon + '</div>' +
        '<div class="gbody"><b>' + g.name + '</b>' +
        '<span class="gtag">' + g.tag + '</span>' +
        '<span class="gdesc">' + g.desc + '</span></div>' +
        '<div class="gacts">' + acts + '</div>';
      card.querySelector('.genter').onclick = function () { A.unlock(); A.play('click'); g.enter(); };
      if (g.shop) card.querySelector('.gshop').onclick = function () { A.unlock(); A.play('click'); g.shop(); };
      wrap.appendChild(card);
    });
  }

  // ---------- 菜单（弹珠模式子菜单）----------
  function syncMenu() {
    var S = Meta.data();
    $('mCoin').textContent = U.fmt(B.U.coins());    // 合集统一金库
    $('mDone').textContent = Meta.clearedCount();
    $('mBest').textContent = S.maxLevel > 1 ? ('Level ' + (S.maxLevel - 1)) : '—';
    $('mNext').textContent = S.cur || 1;
  }

  // ---------- 选关 ----------
  function syncLevels() {
    var S = Meta.data();
    var grid = $('lvGrid');
    grid.innerHTML = '';
    // 不做任何解锁限制：全部 200 关一次性放出，玩家自由选（想打第 50 关就直接点第 50 关）
    var top = 200;
    $('lvProgress').textContent = '全部 200 关 · 已通关 ' + Meta.clearedCount();
    for (var n = 1; n <= top; n++) {
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

  // ---------- 强化站 ----------
  function syncUpgrades() {
    var S = Meta.data();
    $('upCoin').textContent = U.fmt(B.U.coins());    // 合集统一金库（与无尽冲刺共用）
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
        btn.disabled = B.U.coins() < cost;
        btn.onclick = function () {
          if (Meta.buy(u.id)) { A.play('buy'); syncUpgrades(); }
        };
      }
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  // ---------- 第二季强化（铭文式持久强化）----------
  function syncS2Shop() {
    var data = B.S2.shopData();
    $('s2Wallet').textContent = U.fmt(data.wallet);
    var mb = $('btnS2Mute');
    if (mb) mb.textContent = B.Music.isMuted() ? '🔇 Music: Off' : '🔊 Music: On';
    var list = $('s2UpList');
    list.innerHTML = '';
    data.defs.forEach(function (u) {
      var lv = data.up[u.id] || 0;
      var maxed = lv >= u.max;
      var cost = B.S2.costOf(u.id);
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
        btn.onclick = function () { if (B.S2.buy(u.id)) { A.play('buy'); syncS2Shop(); } };
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
    // 让浏览器先把"出题中"画出来，再做可能要几百毫秒的关卡生成
    setTimeout(function () {
      Game.load(n);
      syncHud(true);
    }, 24);
  }

  // ---------- HUD ----------
  var lastBalls = -1, lastTargets = -1, lastCombo = -1;
  function syncHud(force) {
    var g = Game.g;
    var S = Meta.data();
    $('hudCoin').textContent = '◈ ' + U.fmt(B.U.coins());    // 合集统一金库
    // 第二季（无尽躲避）：没有"剩余球/目标/连击"这套，换成专门的提示
    if (g.mode === 's2') {
      $('hudName').textContent = '无尽冲刺';
      $('hudGoal').textContent = '方向键 / 拖动 躲开下落方块';
      var sb = document.querySelector('.statusbar');
      if (sb) sb.style.display = 'none';
      var al = $('hudAuto');
      al.textContent = '← → 或拖动屏幕 · 撞到就结束 · 空格 / 点击重来';
      al.style.opacity = 1; al.className = 'autoline';
      $('btnUndo').classList.add('hidden');
      $('btnNext').classList.add('hidden');
      return;
    }
    var sb = document.querySelector('.statusbar');
    if (sb) sb.style.display = '';
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

    // 底部状态行：只在能瞄的时候说一句，不唠叨
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
        txt = '按住往上拖 → 瞄准 → 松手';
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
  function bind() {
    // —— 合集首页（screenHub）——
    $('btnHubReset').onclick = function () {
      if (confirm('清空所有存档？关卡、金币和强化都会丢失。')) { Meta.reset(); syncHub(); syncMenu(); }
    };

    // —— 弹珠模式子菜单（screenMenu）——
    $('btnPlay2').onclick = function () { A.unlock(); A.play('click'); startLevel(Meta.data().cur || 1); };
    $('btnLv').onclick = function () { A.unlock(); A.play('click'); show('screenLevels'); };
    $('btnUp').onclick = function () { A.unlock(); A.play('click'); show('screenUpgrades'); };
    $('btnHow').onclick = function () { A.unlock(); A.play('click'); howReturn = 'screenMenu'; show('screenHow'); };
    $('btnReset').onclick = function () {
      if (confirm('清空所有存档？关卡、金币和强化都会丢失。')) { Meta.reset(); syncHub(); syncMenu(); }
    };
    $('btnMenuBack').onclick = function () { A.play('click'); show('screenHub'); };   // 弹珠子菜单 → 合集首页

    // —— 选关 / 强化站返回 ——
    $('btnLvBack').onclick = function () { A.play('click'); show('screenMenu'); };
    $('btnUpBack').onclick = function () { A.play('click'); show('screenMenu'); };

    // —— 第二季强化返回 → 合集首页（不是弹珠子菜单）——
    $('btnS2Mute').onclick = function () {
      var m = B.Music.toggleMute();
      $('btnS2Mute').textContent = m ? '🔇 音乐：关' : '🔊 音乐：开';
    };
    $('btnS2Back').onclick = function () { B.Music.stop(); A.play('click'); show('screenHub'); };
    $('btnHowBack').onclick = function () { A.play('click'); show(howReturn); };

    // —— 对局内返回：按当前玩法分流（弹珠回子菜单，无尽冲刺回合集首页）——
    $('btnBack').onclick = function () {
      A.play('click');
      if (B.Game.g.mode === 's2') show('screenHub');
      else show('screenMenu');
    };
    $('btnRestart').onclick = function () { Game.restart(); syncHud(true); };
    $('btnUndo').onclick = function () { if (Game.undo()) syncHud(true); };
    $('btnNext').onclick = function () { next(); };
    $('btnSound').onclick = function () {
      var on = A.toggle(); $('btnSound').textContent = on ? '♪' : '✕'; Meta.setSound(on);
    };

    $('btnAgain').onclick = function () { A.play('click'); Game.restart(); inGame(); syncHud(true); };
    $('btnNext2').onclick = function () { A.play('click'); next(); };
    $('btnHome').onclick = function () { A.play('click'); show('screenLevels'); };

    // 触屏方向键（手机网页版没有方向键，用屏幕按钮，和键盘同一套 nudge/fire）
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
    if (n > 200) { show('screenHub'); return; }   // 弹珠 1–200 关，打完后回合集首页
    startLevel(n);
  }

  // ---------- 键盘 ----------
  function key(e) {
    var k = e.key.toLowerCase();
    // 第二季（无尽躲避）：方向键左右移动，空格在死亡后重来，Esc 退回选关
    if (Game.g.mode === 's2') {
      if (k === 'arrowleft') { B.S2.setDir(-1); e.preventDefault(); }
      else if (k === 'arrowright') { B.S2.setDir(1); e.preventDefault(); }
      else if (k === ' ' || k === 'enter') {
        if (B.S2.state() && B.S2.state().dead) B.S2.restart();
        e.preventDefault();
      }
      else if (k === 'escape') { show('screenHub'); }
      return;
    }
    if (cur === 'screenHow' && (k === 'escape' || k === 'enter')) { $('btnHowBack').click(); return; }
    if (cur === 'screenMenu' || cur === 'screenLevels' || cur === 'screenUpgrades') {
      if (k === 'escape') { show('screenMenu'); }
      return;
    }
    if (cur === 'screenResult') {
      if (k === 'n' || k === 'enter') next();
      else if (k === 'r') { Game.restart(); inGame(); syncHud(true); }
      else if (k === 'escape') show('screenLevels');
      return;
    }
    // 对局中
    if (k === 'arrowleft') { Game.nudgeAngle(-B.C.ROT_STEP); e.preventDefault(); }
    else if (k === 'arrowright') { Game.nudgeAngle(B.C.ROT_STEP); e.preventDefault(); }
    else if (k === 'arrowup') { Game.nudgePower(0.05); e.preventDefault(); }
    else if (k === 'arrowdown') { Game.nudgePower(-0.05); e.preventDefault(); }
    else if (k === ' ' || k === 'enter') { if (Game.g.state === 'aim') { Game.fire(); syncHud(true); } e.preventDefault(); }
    else if (k === 'r') { Game.restart(); syncHud(true); }
    else if (k === 'z') { if (Game.undo()) syncHud(true); }
    else if (k === 'n' && Game.g.state === 'over') next();
    else if (k === 'escape') show('screenLevels');
  }

  function boot() {
    Meta.load();
    bind();
    var S = Meta.data();
    $('btnSound').textContent = S.sound ? '♪' : '✕';
    if (!S.sound) A.toggle();
    // 进游戏就停在 BOUNCE 合集主页；「玩法介绍」不再自动弹，改为主页上的按钮
    show('screenHub');
  }

  return { show: show, inGame: inGame, boot: boot, syncHud: syncHud, syncMenu: syncMenu, key: key, showResult: showResult, startLevel: startLevel, next: next };
})();

// util.js —— 基础工具：随机数、数学、缓动、颜色
// 注意：全局必须用 var（多个 script 共享同一作用域，const 重复声明会让后面所有文件整个作废）
var B = window.B = window.B || {};

B.U = (function () {

  // 确定性随机数（mulberry32）：同一个种子永远得到同一串数。
  // 关卡生成靠它——第 37 关在世界任何一台电脑上都是同一道题。
  function rng(seed) {
    var a = seed >>> 0;
    var f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = function (n) { return Math.floor(f() * n); };
    f.range = function (a2, b2) { return a2 + f() * (b2 - a2); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    f.shuffle = function (arr) {
      var r = arr.slice();
      for (var i = r.length - 1; i > 0; i--) {
        var j = Math.floor(f() * (i + 1)); var t = r[i]; r[i] = r[j]; r[j] = t;
      }
      return r;
    };
    return f;
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(x1, y1, x2, y2) { var dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; }
  function dist(x1, y1, x2, y2) { return Math.sqrt(dist2(x1, y1, x2, y2)); }
  function norm(x, y) { var d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; }

  // 缓动
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t * t; }
  function easeOutBack(t) { var c = 1.70158 + 1; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // 圆角矩形路径（老浏览器没有 roundRect，自己画最稳）
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // 数字缩写：1234 → 1.2k
  function fmt(n) {
    n = Math.floor(n);
    if (n < 1000) return '' + n;
    if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'k';
    if (n < 1e9) return (n / 1e6).toFixed(1) + 'M';
    return (n / 1e9).toFixed(1) + 'B';
  }

  // ---------- 合集统一金库（bounce.coins）----------
  // BOUNCE 是"合集"：弹珠模式、无尽冲刺等所有游戏赚到的金币，全部进同一个钱包。
  // 放在 util.js 是因为它被所有脚本和测试最先加载，两边都能直接读，避免两份账本对不上。
  var COIN_KEY = 'bounce.coins';
  function _readCoins() {
    try { return Math.max(0, parseInt(localStorage.getItem(COIN_KEY) || '0', 10) || 0); } catch (e) { return 0; }
  }
  function _writeCoins(v) {
    try { localStorage.setItem(COIN_KEY, String(Math.max(0, Math.round(v)))); } catch (e) { }
  }
  function coins() { return _readCoins(); }
  function addCoins(n) { var v = _readCoins() + Math.round(n); _writeCoins(v); return v; }
  function spendCoins(n) {
    n = Math.round(n);
    if (n <= 0) return true;
    var v = _readCoins();
    if (v < n) return false;
    _writeCoins(v - n);
    return true;
  }
  function setCoins(n) { _writeCoins(n); }

  // 【遗留】把角度限制在"朝上"的扇形里（屏幕坐标 y 向下，所以朝上 = sin<0）。
  // 这是旧"底部发射"时代的规矩：那时往下打球会直接掉出界，所以夹在 -170° ~ -10°。
  // 封闭框时代四边都会反射，往下/往侧面打完全合法 —— 玩家瞄准一律改用 normAngle，
  // clampAngle 只剩求解器/兼容用途，别再拿它夹玩家的方向。
  var AMIN = -Math.PI * 0.944;   // -170°
  var AMAX = -Math.PI * 0.0556;  // -10°
  function clampAngle(a) {
    // 先把角度规整到 (-PI, PI]
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    if (Math.sin(a) >= -0.02) {
      // 指向水平或下方：掰到最近的合法边（保留左右方向）
      a = Math.cos(a) >= 0 ? AMAX : AMIN;
    }
    return clamp(a, AMIN, AMAX);
  }
  // 只把角度规整到 (-PI, PI]，不限制方向：台球式 360° 任意发射（上下左右都能打）。
  // 封闭框里每个方向都会撞墙反射，不需要也不该禁止任何方向。
  function normAngle(a) {
    while (a <= -Math.PI) a += Math.PI * 2;
    while (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  return {
    rng: rng, clamp: clamp, lerp: lerp, dist: dist, dist2: dist2, norm: norm,
    easeOut: easeOut, easeIn: easeIn, easeOutBack: easeOutBack, easeInOut: easeInOut,
    roundRect: roundRect, fmt: fmt, clampAngle: clampAngle, normAngle: normAngle, AMIN: AMIN, AMAX: AMAX,
    coins: coins, addCoins: addCoins, spendCoins: spendCoins, setCoins: setCoins
  };
})();

// meta.js —— 存档 + 永久升级（"死一次不是失败，是给下一关攒了一笔钱"）
var B = window.B = window.B || {};

B.Meta = (function () {
  var KEY = 'bounce.save.v1';

  // 六条升级线。每条都有明确上限，避免数值失控。
  var UPS = [
    {
      id: 'sight', name: '视力', icon: '◉', max: 5,
      desc: '多看一段预测弹道。你能算多远，就是你的段位。',
      cost: [60, 150, 320, 650, 1300]
    },
    {
      id: 'bag', name: '储备', icon: '◍', max: 4,
      desc: '每关开局多 1 颗球。多一颗球 = 多一次决策。',
      cost: [90, 240, 560, 1200]
    },
    {
      id: 'power', name: '力量', icon: '✦', max: 3,
      desc: '每次命中 +1 伤害。硬砖碎得更快。',
      cost: [120, 340, 820]
    },
    {
      id: 'blast', name: '爆破', icon: '✺', max: 3,
      desc: '炸弹爆炸范围 +30%。一发清半排。',
      cost: [100, 280, 700]
    },
    {
      id: 'chain', name: '连击', icon: '⚡', max: 2,
      desc: '连击加成门槛 6 → 5 → 4。穿缝比硬刚更划算。',
      cost: [180, 520]
    },
    {
      id: 'greed', name: '贪婪', icon: '◈', max: 3,
      desc: '过关金币 +30%。省球的速度决定你能走多远。',
      cost: [80, 220, 560]
    }
  ];

  function fresh() {
    return {
      coin: 0,
      cleared: {},        // {关号: {stars, left, tries}}
      maxLevel: 1,        // 通关过的最高关
      cur: 1,             // 当前要打的关
      fail: {},           // {关号: 失败次数} —— 卡太久会自动送一颗球
      up: { sight: 0, bag: 0, power: 0, blast: 0, chain: 0, greed: 0 },
      sound: true,
      totalWin: 0
    };
  }

  var S = fresh();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        var f = fresh();
        for (var k in f) if (!(k in o)) o[k] = f[k];
        for (var u in f.up) if (o.up[u] == null) o.up[u] = 0;
        S = o;
      }
    } catch (e) { S = fresh(); }
    // —— 合集统一金库迁移（一次性）——
    // 旧版：弹珠模式记在 S.coin、第二季记在 bounce.s2coin，两套账本分开。
    // 现在两套并入同一个合集钱包 bounce.coins，任何游戏赚的金币都进同一个池子。
    try {
      var legacy = (S.coin || 0);
      var s2 = parseInt(localStorage.getItem('bounce.s2coin') || '0', 10) || 0;
      if (legacy > 0 || s2 > 0) {
        B.U.addCoins(legacy + s2);
        S.coin = 0;
        localStorage.removeItem('bounce.s2coin');
        save();
      }
    } catch (e) { }
    return S;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 隐私模式下写不了，不影响玩 */ }
  }

  function reset() { S = fresh(); save(); }

  function data() { return S; }

  // 把升级换算成实际数值
  function stats() {
    var u = S.up;
    return {
      segs: 2 + u.sight,
      extraBalls: u.bag,
      dmg: 1 + u.power,
      boomR: 112 * (1 + 0.30 * u.blast),
      boomDmg: 2 + u.power,
      chain: u.chain >= 2 ? 4 : (u.chain >= 1 ? 5 : 6),
      greed: 1 + 0.30 * u.greed
    };
  }

  function upDef(id) {
    for (var i = 0; i < UPS.length; i++) if (UPS[i].id === id) return UPS[i];
    return null;
  }
  function level(id) { return S.up[id] || 0; }
  function costOf(id) {
    var d = upDef(id); if (!d) return Infinity;
    var l = S.up[id] || 0;
    return l >= d.max ? Infinity : d.cost[l];
  }
  function canBuy(id) {
    var c = costOf(id);
    return c !== Infinity && B.U.coins() >= c;
  }
  function buy(id) {
    if (!canBuy(id)) return false;
    B.U.spendCoins(costOf(id));
    S.up[id] = (S.up[id] || 0) + 1;
    save();
    return true;
  }

  function addCoin(n) { B.U.addCoins(n); }
  // 合集钱包快捷访问（首页 / HUD 直接用）
  function coins() { return B.U.coins(); }

  // 通关记录
  function win(n, stars, left, tries) {
    var old = S.cleared[n];
    if (!old || stars > old.stars) S.cleared[n] = { stars: stars, left: left, tries: tries };
    else if (left > old.left) old.left = left;
    if (n + 1 > S.maxLevel) S.maxLevel = n + 1;
    S.cur = n + 1;
    S.totalWin++;
    save();
  }
  function lose(n) {
    S.fail[n] = (S.fail[n] || 0) + 1;
    save();
  }
  function fails(n) { return S.fail[n] || 0; }
  // 同一关卡死三次以上，白送一颗球 —— 卡住不等于卡死
  function mercyBalls(n) {
    var f = S.fail[n] || 0;
    return f >= 6 ? 2 : (f >= 3 ? 1 : 0);
  }
  function clearedCount() { return Object.keys(S.cleared).length; }
  function isCleared(n) { return !!S.cleared[n]; }
  function starsOf(n) { return S.cleared[n] ? S.cleared[n].stars : 0; }

  // 过关给多少钱
  function reward(n, left, targets) {
    var st = stats();
    var base = 12 + n * 3;
    var v = base + left * 18 + targets * 8;
    return Math.round(v * st.greed);
  }

  function starsFor(left, total) {
    if (total <= 0) return 1;
    if (left >= Math.ceil(total * 0.5)) return 3;
    if (left >= 1) return 2;
    return 1;
  }

  function setSound(b) { S.sound = b; save(); }

  return {
    UPS: UPS, load: load, save: save, reset: reset, data: data, stats: stats,
    upDef: upDef, level: level, costOf: costOf, canBuy: canBuy, buy: buy,
    addCoin: addCoin, coins: coins, win: win, lose: lose, fails: fails, mercyBalls: mercyBalls,
    clearedCount: clearedCount, isCleared: isCleared, starsOf: starsOf,
    reward: reward, starsFor: starsFor, setSound: setSound
  };
})();

// 用真实物理代码跑的逻辑自测（直接加载 bounce/js 下的源文件）
// 用法：node bounce/tests/bounce_test.js  （在 bounce/ 目录下）
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.join(__dirname, '..', 'js');
const sandbox = {};
sandbox.window = sandbox;
sandbox.Math = Math;
sandbox.console = console;
sandbox.Date = Date;
sandbox.JSON = JSON;
sandbox.localStorage = undefined;
// 最小 DOM 桩：让 startSeason2 里对 phaseBanner 的访问不报错（真实浏览器里 document 自然存在）
sandbox.document = { getElementById: function () { return null; } };
vm.createContext(sandbox);

// 物理/生成 用到的核心模块（[6] 还要验证 100关后切到第二季，所以需要 game/season2/meta 等）
['util.js', 'board.js', 'physics.js', 'levelgen.js', 'fx.js', 'audio.js', 'meta.js', 'season2.js', 'game.js'].forEach(function (f) {
  const code = fs.readFileSync(path.join(DIR, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

const B = sandbox.B;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }
// 造一个有目标的空板（没有目标会因为 stopOnClear 立刻判清场，球不动）
function emptyBoard(portals) {
  const rows = Array(11).fill('.........');
  rows[0] = '........*'; // 目标放右上角，不挡竖直/横向主路径
  return B.Board.fromLevel({ rows: rows, portals: portals });
}

// ---------- 测试 1：2 门，出口方向 = to 指向门的 dir（不继承入射方向）----------
console.log('\n[1] 2 门：出口方向由 to 指向的门定义，不继承入射方向');
(function () {
  const b = emptyBoard([
    { c: 4, r: 8, gid: 0, dir: -Math.PI / 2, to: '6,3' },   // P0 下方门，直上可中；出口指到 P1
    { c: 6, r: 3, gid: 0, dir: Math.PI, to: '4,8' }          // P1 目的门，出口朝左 (π)
  ]);
  const s = B.Phys.run(b, -Math.PI / 2, { mutate: false, solve: true }); // 直上，走作者设定的 to
  const pe = s.events.find(function (e) { return e.t === 'portal'; });
  ok('一发能触发传送门（球真的动了）', !!pe, 'end=' + s.end + ' steps=' + s.steps);
  if (pe) {
    ok('从 P0(4,8) 出来落在 P1(6,3)', pe.toC === 6 && pe.toR === 3, JSON.stringify(pe));
    ok('出口方向 = P1 的 dir(π,左)，不是继承的 up', approx(pe.dir.x, -1) && approx(pe.dir.y, 0), JSON.stringify(pe.dir));
  }
  ok('出来后 vx<0（朝左），不是继续朝上', pe.dir.x < 0, 'dir.x=' + pe.dir.x);
  // 实证出口方向：球从 P1 出来后确有向左位移（用轨迹最小 x 判定，避免采样点不精确对齐传送点）
  var minX = s.pts.reduce(function (m, p) { return p.x < m ? p.x : m; }, 1e9);
  var movedLeft = minX < pe.x - 5;
  ok('传送后轨迹向左推进（实证出口方向）', movedLeft, 'minX=' + minX.toFixed(1) + ' pe.x=' + pe.x.toFixed(1));
})();

// ---------- 测试 2：N 门，to 构成确定性路由（N=3 举例）----------
console.log('\n[2] 多门：to 确定性路由（N=3 举例）');
(function () {
  const P0 = { c: 2, r: 2, gid: 0, dir: -Math.PI / 2, to: '2,8' };
  const P1 = { c: 2, r: 8, gid: 0, dir: 0, to: '6,5' };
  const P2 = { c: 6, r: 5, gid: 0, dir: Math.PI / 2, to: '2,2' };
  const b = emptyBoard([P0, P1, P2]);
  const list = [P0, P1, P2];
  const seen = {};
  let cur = P0, chain = [], allGood = true;
  for (let i = 0; i < list.length; i++) {
    const ex = B.Board.portalExit(b, cur.c, cur.r);
    const dest = list.find(p => p.c === ex.c && p.r === ex.r);
    chain.push(cur.c + ',' + cur.r + '->' + ex.c + ',' + ex.r);
    if (!dest) { allGood = false; break; }
    if (!approx(ex.dir.x, Math.cos(dest.dir)) || !approx(ex.dir.y, Math.sin(dest.dir))) allGood = false;
    seen[cur.c + ',' + cur.r] = true;
    cur = dest;
  }
  ok('to 链合法且覆盖所有门: ' + chain.join('  '), allGood && Object.keys(seen).length === list.length);
})();

// ---------- 测试 3：传送门根治死循环，每个门每发仅用一次 ----------
console.log('\n[3] 死循环根治：A↔B 不再来回穿梭，一发必然终止');
(function () {
  const rows = Array(11).fill('.........');
  rows[10] = '.......*.'; // 目标在 (8,10)，col4 竖直路径碰不到
  const b = B.Board.fromLevel({ rows: rows, portals: [
    { c: 4, r: 9, gid: 0, dir: 'up', to: '4,3' },
    { c: 4, r: 3, gid: 0, dir: 'down', to: '4,9' }
  ]});
  const s = B.Phys.run(b, -Math.PI / 2, { mutate: false, rng: B.U.rng(999) });
  ok('一发必然终止（不卡死/不靠护栏收尾）', s.end !== 'portalloop' && s.steps <= B.Phys.MAX_STEPS, 'steps=' + s.steps + ' end=' + s.end);
  ok('不再无限穿梭（不靠 portalloop 护栏收尾）', s.end !== 'portalloop', 'end=' + s.end);
  ok('用门次数 ≤ 门格子数(2)（证明入口标记生效）', (s.portalUses || 0) <= 2, 'uses=' + s.portalUses);
})();

// ---------- 测试 4：生成的带门关卡可解、不崩溃 ----------
console.log('\n[4] 生成器：带传送门关可解（求解器验证）');
(function () {
  [85, 90, 95, 110, 150].forEach(function (n) {
    const lv = B.Gen.level(n);
    const cnt = lv.portals ? lv.portals.length : 0;
    const rate = lv.rate;
    ok('第' + n + '关 有门(>=2):' + cnt + ' 可解率=' + (rate == null ? 'n/a' : rate.toFixed(2)), cnt >= 2 && rate > 0);
  });
})();

// ---------- 测试 5：引力场让轨迹弯曲，且预测=真实（确定性）----------
console.log('\n[5] 引力场：轨迹弯曲 + 预测与真实一致（确定性）');
(function () {
  B.Board.applyGeo(9, 11);   // 本测试基于 9×11 几何，先复位（生成器测试可能改过全局几何）
  const rows = Array(11).fill('.........');
  rows[0] = '........*'; // 目标右上，不挡竖直主路径
  const b = B.Board.fromLevel({ rows: rows, wells: [{ c: 2, r: 5, type: 'attract' }] });
  const lx = b.launchX;
  const s = B.Phys.run(b, -Math.PI / 2, { mutate: false });
  let maxDev = 0;
  for (let i = 0; i < s.pts.length; i++) maxDev = Math.max(maxDev, Math.abs(s.pts[i].x - lx));
  ok('有井时轨迹发生弯曲（横向偏移>15px）', maxDev > 15, 'maxDev=' + maxDev.toFixed(1));
  ok('一发能终止（不卡死/不无限绕）', s.steps < B.Phys.MAX_STEPS, 'steps=' + s.steps + ' end=' + s.end);
  const s2 = B.Phys.run(b, -Math.PI / 2, { mutate: false });
  let same = s.pts.length === s2.pts.length;
  for (let j = 0; same && j < s.pts.length; j++) if (s.pts[j].x !== s2.pts[j].x || s.pts[j].y !== s2.pts[j].y) same = false;
  ok('预测确定性：同输入两次轨迹完全一致', same);
})();

// ---------- 测试 6：弹珠关无引力场（纯净）；>100 不再耦合到第二季，第二季由 startSeason2() 显式进入 ----------
console.log('\n[6] 设计变更：弹珠关无引力场 + 第二季解耦（startSeason2 显式进入）');
(function () {
  [1, 50, 100, 101, 150, 220].forEach(function (n) {
    const p = B.Gen.paramsFor(n);
    ok('第' + n + '关 引力井数=0（已废弃引力场）', p.wells === 0, 'wells=' + p.wells);
  });
  // 旧耦合已拆除：load(>100) 不再偷偷切到第二季；弹珠上限 200，超过夹回 200
  const g = B.Game.load(101);
  ok('load(101) 仍是第一季弹珠（不再切 S2）', g.mode === 'marble', 'mode=' + g.mode);
  ok('load(101) 进入第 101 关（200 封顶，不再夹回 100）', g.n === 101, 'n=' + g.n);
  // 220 超过上限 → 夹回 200
  const g4 = B.Game.load(220);
  ok('load(220) 夹回第 200 关', g4.n === 200, 'n=' + g4.n);
  // 第二季改由 startSeason2() 显式进入（合集首个独立游戏）
  const g2 = B.Game.startSeason2();
  ok('startSeason2() 把模式切到 s2（第二季）', g2.mode === 's2', 'mode=' + g2.mode);
  const st = B.S2.state();
  ok('第二季模块已初始化（有状态、有障碍数组）', !!st && Array.isArray(st.obstacles), JSON.stringify(st && {x: st.x, score: st.score}));
  ok('第二季首帧无 JS 异常（update 可跑）', (function () {
    try { for (let i = 0; i < 5; i++) B.S2.update(0.1); return true; } catch (e) { console.log('   ! S2.update 抛错: ' + e); return false; }
  })());
  ok('第二季存活得分随时间增长（刷分机制活着）', B.S2.state().score > 0, 'score=' + (B.S2.state().score || 0));
  const g3 = B.Game.load(40);
  ok('load(40) 仍是第一季弹珠模式', g3.mode === 'marble', 'mode=' + g3.mode);
  ok('load(40) 能取到带目标的关卡', !!(g3.level && B.Board.countTargets(B.Board.fromLevel(g3.level)) > 0));
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

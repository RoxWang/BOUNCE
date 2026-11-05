// 证明：传送门改成"每发独立随机出口"后，预测线在门口截断、真实飞行永不卡死、求解器仍可验证可解性
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
sandbox.document = { getElementById: function () { return null; } };
vm.createContext(sandbox);

['util.js', 'board.js', 'physics.js', 'levelgen.js', 'fx.js', 'audio.js', 'meta.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
});

const B = sandbox.B;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

function boardWith(rows, portals) {
  const r = rows || Array(11).fill('.........');
  r[0] = '........*'; // 目标右上，不挡主路径
  return B.Board.fromLevel({ rows: r, portals: portals });
}

// ---------- 1. dirVec 支持数字弧度（不变）----------
console.log('\n[1] dirVec 支持任意角度（数字弧度）');
(function () {
  const d = B.Board.dirVec(0);
  ok('角度 0 → 朝右 (1,0)', approx(d.x, 1) && approx(d.y, 0), JSON.stringify(d));
  const a = 1.234;
  const da = B.Board.dirVec(a);
  ok('角度 a → (cos a, sin a)', approx(da.x, Math.cos(a)) && approx(da.y, Math.sin(a)), JSON.stringify(da));
  ok('旧方向名仍可用（兼容旧关卡）', approx(B.Board.dirVec('up').y, -1));
})();

// ---------- 2. fromLevel 不把角度 0 误判成 'up'，且保存作者设定的 to ----------
console.log('\n[2] fromLevel：dir:0 保真 + 保存 to 出口');
(function () {
  const b = boardWith(null, [
    { c: 4, r: 5, gid: 0, dir: 0, to: '1,2' },
    { c: 1, r: 2, gid: 0, dir: 1.0, to: '4,5' }
  ]);
  const cell = b.cells[5 * b.cols + 4];
  ok('dir=0 存进去仍是 0（不是 up）', cell.dir === 0, 'dir=' + cell.dir);
  ok('保存了 to 出口 key', cell.to === '1,2', 'to=' + cell.to);
  const ex = B.Board.portalExit(b, 4, 5); // 应出口到 (1,2)，方向 (cos1,sin1)
  ok('portalExit 走 to 指向的出口', !!ex && ex.c === 1 && ex.r === 2, JSON.stringify(ex));
  ok('出口速度方向 = to门的角度', ex && approx(ex.dir.x, Math.cos(1.0)) && approx(ex.dir.y, Math.sin(1.0)), JSON.stringify(ex && ex.dir));
})();

// ---------- 3. solve 路径（确定性）：出口按 to，绝不随机 ----------
console.log('\n[3] solve 路径：作者设定的出口（确定性）');
(function () {
  const angs = [0.21, 2.39, 4.36, 5.50];
  const portals = [
    { c: 4, r: 8, gid: 0, dir: angs[0], to: '1,2' },
    { c: 1, r: 2, gid: 0, dir: angs[1], to: '7,3' },
    { c: 7, r: 3, gid: 0, dir: angs[2], to: '4,4' },
    { c: 4, r: 4, gid: 0, dir: angs[3], to: '4,8' }
  ];
  const b = boardWith(null, portals);
  const s = B.Phys.run(b, -Math.PI / 2, { mutate: false, solve: true });
  ok('一发必然终止', s.end !== 'portalloop' && s.steps <= B.C.MAX_STEPS, 'end=' + s.end + ' steps=' + s.steps);
  ok('绝不成环（end 不是 portalloop）', s.end !== 'portalloop', 'end=' + s.end);
  ok('用门次数 ≤ 门格子数(4)', (s.portalUses || 0) <= 4, 'uses=' + s.portalUses);
  const pe = s.events.find(function (e) { return e.t === 'portal'; });
  if (pe) {
    ok('出口 = to 指向的 (1,2)', pe.toC === 1 && pe.toR === 2, JSON.stringify(pe));
    ok('出口速度方向 = to门角度的 (cos,sin)', approx(pe.dir.x, Math.cos(angs[1])) && approx(pe.dir.y, Math.sin(angs[1])), JSON.stringify(pe.dir));
  } else {
    ok('（直上未命中门，跳过方向校验）', true);
  }
})();

// ---------- 4. live 路径（随机）：出口是随机某一扇门，永不卡死 ----------
console.log('\n[4] live 路径：每发随机出口（混沌但安全）');
(function () {
  const angs = [0.21, 2.39, 4.36, 5.50];
  const portals = [
    { c: 4, r: 8, gid: 0, dir: angs[0], to: '1,2' },
    { c: 1, r: 2, gid: 0, dir: angs[1], to: '7,3' },
    { c: 7, r: 3, gid: 0, dir: angs[2], to: '4,4' },
    { c: 4, r: 4, gid: 0, dir: angs[3], to: '4,8' }
  ];
  const dirs = angs.map(function (a) { return { x: Math.cos(a), y: Math.sin(a) }; });
  const b = boardWith(null, portals);
  const s = B.Phys.run(b, -Math.PI / 2, { mutate: false, rng: B.U.rng(12345) });
  ok('一发必然终止（不卡死）', s.end !== 'portalloop' && s.steps <= B.C.MAX_STEPS, 'end=' + s.end + ' steps=' + s.steps);
  ok('绝不成环', s.end !== 'portalloop', 'end=' + s.end);
  ok('用门次数 ≤ 4', (s.portalUses || 0) <= 4, 'uses=' + s.portalUses);
  const pe = s.events.find(function (e) { return e.t === 'portal'; });
  ok('真有门被触发', !!pe, 'events=' + s.events.length);
  if (pe) {
    // 出口方向必须是四扇门中某一扇的 dir（混沌但落在一个真实门上）
    const hit = dirs.some(function (d) { return approx(d.x, pe.dir.x) && approx(d.y, pe.dir.y); });
    ok('出口方向等于某扇真实门的 dir', hit, JSON.stringify(pe.dir));
  }
})();

// ---------- 5. 预测线在传送门处截断 ----------
console.log('\n[5] 预测（preview）：虚线在门口截断，不泄露随机结果');
(function () {
  const portals = [
    { c: 4, r: 8, gid: 0, dir: 0.3, to: '1,2' },
    { c: 1, r: 2, gid: 0, dir: 1.0, to: '4,8' }
  ];
  const b = boardWith(null, portals);
  const s = B.Phys.run(b, -Math.PI / 2, { mutate: false, preview: true });
  ok('预测被截断（truncated=true）', s.truncated === true, 'end=' + s.end);
  ok('截断发生在进门之前（轨迹点远少于满程）', s.pts.length < 200, 'pts=' + s.pts.length);
})();

// ---------- 6. 生成器：80+ 带门、100+ 大地图且可解 ----------
console.log('\n[6] 生成器：分档带门 + 100+ 大地图可解');
(function () {
  [85, 95, 110, 150].forEach(function (n) {
    const lv = B.Gen.level(n);
    const cnt = lv.portals ? lv.portals.length : 0;
    const geo = B.Gen.geoFor(n);
    if (n <= 100) {
      ok('第' + n + '关 有>=2门', cnt >= 2, '门=' + cnt);
      ok('第' + n + '关 几何=默认9×11', lv.cols === 9 && lv.rows.length === 11, lv.cols + '×' + (lv.rows ? lv.rows.length : '?'));
    } else {
      ok('第' + n + '关 有>=4门（100+ 更多门）', cnt >= 4, '门=' + cnt);
      ok('第' + n + '关 几何变大=' + geo.cols + '×' + geo.rows, lv.cols === geo.cols && lv.rows.length === geo.rows, lv.cols + '×' + (lv.rows ? lv.rows.length : '?'));
    }
    ok('第' + n + '关 可解率>0', lv.rate > 0, 'rate=' + (lv.rate == null ? 'n/a' : lv.rate.toFixed(2)));
    const allTo = lv.portals.every(function (p) { return typeof p.to === 'string'; });
    ok('  第' + n + '关 所有门都带 to 出口', allTo);
  });
})();

// ---------- 7. 混沌抗压：50 个随机种子，live 永不死循环 ----------
console.log('\n[7] 混沌抗压：50 随机种子 × 4门，绝无 portalloop');
(function () {
  const angs = [0.21, 2.39, 4.36, 5.50];
  let bad = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const portals = [
      { c: 4, r: 8, gid: 0, dir: angs[0], to: '1,2' },
      { c: 1, r: 2, gid: 0, dir: angs[1], to: '7,3' },
      { c: 7, r: 3, gid: 0, dir: angs[2], to: '4,4' },
      { c: 4, r: 4, gid: 0, dir: angs[3], to: '4,8' }
    ];
    const b = boardWith(null, portals);
    const s = B.Phys.run(b, -Math.PI / 2, { mutate: false, rng: B.U.rng(seed * 7919) });
    if (s.end === 'portalloop' || s.steps > B.C.MAX_STEPS) bad++;
  }
  ok('50 个种子全部安全终止（无死循环）', bad === 0, 'bad=' + bad);
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

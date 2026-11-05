// 多球（连发 + 球间弹性碰撞）逻辑自测
// 直接加载真实物理代码，验证：① 两球对撞后沿法线互换速度（往相反方向弹开，符合物理）；
// ② runMulti 多球预测能跑出有限轨迹（预测=真实同一套步进）。
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

['util.js', 'board.js', 'physics.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
});

const B = sandbox.B;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-3; }
function finite(o) { return o && typeof o.x === 'number' && isFinite(o.x) && isFinite(o.y); }

// 空板（右上角放个目标，避免 stopOnClear 立刻收工），中间留大片空地给两球对撞
function emptyBoard() {
  const rows = Array(11).fill('.........');
  rows[0] = '........*';
  return B.Board.fromLevel({ rows: rows });
}

function makeShot(board, x, y, vx, vy) {
  const s = B.Phys.shot(board, 0, { mutate: true });
  s.x = x; s.y = y; s.vx = vx; s.vy = vy;
  s.stopOnClear = false; s.alive = true; s.tgtLeft = 1;
  s.pts = [{ x: x, y: y }]; s.segIdx = [0]; s.sample = 0;
  return s;
}

console.log('\n[1] 两球对撞：等质量弹性碰撞 = 沿法线互换速度（往相反方向弹开）');
(function () {
  const board = emptyBoard();
  const y = 62 + 5 * 76 + 38;          // 中间某一行，水平方向空旷
  const A = makeShot(board, 300, y, 300, 0);   // 向右
  const Bb = makeShot(board, 460, y, -300, 0); // 向左（正对 A）
  const before = { ax: A.vx, bx: Bb.vx };
  B.Phys.advanceMulti([A, Bb], 400);
  ok('A 原向右、撞后应向左（反向）', A.vx < 0, 'A.vx=' + A.vx.toFixed(1));
  ok('B 原向左、撞后应向右（反向）', Bb.vx > 0, 'B.vx=' + Bb.vx.toFixed(1));
  // 等质量弹性碰撞 = 沿法线交换速度：A 吃下 B 的初速、B 吃下 A 的初速（此处即反向）。
  // before.bx = Bb 初速(-300)，before.ax = A 初速(+300)。
  ok('速度交换（等质量弹性）：A 吃 B 的初速', approx(A.vx, before.bx),
    'A.vx=' + A.vx.toFixed(1) + ' 期望' + before.bx);
  ok('速度交换（等质量弹性）：B 吃 A 的初速', approx(Bb.vx, before.ax),
    'B.vx=' + Bb.vx.toFixed(1) + ' 期望' + before.ax);
  ok('动量守恒（撞前后总动量一致）', approx(A.vx + Bb.vx, before.ax + before.bx),
    '总动量 撞后=' + (A.vx + Bb.vx).toFixed(1) + ' 撞前=' + (before.ax + before.bx).toFixed(1));
  ok('撞后两球已分开（不再重叠）', (function () {
    const d = Math.hypot(Bb.x - A.x, Bb.y - A.y);
    return d >= 2 * 9 - 0.5;
  })(), 'dist=' + Math.hypot(Bb.x - A.x, Bb.y - A.y).toFixed(2));
})();

console.log('\n[2] runMulti 多球预测：返回有限轨迹（与真实同一套步进）');
(function () {
  const board = emptyBoard();
  // 在侧面放一颗"已在飞"的球，验证 runMulti 能把它一起模拟且不崩、轨迹有限
  const existing = makeShot(board, 600, 300, 80, 0);
  existing.tgtLeft = 1;
  const pred = B.Phys.runMulti(board, [existing], -Math.PI / 2, { preview: true, power: 1 });
  ok('runMulti 返回预测对象', !!pred);
  ok('预测轨迹点数 > 1', pred.pts && pred.pts.length > 1, 'pts=' + (pred.pts ? pred.pts.length : 'null'));
  ok('所有预测点均为有限坐标', pred.pts.every(finite));
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

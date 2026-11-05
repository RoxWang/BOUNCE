// 封闭框 + 寿命 + 连发共存 的针对性自测（直接加载 bounce/js 下的真实物理 / 游戏代码）
// 用法：node bounce/tests/box_test.js  （在 bounce/ 目录下）
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

['util.js', 'board.js', 'physics.js', 'levelgen.js', 'fx.js', 'audio.js', 'meta.js', 'season2.js', 'game.js'].forEach(function (f) {
  const code = fs.readFileSync(path.join(DIR, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

const B = sandbox.B;
const C = B.C;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}
// 球心是否始终在框内（含半径容差）
function inBox(s) {
  return s.x >= C.BX - 0.5 && s.x <= C.BX + C.BW + 0.5 && s.y >= C.BY - 0.5 && s.y <= C.BY + C.BH + 0.5;
}
// 框内底部中心出生点（与真实游戏默认标记一致）
function spawn(b) { return { x: (b.launchX != null ? b.launchX : (C.BX + C.BW / 2)), y: C.BY + C.BH - C.BALL_R - 2 }; }

console.log('\n[1] 封闭框：球进得去出不来（四面墙全反射）');
(function () {
  const rows = Array(11).fill('.........');
  const b = B.Board.fromLevel({ rows });
  let allInside = true, allLife = true;
  for (let a = 0; a < 24; a++) {
    const ang = -Math.PI + a * (2 * Math.PI / 24);
    const s = B.Phys.shot(b, ang, { mutate: false, spawn: spawn(b) });
    let inside = true;
    for (let i = 0; i < 5000 && s.alive; i++) {
      B.Phys.step(s);
      if (!inBox(s)) { inside = false; break; }
    }
    if (!inside) allInside = false;
    if (s.end !== 'life') allLife = false;
  }
  ok('24 个方向发射，球心始终在框内（四边全封）', allInside);
  ok('寿命到点后球消失（end=life，而非越界逃出）', allLife);
})();

console.log('\n[2] 寿命双阈值：时间(steps)或反弹次数先到 → end=life');
(function () {
  // 空板：球只会撞墙，反弹次数增长快；时间也长。两种情况都应 end=life
  const rows = Array(11).fill('.........');
  const b = B.Board.fromLevel({ rows });
  const s = B.Phys.shot(b, -Math.PI / 2, { mutate: false, spawn: spawn(b) });
  for (let i = 0; i < 6000 && s.alive; i++) B.Phys.step(s);
  ok('空板狂弹后球必然消失', !s.alive, 'end=' + s.end + ' steps=' + s.steps);
  ok('消失原因是寿命（end=life，不是 timeout）', s.end === 'life', 'end=' + s.end);
  ok('寿命先触发（steps < MAX_STEPS，不会退化成 timeout）', s.steps < C.MAX_STEPS, 'steps=' + s.steps + ' MAX=' + C.MAX_STEPS);
})();

console.log('\n[3] 连发：第一颗在飞时可射第二颗，两球共存且都在框内');
(function () {
  const g = B.Game.load(10);
  const G = B.Game.g;
  // 第一颗：标记放底部中心
  B.Game.aimStart(C.BX + C.BW / 2, C.BY + C.BH - 20);
  B.Game.aimEnd();
  const afterFirst = G.shots.length;
  // 第二颗：飞行途中在另一位置再放标记（连发）
  B.Game.aimStart(C.BX + C.BW / 2 - 60, C.BY + C.BH * 0.6);
  B.Game.aimEnd();
  const afterSecond = G.shots.length;
  ok('连发：第一颗在飞时可射第二颗（2 球共存）', afterFirst === 1 && afterSecond === 2, 'first=' + afterFirst + ' second=' + afterSecond);

  // 推进若干帧，两球都应仍在框内（封闭框）
  for (let i = 0; i < 60; i++) B.Game.update(1 / 60);
  const shots = G.shots;
  let bothInside = shots.length > 0;
  for (let k = 0; k < shots.length; k++) {
    const bb = shots[k].s;
    if (!(bb.x >= C.BX - 0.5 && bb.x <= C.BX + C.BW + 0.5 && bb.y >= C.BY - 0.5 && bb.y <= C.BY + C.BH + 0.5)) bothInside = false;
  }
  ok('两球推进 60 帧后都在框内（没逃出封闭框）', bothInside, 'alive=' + shots.length);
})();

console.log('\n[4] 标记点：点击落在砖里时会被螺旋挪到最近空格中心');
(function () {
  const rows = Array(11).fill('.........');
  rows[5] = '....#....';  // 第 5 行中间放一块砖
  const b = B.Board.fromLevel({ rows });
  // 直接用物理的 clampMarker 等价判断：把出生点放到砖格中心，应被推到旁边空格
  const g = B.Game.load(10);
  const G = B.Game.g;
  G.board = b;
  // 模拟：点击位置恰好落在砖格中心
  const cc = B.Board.ccx(4), cr = B.Board.ccy(5);
  B.Game.aimStart(cc, cr);
  const m = G.marker;
  const mc = B.Board.colAt(m.x), mr = B.Board.rowAt(m.y);
  ok('点击落在砖里 → 标记被挪到空格中心（不在砖上）', !B.Board.get(b, mc, mr), 'marker=(' + mc + ',' + mr + ')');
})();

console.log('\n[5] 任意方向：台球式 360° 发射（不再被旧 clampAngle 夹成"只能朝上"）');
(function () {
  B.Board.applyGeo(9, 11);
  const G = B.Game.load(10);
  // 空板：避免标记被 clampMarker 挪走，方向测量才干净
  const rows = Array(11).fill('.........');
  rows[0] = '........*';
  G.board = B.Board.fromLevel({ rows });
  G.state = 'aim'; G.aiming = true; G.balls = 9;
  const mx = C.BX + C.BW / 2, my = C.BY + C.BH / 2 + 60;
  B.Game.aimStart(mx, my);
  const marker = G.marker;
  B.Game.aimMove(marker.x, marker.y + 120);
  ok('朝下拖 → 方向朝下（sin>0.9）', Math.sin(G.aimAngle) > 0.9, 'angle=' + G.aimAngle.toFixed(3));
  B.Game.aimMove(marker.x + 120, marker.y);
  ok('朝右拖 → 方向朝右（cos>0.9）', Math.cos(G.aimAngle) > 0.9, 'angle=' + G.aimAngle.toFixed(3));
  B.Game.aimMove(marker.x - 120, marker.y);
  ok('朝左拖 → 方向朝左（cos<-0.9）', Math.cos(G.aimAngle) < -0.9, 'angle=' + G.aimAngle.toFixed(3));
  B.Game.aimMove(marker.x, marker.y - 120);
  ok('朝上拖 → 方向朝上（sin<-0.9）', Math.sin(G.aimAngle) < -0.9, 'angle=' + G.aimAngle.toFixed(3));
  // 真的按朝上方向发射，球仍被关在框里
  B.Game.aimEnd();
  let inside = true;
  for (let i = 0; i < 60; i++) {
    B.Game.update(1 / 60);
    for (let k = 0; k < G.shots.length; k++) {
      const s = G.shots[k].s;
      if (s.x < C.BX - 0.5 || s.x > C.BX + C.BW + 0.5 || s.y < C.BY - 0.5 || s.y > C.BY + C.BH + 0.5) inside = false;
    }
  }
  ok('任意方向发射后球仍不越界（封闭框）', inside);
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

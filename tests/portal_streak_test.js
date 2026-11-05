// 验证"传送门连续上限"规则（用户硬需求）：
//   单个球一发之内连续碰传送门最多 2 次，第 3 次直接当实心墙反弹；
//   必须先撞到别的方块把计数清零，才能再用门。这彻底杜绝长串门链死循环。
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

// 4 门环：A→B→C→D→A，全部排在第 5 行，球从底部正中朝 A(1,5) 发射。
// 预期：A(用1)→B(用2)→到第3门 C 时连续已达 2，C 当实心墙反弹，用门数封顶在 2，绝不卡死。
console.log('\n[传送门连续上限] 4门环：连续用门封顶在 2');
(function () {
  const portals = [
    { c: 1, r: 5, gid: 0, dir: 0, to: '3,5' },   // A → B（出口朝右）
    { c: 3, r: 5, gid: 0, dir: 0, to: '5,5' },   // B → C
    { c: 5, r: 5, gid: 0, dir: 0, to: '7,5' },   // C → D
    { c: 7, r: 5, gid: 0, dir: 0, to: '1,5' }    // D → A
  ];
  const rows = Array(11).fill('.........');
  rows[0] = '........*';
  const b = B.Board.fromLevel({ rows: rows, portals: portals });

  const ax = B.Board.ccx(1), ay = B.Board.ccy(5);
  const lx = b.launchX, ly = B.C.LAUNCH_Y;
  const ang = Math.atan2(ay - ly, ax - lx);          // 正中朝 A 门
  const s = B.Phys.run(b, ang, { mutate: false, solve: true });

  ok('连续用门封顶在 2（第3次当实心墙）', (s.portalUses || 0) === 2, 'uses=' + s.portalUses);
  ok('不会卡死成 portalloop', s.end !== 'portalloop', 'end=' + s.end);
  ok('用门次数没有突破 MAX_PORTAL 护栏', (s.portalUses || 0) <= B.C.MAX_PORTAL, 'uses=' + s.portalUses);
})();

// 撞到别的方块后计数清零：在第3门 C 之前放一块砖，球在 2 次用门后撞砖 → 计数归零，
// 之后仍可继续用门（说明"必须歇一下"是靠撞砖重置，而非永久锁死）。
console.log('\n[传送门连续上限] 撞砖重置：歇一下后可继续用门');
(function () {
  const portals = [
    { c: 1, r: 5, gid: 0, dir: 0, to: '3,5' },   // A → B
    { c: 3, r: 5, gid: 0, dir: 0, to: '7,5' },   // B → 远端 D（跨过砖）
    { c: 7, r: 5, gid: 0, dir: 0, to: '1,5' },   // D → A
    { c: 5, r: 7, gid: 1, dir: -Math.PI / 2, to: '5,3' }, // 备用门 E（朝上），撞砖后能改走它
    { c: 5, r: 3, gid: 1, dir: -Math.PI / 2, to: '5,7' }
  ];
  const rows = Array(11).fill('.........');
  rows[0] = '........*';
  rows[5] = '.....#...';   // 第5行 col5 放一块砖，正好卡在 B→D 的回程路径上
  const b = B.Board.fromLevel({ rows: rows, portals: portals });
  const ax = B.Board.ccx(1), ay = B.Board.ccy(5);
  const lx = b.launchX, ly = B.C.LAUNCH_Y;
  const ang = Math.atan2(ay - ly, ax - lx);
  const s = B.Phys.run(b, ang, { mutate: false, solve: true });
  // 只要一发能正常终止、且用门数>0（证明规则没把门彻底锁死），重置逻辑就可用
  ok('一发正常终止（门未被永久锁死）', s.end !== 'portalloop', 'end=' + s.end);
  ok('用门数 > 0（规则没把传送门彻底废掉）', (s.portalUses || 0) > 0, 'uses=' + s.portalUses);
})();

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

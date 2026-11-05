// headless_check.js —— 一次性无头校验：S2 实战信标 + 商店 DOM 渲染
// 单进程内完成：起静态服务 + 信标接收 + 拉起 Chrome（真实时间，不带 virtual-time-budget，避免 renderer 被掐）
var http = require('http');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var PORT = 8099;
var CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

var MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
var beacons = [];

var server = http.createServer(function (req, res) {
  var u = req.url.split('?')[0];
  if (u === '/b') {
    var d = require('url').parse(req.url, true).query.d || '';
    beacons.push(decodeURIComponent(d));
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return;
  }
  var f = path.join(ROOT, decodeURIComponent(u));
  fs.readFile(f, function (e, buf) {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    var ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
});

function runChrome(args, capture, cb) {
  var ch = cp.spawn(CHROME, ['--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'].concat(args), { stdio: ['ignore', 'pipe', 'pipe'] });
  var out = '', err = '';
  ch.stdout.on('data', function (d) { out += d; });
  ch.stderr.on('data', function (d) { err += d; });
  ch.on('close', function () { cb(out, err); });
  if (capture && capture.killAfter) {
    setTimeout(function () { try { ch.kill('SIGKILL'); } catch (e) { } }, capture.killAfter);
  }
  return ch;
}

server.listen(PORT, function () {
  var base = 'http://127.0.0.1:' + PORT + '/index.html';

  // 1) S2 实战：?sims2=N 同步跑 N 帧（复刻 frame 的 update+render），结果写进 document.title，用 --dump-dom 抓取
  var s2url = base + '?sims2=900';
  runChrome(['--dump-dom', s2url], null, function (out, err) {
    var m = /<title>([^<]*)<\/title>/.exec(out);
    var title = m ? m[1] : '(无 title)';
    console.log('--- S2 实战（virtual-time + dump-dom 抓 title）---');
    console.log('document.title =', title);
    var sm = /S2 mode=(\w+) score=(\d+) lives=(\d+) coins=(\d+) shield=(\d+) dead=(\w+) reachBad=(\d+)/.exec(title);
    if (sm) {
      console.log('解析: 进入第二季=是 最高分=' + sm[2] + ' 末态命=' + sm[3] + ' 金币=' + sm[4] + ' 护盾=' + sm[5] + ' 死局次数=' + sm[7]);
    } else {
      console.log('!! 未进入第二季（title 无 S2 记录，可能 mode 没切到 s2 或定时器没跑）');
    }

    // 1.5) 弹珠 100+ 关同步自检：?marbletest=150 进第150关（14×16 + 12门），dump-dom 抓 title
    runChrome(['--dump-dom', base + '?marbletest=150'], null, function (mout, merr) {
      var mm = /<title>([^<]*)<\/title>/.exec(mout);
      var mtitle = mm ? mm[1] : '(无 title)';
      console.log('--- 弹珠 100+ 关自检（marbletest=150）---');
      console.log('document.title =', mtitle);
      var bm = /MARBLE n=(\d+) mode=(\w+) cols=(\d+) rows=(\d+) targets=(\d+) portals=(\d+) ok=1/.exec(mtitle);
      if (bm) {
        console.log('解析: 进第' + bm[1] + '关 模式=' + bm[2] + ' 几何=' + bm[3] + '×' + bm[4] + ' 目标=' + bm[5] + ' 门=' + bm[6] + ' 建关+渲染无报错 ✅');
      } else if (/MERR/.test(mtitle)) {
        console.log('!! 弹珠 100+ 关出错：' + mtitle);
      } else {
        console.log('!! 未拿到 MARBLE 自检结果（title=' + mtitle + '）');
      }

      // 1.6) 多球（连发 + 球间弹性碰撞）真实游戏路径自检：?multiballtest=1
      runChrome(['--dump-dom', base + '?multiballtest=1'], null, function (mbout, mberr) {
        var mbm = /<title>([^<]*)<\/title>/.exec(mbout);
        var mbTitle = mbm ? mbm[1] : '(无 title)';
        console.log('--- 多球连发自检（multiballtest=1）---');
        console.log('document.title =', mbTitle);
        var ib = /MB s1=(\d+) st1=(\w+) s2=(\d+) st2=(\w+) afterUpdShots=(\d+) pred=(\w+) collOk=(\w+)(?: ok=1)?/.exec(mbTitle);
        if (/MBERR|CRASH|PREDIERR/.test(mbTitle)) {
          console.log('!! 多球自检出错：' + mbTitle);
        } else if (ib) {
          console.log('解析: 首发射后球=' + ib[1] + ' 状态=' + ib[2] + ' | 连发后球=' + ib[3] + ' 状态=' + ib[4] +
            ' | 推进后场上球=' + ib[5] + ' | runMulti预测=' + ib[6] + ' | 头对头碰撞交换速度=' + ib[7]);
          if (ib[1] === '1' && ib[3] === '2' && ib[6] === 'true' && ib[7] === 'true') {
            console.log('✅ 连发（首颗未出框即可射第二颗）+ 球间弹性碰撞 在浏览器真实链路通过');
          } else {
            console.log('!! 多球行为不符预期（应 s1=1 s2=2 pred=true collOk=true）');
          }
        } else {
          console.log('!! 未拿到多球自检结果（title=' + mbTitle + '）');
        }
      });

      // 2) 商店 DOM：?screen=screenS2Shop，dump-dom 数 .up 行数 + 强化名
      runChrome(['--dump-dom', base + '?screen=screenS2Shop'], null, function (dom, err2) {
      var upRows = (dom.match(/class="up"/g) || []).length;
      var names = (dom.match(/(生命|护盾|缓速|巨球)/g) || []);
      var errShown = dom.indexOf('运行出错') >= 0;
      console.log('--- 商店 DOM ---');
      console.log('.up 行数=' + upRows + '（应为 4） 强化名命中=' + JSON.stringify(names) + ' 页面报错覆盖层=' + errShown);

      // 3) 合集首页 DOM：?screen=screenHub，应渲染出游戏卡片（由 B.Games 注册表驱动）
      runChrome(['--dump-dom', base + '?screen=screenHub'], null, function (hub, err3) {
        var cards = (hub.match(/class="gcard"/g) || []).length;
        var names2 = (hub.match(/(弹珠模式|无尽冲刺)/g) || []);
        var err3Shown = hub.indexOf('运行出错') >= 0;
        console.log('--- 合集首页 DOM ---');
        console.log('游戏卡片数=' + cards + '（应为 2） 游戏名命中=' + JSON.stringify(names2) + ' 页面报错覆盖层=' + err3Shown);

        // 4) 封闭框自检：?boxtest=1 同步驱动真实游戏链路，验证球进得去出不来 + 连发共存 + 寿命到顶消失
        runChrome(['--dump-dom', base + '?boxtest=1'], null, function (bout, berr) {
          var bmt = /<title>([^<]*)<\/title>/.exec(bout);
          var bt = bmt ? bmt[1] : '(无 title)';
          console.log('--- 封闭框自检（boxtest=1）---');
          console.log('document.title =', bt);
          if (/BOXERR|FAIL/.test(bt)) {
            console.log('!! 封闭框自检出错：' + bt);
          } else if (/BOX b1=1 b2=2 escaped=0 updErr=0 lifeEnd=life ok=1/.test(bt)) {
            console.log('✅ 封闭框机制在浏览器真实链路通过：连发2球共存、全程不越界、寿命到顶 end=life');
          } else {
            console.log('!! 封闭框自检结果异常：' + bt);
          }
          server.close();
          process.exit(0);
        });
      });
    });
    });
  });
});

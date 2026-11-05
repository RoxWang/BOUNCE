// fx.js —— 粒子、震屏、顿帧、慢镜、飘字
// 这些东西不参与胜负，但它们决定"打上去爽不爽"。命中那一下的 40 毫秒顿帧是全游戏最重要的手感。
var B = window.B = window.B || {};

B.FX = (function () {
  var U = B.U;

  var parts = [];   // 粒子
  var texts = [];   // 飘字
  var rings = [];   // 冲击环
  var MAXP = 900;

  var shakeT = 0, shakeAmp = 0;
  var hitstop = 0;   // 顿帧剩余时间（秒）
  var slowT = 0;     // 慢镜剩余时间
  var flash = 0;     // 全屏闪白

  function reset() {
    parts.length = 0; texts.length = 0; rings.length = 0;
    shakeT = 0; shakeAmp = 0; hitstop = 0; slowT = 0; flash = 0;
  }

  function shake(amp, dur) {
    shakeAmp = Math.max(shakeAmp, amp);
    shakeT = Math.max(shakeT, dur || 0.16);
  }
  function stop(t) { hitstop = Math.max(hitstop, t); }        // 顿帧：命中时"卡"一下
  function slow(t) { slowT = Math.max(slowT, t); }            // 慢镜：收尾用
  function flashOn(a) { flash = Math.max(flash, a); }

  function push(p) { if (parts.length < MAXP) parts.push(p); }

  // 命中火花
  function spark(x, y, color, n, spd) {
    n = n || 8; spd = spd || 220;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = spd * (0.35 + Math.random() * 0.85);
      push({
        t: 'spark', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0.22 + Math.random() * 0.22, max: 0.44, r: 1.4 + Math.random() * 2.2, c: color
      });
    }
  }

  // 砖块碎片（带旋转的小方块，比圆点有"碎"的感觉）
  function shard(x, y, color, n) {
    n = n || 10;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = 130 + Math.random() * 260;
      push({
        t: 'shard', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: 0.45 + Math.random() * 0.4, max: 0.85,
        r: 3 + Math.random() * 4.5, c: color,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14
      });
    }
  }

  function ring(x, y, r0, r1, color, dur, wide) {
    rings.push({ x: x, y: y, r0: r0, r1: r1, c: color, t: 0, dur: dur || 0.4, w: wide || 3 });
  }

  function text(x, y, str, color, size) {
    texts.push({ x: x, y: y, s: str, c: color || '#fff', t: 0, dur: 0.85, sz: size || 20 });
  }

  // dt 是"游戏时间"（已经过顿帧/慢镜缩放）
  function update(dt, rawDt) {
    // 顿帧和慢镜用真实时间倒计时，不然会自己把自己冻住
    if (hitstop > 0) hitstop -= rawDt;
    if (slowT > 0) slowT -= rawDt;

    var i, p;
    for (i = parts.length - 1; i >= 0; i--) {
      p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t === 'shard') { p.vy += 900 * dt; p.rot += p.vr * dt; }
      else { p.vx *= (1 - 3.2 * dt); p.vy *= (1 - 3.2 * dt); }
    }
    for (i = texts.length - 1; i >= 0; i--) {
      var tx = texts[i];
      tx.t += dt;
      tx.y -= 42 * dt;
      if (tx.t >= tx.dur) texts.splice(i, 1);
    }
    for (i = rings.length - 1; i >= 0; i--) {
      var rg = rings[i];
      rg.t += dt;
      if (rg.t >= rg.dur) rings.splice(i, 1);
    }
    if (shakeT > 0) { shakeT -= rawDt; if (shakeT <= 0) shakeAmp = 0; }
    if (flash > 0) flash = Math.max(0, flash - rawDt * 3.2);
  }

  function timeScale() {
    if (hitstop > 0) return 0;      // 完全冻住：这就是"打击感"
    if (slowT > 0) return 0.32;
    return 1;
  }

  function shakeXY() {
    if (shakeT <= 0) return { x: 0, y: 0 };
    var k = shakeAmp * (shakeT > 0 ? shakeT / 0.16 : 0);
    return { x: (Math.random() - 0.5) * 2 * k, y: (Math.random() - 0.5) * 2 * k };
  }

  function draw(ctx) {
    var i, p, a;
    // 冲击环
    for (i = 0; i < rings.length; i++) {
      var rg = rings[i], k = rg.t / rg.dur;
      var r = U.lerp(rg.r0, rg.r1, U.easeOut(k));
      var al = 1 - k;
      ctx.save();
      ctx.globalAlpha = al * 0.9;
      ctx.strokeStyle = rg.c; ctx.lineWidth = rg.w * (1 - k * 0.6);
      ctx.beginPath(); ctx.arc(rg.x, rg.y, r, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
    // 粒子
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      a = Math.min(1, p.life / (p.max * 0.55));
      ctx.save();
      ctx.globalAlpha = a;
      if (p.t === 'shard') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r);
      } else {
        ctx.fillStyle = p.c;
        ctx.shadowColor = p.c; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
    // 飘字
    for (i = 0; i < texts.length; i++) {
      var tx = texts[i], k2 = tx.t / tx.dur;
      ctx.save();
      ctx.globalAlpha = k2 < 0.15 ? k2 / 0.15 : (1 - Math.pow(k2, 3));
      ctx.fillStyle = tx.c;
      ctx.font = '900 ' + tx.sz + 'px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 8;
      ctx.fillText(tx.s, tx.x, tx.y);
      ctx.restore();
    }
  }

  function drawFlash(ctx, w, h) {
    if (flash <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(0.7, flash);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  var FONT = '"PingFang SC","Noto Sans SC","Microsoft YaHei",-apple-system,sans-serif';

  return {
    reset: reset, update: update, draw: draw, drawFlash: drawFlash,
    spark: spark, shard: shard, ring: ring, text: text,
    shake: shake, stop: stop, slow: slow, flash: flashOn,
    timeScale: timeScale, shakeXY: shakeXY,
    count: function () { return parts.length; }
  };
})();

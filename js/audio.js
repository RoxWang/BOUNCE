// audio.js —— 全部音效用 WebAudio 实时合成，零素材文件
var B = window.B = window.B || {};

B.A = (function () {
  var ctx = null, master = null, on = true, ready = false;

  function init() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      ready = true;
    } catch (e) { ctx = null; }
  }

  // 浏览器要求用户交互后才能出声
  function unlock() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function enabled() { return on && ready && ctx; }
  function toggle() { on = !on; return on; }
  function isOn() { return on; }

  function now() { return ctx.currentTime; }

  // 一个最简单的"振荡器 + 音量包络"
  function tone(opt) {
    if (!enabled()) return;
    var t0 = now() + (opt.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opt.type || 'square';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.f1), t0 + opt.dur);
    var v = opt.vol == null ? 0.16 : opt.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + Math.min(0.012, opt.dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + opt.dur + 0.02);
  }

  // 噪声（爆炸、碎裂用）
  var noiseBuf = null;
  function noise(opt) {
    if (!enabled()) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t0 = now() + (opt.delay || 0);
    var src = ctx.createBufferSource(); src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = opt.filter || 'lowpass';
    f.frequency.setValueAtTime(opt.f0 || 1200, t0);
    if (opt.f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(60, opt.f1), t0 + opt.dur);
    var g = ctx.createGain();
    var v = opt.vol == null ? 0.2 : opt.vol;
    g.gain.setValueAtTime(v, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + opt.dur + 0.02);
  }

  var SFX = {
    // 发射：短促上滑
    launch: function () { tone({ type: 'triangle', f0: 220, f1: 700, dur: 0.11, vol: 0.14 }); },
    // 撞墙/钢块：很轻的一声 tick
    wall: function () { tone({ type: 'sine', f0: 380, f1: 300, dur: 0.045, vol: 0.055 }); },
    // 命中砖块：音高随连击往上爬（这是"连击"能被听见的关键）
    hit: function (combo) {
      var semi = Math.min(combo, 24);            // 最多爬两个八度
      var f = 300 * Math.pow(2, semi / 12);
      tone({ type: 'square', f0: f, f1: f * 1.25, dur: 0.07, vol: 0.1 });
    },
    // 砖碎：噪声 + 下滑
    brk: function () {
      noise({ f0: 2600, f1: 400, dur: 0.16, vol: 0.16 });
      tone({ type: 'triangle', f0: 520, f1: 160, dur: 0.13, vol: 0.09 });
    },
    // 目标砖碎：亮一点，双音
    tgt: function () {
      tone({ type: 'square', f0: 880, f1: 1320, dur: 0.1, vol: 0.13 });
      tone({ type: 'sine', f0: 1760, dur: 0.22, vol: 0.1, delay: 0.05 });
    },
    // 爆炸
    boom: function () {
      noise({ f0: 900, f1: 60, dur: 0.42, vol: 0.34 });
      tone({ type: 'sine', f0: 130, f1: 40, dur: 0.36, vol: 0.2 });
    },
    // 传送门
    portal: function () { tone({ type: 'sine', f0: 500, f1: 1400, dur: 0.14, vol: 0.1 }); },
    // 拾取 +1 球
    plus: function () {
      tone({ type: 'triangle', f0: 700, dur: 0.08, vol: 0.12 });
      tone({ type: 'triangle', f0: 1050, dur: 0.1, vol: 0.1, delay: 0.06 });
    },
    // 金币砖：亮晶晶的双高音
    coin: function () {
      tone({ type: 'sine', f0: 1319, dur: 0.09, vol: 0.11 });
      tone({ type: 'sine', f0: 1760, dur: 0.14, vol: 0.1, delay: 0.06 });
    },
    // 弹板：有弹性的"boing"
    bumper: function () {
      tone({ type: 'triangle', f0: 180, f1: 520, dur: 0.12, vol: 0.13 });
    },
    // 球落底回收
    back: function () { tone({ type: 'sine', f0: 300, f1: 200, dur: 0.09, vol: 0.07 }); },
    // 过关：上行琶音
    win: function () {
      var s = [523, 659, 784, 1047];
      for (var i = 0; i < s.length; i++) {
        tone({ type: 'triangle', f0: s[i], dur: 0.3, vol: 0.14, delay: i * 0.09 });
      }
    },
    // 绝杀（最后一球清场）：更长的胜利和弦
    clutch: function () {
      var s = [392, 523, 659, 784, 1047, 1319];
      for (var i = 0; i < s.length; i++) {
        tone({ type: 'triangle', f0: s[i], dur: 0.45, vol: 0.13, delay: i * 0.07 });
      }
      tone({ type: 'sine', f0: 2093, dur: 0.8, vol: 0.1, delay: 0.45 });
    },
    // 失败：下行两音
    lose: function () {
      tone({ type: 'sawtooth', f0: 330, f1: 250, dur: 0.22, vol: 0.12 });
      tone({ type: 'sawtooth', f0: 220, f1: 110, dur: 0.4, vol: 0.12, delay: 0.16 });
    },
    // 买升级
    buy: function () {
      tone({ type: 'square', f0: 660, dur: 0.07, vol: 0.12 });
      tone({ type: 'square', f0: 990, dur: 0.12, vol: 0.11, delay: 0.07 });
    },
    // UI 点击
    click: function () { tone({ type: 'sine', f0: 620, f1: 820, dur: 0.05, vol: 0.07 }); }
  };

  function play(name, arg) {
    if (!enabled()) return;
    var f = SFX[name];
    if (f) { try { f(arg); } catch (e) { /* 音频失败绝不影响游戏 */ } }
  }

  return { init: init, unlock: unlock, play: play, toggle: toggle, isOn: isOn,
    ctx: function () { return ctx; }, master: function () { return master; }, ready: function () { return ready; } };
})();

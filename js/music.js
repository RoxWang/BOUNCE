// music.js —— 无尽冲刺的程序化背景音乐（驱动感律动，零素材文件）
// 思路：用 WebAudio 实时合成一段循环（四踩底鼓 + 低音贝斯 + 快速琶音 + 轻踩镲），
// 不依赖任何音频文件 → 整个游戏仍是纯前端、断网可玩、部署即在线可听。
// 复用 B.A 的 AudioContext / master（已处理"用户手势后才能出声"），不另开上下文。
var B = window.B = window.B || {};

B.Music = (function () {
  var Ctx = null, master = null, bus = null;     // bus = 音乐总音量（静音用）
  var timer = null, step = 0, nextTime = 0;
  var BPM = 128, SPB = 0;                        // 每拍秒数；16 分音符 = SPB/4
  var muted = false, running = false;
  try { muted = localStorage.getItem('bounce.s2musicMute') === '1'; } catch (e) { }

  // 简单音名 → 频率（A 小调氛围）：A2 低音做贝斯根音，上面叠五声音阶琶音
  function f(n) { return 440 * Math.pow(2, (n - 69) / 12); }   // n = MIDI 音高
  // 4 小节（64 个 16 分）的贝斯根音（MIDI）：A2,F2,G2,A2 → 行进感
  var BASS = [45, 45, 41, 43];                   // 每小节一个根音，循环
  // 五声音阶（A 小调）上的琶音音级（相对根音的半音偏移），制造"跑动"的明亮感
  var ARP = [0, 3, 5, 7, 12, 7, 5, 3, 0, 3, 7, 10, 12, 10, 7, 5];

  function ensure() {
    B.A.unlock();
    Ctx = B.A.ctx(); master = B.A.master();
    if (!Ctx || !master) return false;
    if (!bus) {
      bus = Ctx.createGain();
      bus.gain.value = muted ? 0 : 0.5;
      bus.connect(master);
    }
    SPB = 60 / BPM;
    return true;
  }

  // ---- 单个乐器音色（都是"振荡器 + 包络"，短促有打击感）----
  function kick(t) {
    var o = Ctx.createOscillator(), g = Ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.18);
  }
  function hat(t) {
    var len = Math.floor(Ctx.sampleRate * 0.03), buf = Ctx.createBuffer(1, len, Ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var s = Ctx.createBufferSource(); s.buffer = buf;
    var hp = Ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    var g = Ctx.createGain(); g.gain.value = 0.06;
    s.connect(hp); hp.connect(g); g.connect(bus); s.start(t); s.stop(t + 0.04);
  }
  function bass(t, midi) {
    var o = Ctx.createOscillator(), g = Ctx.createGain(), lp = Ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f(midi);
    lp.type = 'lowpass'; lp.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.24);
  }
  function arp(t, midi) {
    var o = Ctx.createOscillator(), g = Ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.16);
  }

  // 前瞻调度（WebAudio 标准做法：定时器只负责"提前排音符"，实际发声由 ctx 时钟精准控制）
  function scheduleStep(s, t) {
    var inBar = Math.floor(s / 16) % 4;          // 第几小节 → 贝斯根音
    var root = BASS[inBar];
    if (s % 4 === 0) kick(t);                     // 四踩底鼓
    if (s % 4 === 2) hat(t);                      // 反拍踩镲
    if (s % 4 === 0) bass(t, root);               // 每拍贝斯
    if (s % 2 === 0) arp(t, root + 12 + ARP[s % 16]); // 每 8 分一个琶音，明亮跑动
  }

  function tick() {
    if (!running) return;
    var ahead = 0.12;
    while (nextTime < Ctx.currentTime + ahead) {
      scheduleStep(step, nextTime);
      nextTime += SPB / 4;                        // 前进一个 16 分音符
      step = (step + 1) % 64;
    }
  }

  function start() {
    if (running) return;
    if (!ensure()) return;                        // 没解锁就拿不到 ctx，等下次手势
    running = true; step = 0; nextTime = Ctx.currentTime + 0.06;
    timer = setInterval(tick, 25);
  }
  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('bounce.s2musicMute', muted ? '1' : '0'); } catch (e) { }
    if (bus) bus.gain.value = muted ? 0 : 0.5;
  }
  function toggleMute() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  return { start: start, stop: stop, setMuted: setMuted, toggleMute: toggleMute, isMuted: isMuted };
})();

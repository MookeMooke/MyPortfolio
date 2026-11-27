/* Audio analysis: microphone or system sound -> bass / mid / treble / level + 32-band spectrum. */
(function () {
  const PM = (window.PM = window.PM || {});
  const N = 32;
  let ctx = null, analyser = null, stream = null, data = null, bins = null;
  let peak = 0.2;
  const levels = { bass: 0, mid: 0, treble: 0, level: 0, spec: new Array(N).fill(0) };

  function buildBins(sampleRate, fftSize) {
    const out = [];
    const lo = 40, hi = 12000, hz = sampleRate / fftSize;
    for (let i = 0; i < N; i++) {
      const a = lo * Math.pow(hi / lo, i / N), b = lo * Math.pow(hi / lo, (i + 1) / N);
      const ia = Math.max(1, Math.floor(a / hz));
      out.push([ia, Math.max(ia + 1, Math.ceil(b / hz))]);
    }
    return out;
  }
  const avg = (arr, a, b) => { let s = 0; for (let i = a; i < b; i++) s += arr[i]; return s / (b - a); };

  PM.audio = {
    levels,
    active: false,
    source: 'off',
    async start(source) {
      PM.audio.stop();
      if (source === 'system') {
        // A video track is required by the API; keep it tiny since only the sound is used.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1, width: 320 }, audio: true });
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
          throw new Error('No audio was shared. Tick "Also share system audio" in the share dialog.');
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // A context made without a click can start paused, which reads as silence.
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);
      data = new Uint8Array(analyser.frequencyBinCount);
      bins = buildBins(ctx.sampleRate, analyser.fftSize);
      const track = stream.getAudioTracks()[0];
      if (track) track.addEventListener('ended', () => { PM.audio.stop(); if (PM.audio.onended) PM.audio.onended(); });
      PM.audio.active = true;
      PM.audio.source = source;
    },
    stop() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
      ctx = analyser = stream = null;
      PM.audio.active = false;
      PM.audio.source = 'off';
      levels.bass = levels.mid = levels.treble = levels.level = 0;
      levels.spec.fill(0);
    },
    state() { return ctx ? ctx.state : 'off'; },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    /* Call once per frame. */
    update(gain) {
      if (!analyser) return levels;
      analyser.getByteFrequencyData(data);
      let max = 0;
      const raw = new Array(N);
      for (let i = 0; i < N; i++) {
        raw[i] = avg(data, bins[i][0], bins[i][1]) / 255;
        if (raw[i] > max) max = raw[i];
      }
      levels.raw = max; // before auto-levelling: tells real sound from silence
      peak = Math.max(peak * 0.997, max, 0.12);
      const g = (gain || 1) / peak;
      for (let i = 0; i < N; i++) {
        const v = Math.min(1, raw[i] * g);
        levels.spec[i] = v > levels.spec[i] ? v : levels.spec[i] * 0.85 + v * 0.15;
      }
      levels.bass = avg(levels.spec, 0, 7);
      levels.mid = avg(levels.spec, 7, 20);
      levels.treble = avg(levels.spec, 20, N);
      levels.level = avg(levels.spec, 0, N);
      return levels;
    },
  };
})();

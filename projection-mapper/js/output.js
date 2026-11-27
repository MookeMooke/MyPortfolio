/* The projector window: renders the project, follows the editor, works standalone after a restart. */
(function () {
  const { store } = PM;
  const glc = document.getElementById('gl'), ovc = document.getElementById('ov');
  const octx = ovc.getContext('2d');
  let renderer;
  try { renderer = new PM.Renderer(glc); } catch (e) {
    const el = document.getElementById('err'); el.style.display = 'grid'; el.textContent = e.message; return;
  }
  store.load();
  store.follow();

  let ui = { selType: null, selId: null, selPoint: -1, guides: false };
  let uiAt = 0;
  let remoteAudio = null, remoteAudioAt = 0;
  let overlayDirty = true;
  store.on(() => { overlayDirty = true; });
  store.onMessage((m) => {
    if (m.t === 'ui') { ui = m.ui; uiAt = Date.now(); overlayDirty = true; }
    else if (m.t === 'audio') { remoteAudio = m.a; remoteAudioAt = Date.now(); }
    else if (m.t === 'ping') hello();
  });

  function hello() { store.send({ t: 'hello', w: glc.width, h: glc.height }); }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (glc.width !== w || glc.height !== h) { glc.width = ovc.width = w; glc.height = ovc.height = h; overlayDirty = true; }
    hello();
  }
  addEventListener('resize', resize);
  resize();
  setInterval(hello, 2000);

  /* Without the editor open, listen to the mic ourselves if that was already allowed. */
  async function ownAudio() {
    if (PM.audio.active || store.project.settings.audio !== 'mic' || !navigator.permissions) return;
    try {
      const p = await navigator.permissions.query({ name: 'microphone' });
      if (p.state === 'granted') await PM.audio.start('mic');
    } catch (e) { /* no mic: effects still run, just not music-reactive */ }
  }
  ownAudio();
  setInterval(ownAudio, 5000);

  function frame() {
    requestAnimationFrame(frame);
    let audio = null;
    if (Date.now() - remoteAudioAt < 500) audio = remoteAudio;
    else if (PM.audio.active) audio = PM.audio.update(store.project.settings.audioGain);
    renderer.render(store.project, audio);
    // Guides vanish by themselves if the editor goes away.
    const guides = ui.guides && Date.now() - uiAt < 6000;
    if (overlayDirty || guides !== frame.guides) {
      frame.guides = guides; overlayDirty = false;
      octx.clearRect(0, 0, ovc.width, ovc.height);
      PM.drawOverlay(octx, store.project, ui, { x: 0, y: 0, w: ovc.width, h: ovc.height, editor: false, guides });
    }
  }
  requestAnimationFrame(frame);

  const desktop = !!window.pmDesktop; // the desktop app places and fullscreens this window itself
  if (desktop) document.body.classList.add('full');
  function fullscreen() {
    PM.audio.resume();
    if (desktop) return;
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('full', !!document.fullscreenElement));
  addEventListener('click', fullscreen);
  addEventListener('keydown', (e) => {
    const p = store.project;
    if (e.key === 'f' || e.key === 'F') fullscreen();
    else if (e.key === 'b' || e.key === 'B') { p.settings.blackout = !p.settings.blackout; store.changed(); }
    else if (/^[1-9]$/.test(e.key) && p.scenes[+e.key - 1]) { p.activeScene = p.scenes[+e.key - 1].id; store.changed(); }
  });

  let idleTimer = 0;
  function awake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2500);
  }
  addEventListener('mousemove', awake);
  awake();

  /* Stop the display going to sleep while projecting. */
  async function wake() { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
  wake();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
})();

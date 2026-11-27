/* Project model, persistence, cross-window sync and the media library. */
(function () {
  const PM = (window.PM = window.PM || {});
  const KEY = 'pm.project.v1';
  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
  PM.uid = uid;

  PM.defaultContent = function (type) {
    return {
      type: type || 'none',
      color: '#ffffff',
      mediaId: null,
      mediaIds: [],
      interval: 8,
      effect: 'mood',
      colorA: '#ff3d81',
      colorB: '#3d5afe',
      colorC: '#00e5c3',
      speed: 1,
      scale: 1,
      opacity: 1,
      blend: 'normal',
      react: 0.5,
      feather: 0,
      flipH: false,
      flipV: false,
      h24: true,
      seconds: false,
      date: true,
      bricksX: 8,
      bricksY: 12,
      brickShift: false,
      brickGuide: false,
    };
  };

  PM.makeSurface = function (n) {
    const x0 = 0.3, y0 = 0.25, w = 0.4, h = 0.5;
    return {
      id: uid('s'),
      name: 'Surface ' + n,
      cols: 2,
      rows: 2,
      visible: true,
      points: [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]],
    };
  };

  function defaultProject() {
    const scene = { id: uid('sc'), name: 'Scene 1', contents: {} };
    return {
      version: 1,
      surfaces: [],
      masks: [],
      scenes: [scene],
      activeScene: scene.id,
      settings: {
        brightness: 1,
        blackout: false,
        testPattern: false,
        outW: 1920,
        outH: 1080,
        audio: 'off',
        audioGain: 1,
        weather: { place: '', lat: null, lon: null, units: 'c' },
      },
    };
  }

  function normalise(p) {
    const d = defaultProject();
    if (!p || typeof p !== 'object' || !Array.isArray(p.surfaces)) return d;
    p.masks = p.masks || [];
    if (!Array.isArray(p.scenes) || !p.scenes.length) p.scenes = d.scenes;
    if (!p.scenes.some((s) => s.id === p.activeScene)) p.activeScene = p.scenes[0].id;
    p.settings = Object.assign(d.settings, p.settings || {});
    p.settings.weather = Object.assign({ place: '', lat: null, lon: null, units: 'c' }, p.settings.weather || {});
    for (const sc of p.scenes) {
      sc.contents = sc.contents || {};
      for (const k in sc.contents) sc.contents[k] = Object.assign(PM.defaultContent(), sc.contents[k]);
    }
    return p;
  }

  const listeners = [];
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('pm-sync') : null;
  const msgHandlers = [];
  let saveTimer = 0;
  let hist = [];
  let histIdx = -1;

  const store = (PM.store = {
    project: defaultProject(),
    load() {
      try {
        store.project = normalise(JSON.parse(localStorage.getItem(KEY)));
      } catch (e) {
        store.project = defaultProject();
      }
      hist = [JSON.stringify(store.project)];
      histIdx = 0;
      return store.project;
    },
    on(fn) { listeners.push(fn); },
    emit(why) { for (const fn of listeners) fn(why); },
    /* Call after mutating store.project. */
    changed(why) {
      store.send({ t: 'project', p: store.project });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(store.flush, 250);
      store.emit(why || 'edit');
    },
    flush() {
      clearTimeout(saveTimer);
      try { localStorage.setItem(KEY, JSON.stringify(store.project)); } catch (e) { console.warn('save failed', e); }
    },
    /* Call at the end of a gesture to record an undo step. */
    commit() {
      const s = JSON.stringify(store.project);
      if (s === hist[histIdx]) return;
      hist = hist.slice(0, histIdx + 1);
      hist.push(s);
      if (hist.length > 80) hist.shift();
      histIdx = hist.length - 1;
    },
    undo() { if (histIdx > 0) { histIdx--; store.project = JSON.parse(hist[histIdx]); store.changed('history'); } },
    redo() { if (histIdx < hist.length - 1) { histIdx++; store.project = JSON.parse(hist[histIdx]); store.changed('history'); } },
    adopt(p) { store.project = normalise(p); store.emit('history'); clearTimeout(saveTimer); saveTimer = setTimeout(store.flush, 250); },
    replace(p) { store.project = normalise(p); store.changed('history'); store.commit(); },
    reset() { store.replace(defaultProject()); },
    scene() {
      const p = store.project;
      return p.scenes.find((s) => s.id === p.activeScene) || p.scenes[0];
    },
    send(msg) { if (chan) { try { chan.postMessage(msg); } catch (e) { /* ignore */ } } },
    onMessage(fn) { msgHandlers.push(fn); },
    /* Output window: follow the editor instead of owning the project. */
    follow() {
      store.onMessage((m) => {
        if (m.t === 'project') { store.project = normalise(m.p); store.emit('remote'); }
      });
      window.addEventListener('storage', (e) => {
        if (e.key === KEY && e.newValue) {
          try { store.project = normalise(JSON.parse(e.newValue)); store.emit('remote'); } catch (err) { /* ignore */ }
        }
      });
    },
  });
  if (chan) chan.onmessage = (e) => { for (const fn of msgHandlers) fn(e.data); };
  window.addEventListener('pagehide', () => { if (saveTimer) store.flush(); });

  /* ---------- Media library (IndexedDB) ---------- */
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('pm-media', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  function tx(mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction('media', mode);
      const out = fn(t.objectStore('media'));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  PM.media = {
    async put(file) {
      const rec = { id: uid('m'), name: file.name, type: file.type, size: file.size, blob: file };
      await tx('readwrite', (s) => s.put(rec));
      store.send({ t: 'media' });
      return rec.id;
    },
    get(id) { return tx('readonly', (s) => s.get(id)); },
    async list() {
      const all = (await tx('readonly', (s) => s.getAll())) || [];
      return all.map((r) => ({ id: r.id, name: r.name, type: r.type, size: r.size }));
    },
    async remove(id) { await tx('readwrite', (s) => s.delete(id)); store.send({ t: 'media' }); },
  };
})();

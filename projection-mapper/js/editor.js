/* The control screen: lists, inspector, stage interaction, audio, projector window. */
(function () {
  const { store, geom } = PM;
  const $ = (id) => document.getElementById(id);
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  const glc = $('gl'), ovc = $('ov'), stage = $('stage'), octx = ovc.getContext('2d');
  let renderer;
  try { renderer = new PM.Renderer(glc); } catch (e) { $('hint').textContent = e.message; return; }
  store.load();

  const ui = { selType: null, selId: null, selPoint: -1, guides: true };
  let tool = 'select', draft = [], cursor = null, drag = null;
  let view = { x: 0, y: 0, w: 1, h: 1 };
  let mediaList = [];
  let lastHello = 0;

  const P = () => store.project;
  const selSurface = () => (ui.selType === 'surface' ? P().surfaces.find((s) => s.id === ui.selId) : null);
  const selMask = () => (ui.selType === 'mask' ? P().masks.find((m) => m.id === ui.selId) : null);
  const selPoints = () => { const o = selSurface() || selMask(); return o ? o.points : null; };
  function sendUi() { store.send({ t: 'ui', ui }); }
  function select(type, id, point) {
    ui.selType = type; ui.selId = id; ui.selPoint = point == null ? -1 : point;
    sendUi(); renderLeft(); renderInspector();
  }
  function edit(fn) { fn(); store.changed('edit'); store.commit(); }

  /* ---------- Layout of the stage ---------- */
  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight, pad = 44, dpr = window.devicePixelRatio || 1;
    const ar = P().settings.outW / P().settings.outH;
    let w = W - pad * 2, hh = w / ar;
    if (hh > H - pad * 2) { hh = H - pad * 2; w = hh * ar; }
    w = Math.max(50, w); hh = Math.max(30, hh);
    view = { x: Math.round((W - w) / 2), y: Math.round((H - hh) / 2), w: Math.round(w), h: Math.round(hh) };
    Object.assign(glc.style, { left: view.x + 'px', top: view.y + 'px', width: view.w + 'px', height: view.h + 'px' });
    glc.width = Math.round(view.w * dpr); glc.height = Math.round(view.h * dpr);
    ovc.width = Math.round(W * dpr); ovc.height = Math.round(H * dpr);
  }
  new ResizeObserver(layout).observe(stage);

  /* ---------- Left panel ---------- */
  function item(o, selected, onclick, ...extra) {
    return h('div', { class: 'item' + (selected ? ' sel' : ''), onclick }, ...extra);
  }
  const iconBtn = (label, title, fn) => h('button', { title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } }, label);
  function renderLeft() {
    const p = P(), left = $('left');
    const kids = [];
    kids.push(h('h3', null, 'Scenes', h('button', { class: 'small', onclick: addScene, title: 'Copy the current scene' }, '+ Add')));
    kids.push(h('div', { class: 'list' }, p.scenes.map((sc, i) => item(sc, sc.id === p.activeScene, () => edit(() => { p.activeScene = sc.id; }),
      h('span', { class: 'key' }, i < 9 ? String(i + 1) : ''),
      h('span', { class: 'name' }, sc.name),
      iconBtn('✎', 'Rename scene', () => rename(sc)),
      p.scenes.length > 1 && iconBtn('✕', 'Delete scene', () => {
        if (!confirm(`Delete "${sc.name}"?`)) return;
        edit(() => { p.scenes = p.scenes.filter((x) => x !== sc); if (p.activeScene === sc.id) p.activeScene = p.scenes[0].id; });
      })))));
    kids.push(h('h3', null, 'Surfaces', h('span', null, h('button', { class: 'small', onclick: addBrickEq, title: 'Preset: equalizer mapped onto wall bricks' }, '+ Brick EQ'), ' ', h('button', { class: 'small', onclick: addSurface }, '+ Add'))));
    kids.push(h('div', { class: 'list' }, p.surfaces.length ? p.surfaces.map((s) => item(s, ui.selType === 'surface' && ui.selId === s.id, () => select('surface', s.id),
      h('input', { type: 'checkbox', checked: s.visible, title: 'Show / hide', onclick: (e) => e.stopPropagation(), onchange: (e) => edit(() => { s.visible = e.target.checked; }) }),
      h('span', { class: 'name' }, s.name))) : h('div', { class: 'empty' }, 'Add a surface to start mapping.')));
    kids.push(h('h3', null, 'Masks', h('button', { class: 'small', onclick: startMask }, '+ Add')));
    kids.push(h('div', { class: 'list' }, p.masks.length ? p.masks.map((m) => item(m, ui.selType === 'mask' && ui.selId === m.id, () => select('mask', m.id),
      h('input', { type: 'checkbox', checked: m.visible, title: 'On / off', onclick: (e) => e.stopPropagation(), onchange: (e) => edit(() => { m.visible = e.target.checked; }) }),
      h('span', { class: 'name' }, m.name))) : h('div', { class: 'empty' }, 'Masks black out parts of the wall.')));
    kids.push(h('h3', null, 'Media', h('button', { class: 'small', onclick: () => $('fileMedia').click() }, 'Upload')));
    kids.push(h('div', { class: 'list' }, mediaList.length ? mediaList.map((m) => h('div', { class: 'item', style: 'cursor:default' },
      h('span', { class: 'name', title: m.name }, ((m.type || '').startsWith('video') ? '▶ ' : '') + m.name),
      iconBtn('✕', 'Delete media', async () => {
        if (!confirm(`Delete "${m.name}" from the library?`)) return;
        await PM.media.remove(m.id); renderer.forgetMissing(); refreshMedia();
      }))) : h('div', { class: 'empty' }, 'Upload images and videos.')));
    left.replaceChildren(...kids);
  }
  function rename(o) {
    const dlg = $('ask'), input = $('askInput');
    input.value = o.name;
    dlg.onclose = () => {
      const n = input.value.trim();
      if (dlg.returnValue === 'ok' && n) edit(() => { o.name = n; });
    };
    dlg.showModal(); input.select();
  }
  function addScene() {
    const p = P(), cur = store.scene();
    const sc = { id: PM.uid('sc'), name: 'Scene ' + (p.scenes.length + 1), contents: JSON.parse(JSON.stringify(cur.contents)) };
    edit(() => { p.scenes.push(sc); p.activeScene = sc.id; });
  }
  function addSurface() {
    const p = P(), s = PM.makeSurface(p.surfaces.length + 1);
    p.surfaces.push(s);
    for (const sc of p.scenes) sc.contents[s.id] = PM.defaultContent(sc.id === p.activeScene ? 'grid' : 'none');
    store.changed('edit'); store.commit();
    select('surface', s.id);
  }
  /* Preset: an equalizer that lights real bricks. Starts in line-up mode. */
  /* A rectangle on screen with the same proportions as the measured wall area. */
  function brickShape(s, c) {
    const st = P().settings, ar = (c.areaW / c.areaH) * (st.outH / st.outW);
    let w = 0.6, hh = w / ar;
    if (hh > 0.7) { hh = 0.7; w = hh * ar; }
    const x0 = 0.5 - w / 2, y0 = 0.5 - hh / 2;
    s.cols = 2; s.rows = 2;
    s.points = [[x0, y0], [x0 + w, y0], [x0, y0 + hh], [x0 + w, y0 + hh]];
  }
  function addBrickEq() {
    const p = P(), s = PM.makeSurface(p.surfaces.length + 1);
    s.name = 'Brick equalizer';
    brickShape(s, PM.defaultContent());
    p.surfaces.push(s);
    for (const sc of p.scenes) sc.contents[s.id] = PM.defaultContent('none');
    Object.assign(store.scene().contents[s.id], { type: 'effect', effect: 'bricks', brickGuide: true,
      colorA: '#ff9a2e', colorB: '#ffb648', colorC: '#ffd27a', react: 1 });
    store.changed('edit'); store.commit();
    select('surface', s.id);
    toast(PM.audio.active ? 'Enter your wall area and brick size on the right, then line the lines up with your mortar.' : ('Enter your wall area and brick size on the right, line the lines up with your mortar, and turn Music on in the top bar.'));
  }
  function startMask() {
    tool = 'mask'; draft = []; cursor = null;
    select(null, null);
    $('hint').textContent = 'Click to place mask points · Enter or click the first point to finish · Esc to cancel';
  }
  function finishMask() {
    if (draft.length >= 3) {
      const m = { id: PM.uid('k'), name: 'Mask ' + (P().masks.length + 1), mode: 'block', visible: true, points: draft };
      P().masks.push(m);
      store.changed('edit'); store.commit();
      tool = 'select'; draft = []; $('hint').textContent = '';
      select('mask', m.id);
    } else cancelMask();
  }
  function cancelMask() { tool = 'select'; draft = []; $('hint').textContent = ''; }
  async function refreshMedia() {
    try { mediaList = await PM.media.list(); } catch (e) { mediaList = []; }
    renderLeft(); renderInspector(true);
  }

  /* ---------- Inspector ---------- */
  const field = (label, ...ctl) => h('label', { class: 'field' }, h('span', null, label), h('div', { class: 'row' }, ...ctl));
  const live = () => store.changed('input');
  const range = (label, o, k, min, max, step) => field(label, h('input', {
    type: 'range', min, max, step, value: o[k],
    oninput: (e) => { o[k] = +e.target.value; live(); }, onchange: () => store.commit(),
  }));
  const color = (label, o, k) => field(label, h('input', {
    type: 'color', value: o[k], oninput: (e) => { o[k] = e.target.value; live(); }, onchange: () => store.commit(),
  }));
  const check = (label, o, k) => field(label, h('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => edit(() => { o[k] = e.target.checked; }) }));
  const choose = (label, o, k, opts, after) => field(label, h('select', {
    onchange: (e) => { edit(() => { o[k] = e.target.value; if (after) after(e.target.value); }); },
  }, opts.map(([v, t]) => h('option', { value: v, selected: String(o[k]) === String(v) }, t))));

  const TYPES = [['none', 'Nothing'], ['grid', 'Alignment grid'], ['color', 'Colour'], ['media', 'Image / video'], ['slideshow', 'Slideshow'],
    ['effect', 'Effect'], ['clock', 'Clock'], ['weather', 'Weather']];
  let inspKey = '';
  function renderInspector(force) {
    const p = P(), s = selSurface(), m = selMask(), sc = store.scene();
    const c = s ? sc.contents[s.id] : null;
    const key = JSON.stringify([ui.selType, ui.selId, sc.id, c && [c.type, c.effect, c.mediaId, c.mediaIds], s && [s.cols, s.rows, s.name], m && [m.mode, m.name],
      mediaList.map((x) => x.id), p.settings.weather, PM.audio.active]);
    if (!force && key === inspKey) return;
    inspKey = key;
    const out = [];
    if (s) {
      out.push(h('h3', null, 'Surface'));
      out.push(field('Name', h('input', { type: 'text', value: s.name, onchange: (e) => edit(() => { s.name = e.target.value.trim() || s.name; }) })));
      const sizes = [2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]);
      out.push(field('Grid',
        h('select', { title: 'Points across', onchange: (e) => edit(() => { geom.resample(s, +e.target.value, s.rows); ui.selPoint = -1; }) }, sizes.map(([v, t]) => h('option', { value: v, selected: s.cols === v }, t))),
        '×',
        h('select', { title: 'Points down', onchange: (e) => edit(() => { geom.resample(s, s.cols, +e.target.value); ui.selPoint = -1; }) }, sizes.map(([v, t]) => h('option', { value: v, selected: s.rows === v }, t)))));
      out.push(h('div', { class: 'muted' }, '2 × 2 for flat things. More points for curves and corners.'));
      out.push(h('div', { class: 'btnrow' },
        h('button', { class: 'small', onclick: () => moveOrder(s, 1), title: 'Draw on top of other surfaces' }, 'Forward'),
        h('button', { class: 'small', onclick: () => moveOrder(s, -1) }, 'Back'),
        h('button', { class: 'small', onclick: () => duplicate(s) }, 'Duplicate'),
        h('button', { class: 'small', onclick: () => edit(() => { const f = PM.makeSurface(0); s.cols = 2; s.rows = 2; s.points = f.points; ui.selPoint = -1; }) }, 'Reset shape'),
        h('button', { class: 'small danger', onclick: () => removeSurface(s) }, 'Delete')));
      out.push(h('h3', null, 'Content in ' + sc.name));
      const cc = c || (sc.contents[s.id] = PM.defaultContent('none'));
      out.push(choose('Show', cc, 'type', TYPES));
      contentControls(out, cc);
    } else if (m) {
      out.push(h('h3', null, 'Mask'));
      out.push(field('Name', h('input', { type: 'text', value: m.name, onchange: (e) => edit(() => { m.name = e.target.value.trim() || m.name; }) })));
      out.push(choose('Type', m, 'mode', [['block', 'Black out this area'], ['window', 'Only light this area']]));
      out.push(h('div', { class: 'muted' }, 'Drag points to reshape. Double-click an edge to add a point. Select a point and press Delete to remove it.'));
      out.push(h('div', { class: 'btnrow' }, h('button', { class: 'small danger', onclick: () => {
        if (!confirm(`Delete "${m.name}"?`)) return;
        P().masks = P().masks.filter((x) => x !== m); store.changed('edit'); store.commit(); select(null, null);
      } }, 'Delete')));
    } else {
      out.push(h('h3', null, 'Nothing selected'));
      out.push(h('div', { class: 'muted' }, 'Click a surface or mask on the stage, or add one from the left panel.'));
      out.push(h('h3', null, 'Project'));
      out.push(h('div', { class: 'btnrow' }, h('button', { class: 'small danger', onclick: () => {
        if (confirm('Clear all surfaces, masks and scenes? Media stays in the library.')) { store.reset(); select(null, null); }
      } }, 'New empty project')));
    }
    $('right').replaceChildren(...out);
  }
  function contentControls(out, c) {
    const t = c.type;
    if (t === 'none') return;
    if (t === 'color') out.push(color('Colour', c, 'color'));
    if (t === 'media') {
      const opts = [['', '— choose —']].concat(mediaList.map((m) => [m.id, m.name]));
      out.push(field('File', h('select', { onchange: (e) => edit(() => { c.mediaId = e.target.value || null; }) },
        opts.map(([v, n]) => h('option', { value: v, selected: (c.mediaId || '') === v }, n)))));
      if (c.mediaId && !mediaList.some((m) => m.id === c.mediaId)) out.push(h('div', { class: 'warn' }, 'This file is missing from the library.'));
      out.push(h('div', { class: 'btnrow' }, h('button', { class: 'small', onclick: () => { uploadTarget = c; $('fileMedia').click(); } }, 'Upload new…')));
      out.push(check('Flip sideways', c, 'flipH'), check('Flip upside down', c, 'flipV'));
    }
    if (t === 'slideshow') {
      const images = mediaList.filter((m) => (m.type || '').startsWith('image'));
      out.push(images.length ? h('div', { class: 'checks' }, images.map((m) => h('label', null,
        h('input', { type: 'checkbox', checked: c.mediaIds.includes(m.id), onchange: (e) => edit(() => {
          c.mediaIds = e.target.checked ? c.mediaIds.concat(m.id) : c.mediaIds.filter((x) => x !== m.id);
        }) }), m.name))) : h('div', { class: 'empty' }, 'Upload some images first (Media, left panel).'));
      out.push(range('Seconds each', c, 'interval', 2, 60, 1));
    }
    if (t === 'effect') {
      out.push(choose('Effect', c, 'effect', PM.EFFECTS));
      if ((c.effect === 'bricks' || c.effect === 'bars' || c.effect === 'pulse') && !PM.audio.active) {
        out.push(h('div', { class: 'warn' }, 'Music is off, so this will not react.'));
        out.push(h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => { localStorage.setItem('pm.audioChoice', musicSource()); setAudio(musicSource()); } }, 'Turn music on')));
      }
      if (c.effect === 'bricks') {
        const fits = h('div', { class: 'muted' });
        const showFits = () => { const b = PM.brickLayout(c); fits.textContent = `Fits ${b.nx.toFixed(1)} bricks across × ${b.ny.toFixed(1)} rows.`; };
        const num = (label, k, min, max, step) => field(label, h('input', { type: 'number', min, max, step, value: c[k],
          oninput: (e) => { const v = +e.target.value; if (e.target.value !== '' && v >= min && v <= max) { c[k] = v; live(); showFits(); } }, onchange: () => store.commit() }));
        out.push(choose('Bars grow', c, 'brickDir', [['lr', 'Left to right'], ['rl', 'Right to left'], ['up', 'Bottom to top']]));
        out.push(h('h3', null, 'Wall area (cm)'));
        out.push(num('Width', 'areaW', 10, 2000, 1), num('Height', 'areaH', 10, 2000, 1));
        out.push(h('div', { class: 'btnrow' }, h('button', { class: 'small', title: 'Reset the surface to a rectangle with these proportions', onclick: () => edit(() => { brickShape(selSurface(), c); ui.selPoint = -1; }) }, 'Fit shape to area')));
        out.push(h('h3', null, 'Brick size (mm)'));
        out.push(num('Length', 'brickL', 50, 600, 0.5), num('Height', 'brickH', 20, 400, 0.5), num('Mortar joint', 'brickJ', 0, 40, 0.5));
        out.push(fits);
        out.push(h('div', { class: 'btnrow' }, h('button', { class: 'small', onclick: () => { edit(() => { c.brickL = 215; c.brickH = 65; c.brickJ = 10; }); renderInspector(true); } }, 'UK standard (215 × 65, 10 joint)')));
        out.push(h('h3', null, 'Line up'));
        out.push(check('Show brick lines', c, 'brickGuide'), check('Shift rows', c, 'brickShift'));
        out.push(range('Slide sideways', c, 'brickOX', 0, 1, 0.005), range('Slide up', c, 'brickOY', 0, 1, 0.005));
        out.push(h('div', { class: 'muted' }, 'Measure the part of the wall to light and enter it above. Drag the four corner points to the corners of that area on the wall. Then use the slides until the lines sit on the mortar.'));
        showFits();
      }
      out.push(field('Colours',
        ...['colorA', 'colorB', 'colorC'].map((k) => h('input', { type: 'color', value: c[k], oninput: (e) => { c[k] = e.target.value; live(); }, onchange: () => store.commit() }))));
      out.push(range('Speed', c, 'speed', 0, 4, 0.05), range('Size', c, 'scale', 0.2, 4, 0.05));
    }
    if (t === 'clock') out.push(color('Colour', c, 'colorA'), check('24 hour', c, 'h24'), check('Seconds', c, 'seconds'), check('Date', c, 'date'));
    if (t === 'weather') {
      const w = P().settings.weather;
      const place = h('input', { type: 'text', placeholder: 'Town or city', value: w.place });
      out.push(color('Colour', c, 'colorA'));
      out.push(field('Location', place, h('button', { class: 'small', style: 'flex:none', onclick: async () => {
        if (!place.value.trim()) return;
        try { const g = await PM.geocode(place.value.trim()); edit(() => { Object.assign(w, g); }); toast('Location set: ' + g.place); }
        catch (e) { toast(e.message === 'Place not found' ? e.message : 'Could not look that place up. Check your internet connection.'); }
      } }, 'Set')));
      out.push(choose('Units', w, 'units', [['c', 'Celsius'], ['f', 'Fahrenheit']]));
      out.push(h('div', { class: 'muted' }, 'Weather comes from open-meteo.com. The place name is sent there to look it up.'));
    }
    out.push(h('h3', null, 'Look'));
    out.push(range('Opacity', c, 'opacity', 0, 1, 0.01));
    out.push(range('Soft edges', c, 'feather', 0, 1, 0.01));
    out.push(choose('Blend', c, 'blend', [['normal', 'Normal'], ['add', 'Add light']]));
    if (t === 'media' || t === 'slideshow' || t === 'effect') out.push(range('Music reaction', c, 'react', 0, 2, 0.05));
  }
  function moveOrder(s, d) {
    const a = P().surfaces, i = a.indexOf(s), j = i + d;
    if (j < 0 || j >= a.length) return;
    edit(() => { a.splice(i, 1); a.splice(j, 0, s); });
  }
  function duplicate(s) {
    const p = P(), n = JSON.parse(JSON.stringify(s));
    n.id = PM.uid('s'); n.name = s.name + ' copy'; n.points = n.points.map((q) => [q[0] + 0.03, q[1] + 0.03]);
    p.surfaces.push(n);
    for (const sc of p.scenes) if (sc.contents[s.id]) sc.contents[n.id] = JSON.parse(JSON.stringify(sc.contents[s.id]));
    store.changed('edit'); store.commit(); select('surface', n.id);
  }
  function removeSurface(s) {
    if (!confirm(`Delete "${s.name}"?`)) return;
    const p = P();
    p.surfaces = p.surfaces.filter((x) => x !== s);
    for (const sc of p.scenes) delete sc.contents[s.id];
    store.changed('edit'); store.commit(); select(null, null);
  }

  /* ---------- Media upload ---------- */
  let uploadTarget = null;
  $('fileMedia').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    let lastId = null;
    for (const f of files) {
      try { lastId = await PM.media.put(f); } catch (err) { toast(`Could not store "${f.name}" (browser storage full?)`); }
    }
    if (uploadTarget && lastId) { uploadTarget.mediaId = lastId; store.changed('edit'); store.commit(); }
    uploadTarget = null;
    renderer.forgetMissing();
    refreshMedia();
  });

  /* ---------- Stage interaction ---------- */
  function norm(e) {
    const r = ovc.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.w, (e.clientY - r.top - view.y) / view.h];
  }
  function nearPoint(points, n, radius) {
    let best = -1, bd = radius || 11;
    points.forEach((p, i) => { const d = Math.hypot((p[0] - n[0]) * view.w, (p[1] - n[1]) * view.h); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  ovc.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const n = norm(e), p = P();
    if (tool === 'mask') {
      if (draft.length >= 3 && nearPoint([draft[0]], n) === 0) finishMask(); else draft.push(n);
      return;
    }
    ovc.setPointerCapture(e.pointerId);
    const cur = selSurface() || selMask();
    if (cur) {
      const i = nearPoint(cur.points, n);
      if (i >= 0) { ui.selPoint = i; sendUi(); drag = { kind: 'point', pts: cur.points, i, off: [cur.points[i][0] - n[0], cur.points[i][1] - n[1]] }; return; }
      if (selMask() && geom.inPoly(cur.points, n[0], n[1])) { drag = { kind: 'move', pts: cur.points, last: n }; return; }
    }
    for (let k = p.surfaces.length - 1; k >= 0; k--) {
      const s = p.surfaces[k];
      if (s.visible && geom.inPoly(geom.outline(s), n[0], n[1])) {
        if (ui.selId !== s.id) select('surface', s.id); else if (ui.selPoint !== -1) { ui.selPoint = -1; sendUi(); }
        drag = { kind: 'move', pts: s.points, last: n };
        return;
      }
    }
    for (let k = p.masks.length - 1; k >= 0; k--) {
      const m = p.masks[k];
      if (m.visible && m.mode !== 'window' && geom.inPoly(m.points, n[0], n[1])) { select('mask', m.id); drag = { kind: 'move', pts: m.points, last: n }; return; }
    }
    select(null, null);
  });
  ovc.addEventListener('pointermove', (e) => {
    const n = norm(e);
    if (tool === 'mask') { cursor = n; return; }
    if (!drag) return;
    if (drag.kind === 'point') drag.pts[drag.i] = [n[0] + drag.off[0], n[1] + drag.off[1]];
    else {
      const dx = n[0] - drag.last[0], dy = n[1] - drag.last[1];
      drag.pts.forEach((q) => { q[0] += dx; q[1] += dy; });
      drag.last = n;
    }
    store.changed('drag');
  });
  const endDrag = () => { if (drag) { drag = null; store.commit(); } };
  ovc.addEventListener('pointerup', endDrag);
  ovc.addEventListener('pointercancel', endDrag);
  ovc.addEventListener('dblclick', (e) => {
    const m = selMask();
    if (!m || tool !== 'select') return;
    const n = norm(e), px = (q) => [q[0] * view.w, q[1] * view.h], c = px(n);
    let best = -1, bd = 10;
    m.points.forEach((a, i) => {
      const A = px(a), B = px(m.points[(i + 1) % m.points.length]);
      const vx = B[0] - A[0], vy = B[1] - A[1], t = Math.max(0, Math.min(1, ((c[0] - A[0]) * vx + (c[1] - A[1]) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(c[0] - A[0] - vx * t, c[1] - A[1] - vy * t);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) edit(() => { m.points.splice(best + 1, 0, n); ui.selPoint = best + 1; sendUi(); });
  });

  addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
    if ($('help').open || $('ask').open || $('remote').open) return;
    const p = P(), k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); store.redo(); return; }
    if (mod || e.altKey) return;
    if (tool === 'mask') {
      if (k === 'Enter') finishMask(); else if (k === 'Escape') cancelMask();
      else if (k === 'Backspace') draft.pop();
      return;
    }
    const pts = selPoints();
    if (k.startsWith('Arrow') && pts) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = (k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0) / p.settings.outW;
      const dy = (k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0) / p.settings.outH;
      (ui.selPoint >= 0 ? [pts[ui.selPoint]] : pts).forEach((q) => { q[0] += dx; q[1] += dy; });
      store.changed('drag'); store.commit();
    } else if (k === 'Tab' && pts) {
      e.preventDefault();
      ui.selPoint = (ui.selPoint + (e.shiftKey ? -1 : 1) + pts.length) % pts.length; sendUi();
    } else if (k === 'Escape') {
      if (ui.selPoint >= 0) { ui.selPoint = -1; sendUi(); } else select(null, null);
    } else if ((k === 'Delete' || k === 'Backspace') && selMask() && ui.selPoint >= 0 && pts.length > 3) {
      edit(() => { pts.splice(ui.selPoint, 1); ui.selPoint = -1; }); sendUi();
    } else if (k === 'g' || k === 'G') { ui.guides = !ui.guides; sendUi(); syncTop(); }
    else if (k === 't' || k === 'T') edit(() => { p.settings.testPattern = !p.settings.testPattern; });
    else if (k === 'b' || k === 'B') edit(() => { p.settings.blackout = !p.settings.blackout; });
    else if (/^[1-9]$/.test(k) && p.scenes[+k - 1]) edit(() => { p.activeScene = p.scenes[+k - 1].id; });
  });

  /* ---------- Top bar ---------- */
  function syncTop() {
    const st = P().settings;
    $('chkGuides').checked = ui.guides;
    $('chkTest').checked = st.testPattern;
    $('chkBlack').checked = st.blackout;
    $('rngBright').value = st.brightness;
    $('selAudio').value = PM.audio.active ? PM.audio.source : 'off';
  }
  $('chkGuides').onchange = (e) => { ui.guides = e.target.checked; sendUi(); };
  $('chkTest').onchange = (e) => edit(() => { P().settings.testPattern = e.target.checked; });
  $('chkBlack').onchange = (e) => edit(() => { P().settings.blackout = e.target.checked; });
  $('rngBright').oninput = (e) => { P().settings.brightness = +e.target.value; live(); };
  $('rngBright').onchange = () => store.commit();
  $('btnUndo').onclick = store.undo;
  $('btnRedo').onclick = store.redo;
  $('btnHelp').onclick = () => $('help').showModal();
  $('btnExport').onclick = () => {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(P(), null, 1)], { type: 'application/json' })), download: 'projection-layout.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('btnImport').onclick = () => $('fileImport').click();
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.surfaces)) throw new Error('bad');
      if (!confirm('Replace the current layout with this file?')) return;
      store.replace(j); select(null, null);
    } catch (err) { toast('That file is not a projection layout.'); }
  });
  async function setAudio(src, quiet) {
    try {
      if (src === 'off') PM.audio.stop(); else await PM.audio.start(src);
      P().settings.audio = src; store.changed('input');
    } catch (err) {
      PM.audio.stop();
      if (!quiet) toast('Music could not start: ' + (err && err.name === 'NotAllowedError' ? 'sound access was not allowed.' : (err && err.message) || 'unknown reason.'));
    }
    syncTop(); renderInspector();
  }
  const musicSource = () => (desktop ? 'system' : 'mic');
  $('selAudio').onchange = (e) => { localStorage.setItem('pm.audioChoice', e.target.value); setAudio(e.target.value); };
  PM.audio.onended = () => { syncTop(); renderInspector(); };
  // Any click or key also wakes sound analysis if the system paused it.
  addEventListener('pointerdown', () => PM.audio.resume(), true);
  addEventListener('keydown', () => PM.audio.resume(), true);
  /* Says plainly whether music is being heard. */
  let heardAt = 0;
  function audioStatus(audio) {
    const el = $('audioStatus');
    if (audio && audio.raw > 0.02) heardAt = Date.now();
    let text = 'Music: off', cls = 'pill';
    if (PM.audio.active) {
      if (PM.audio.state() !== 'running') text = 'Music: paused, click anywhere';
      else if (Date.now() - heardAt < 3000) { text = 'Music: hearing sound'; cls = 'pill on'; }
      else text = 'Music: on, but silent';
    }
    if (el.textContent !== text) { el.textContent = text; el.className = cls; }
  }

  async function openOutput() {
    if (desktop) {
      window.open('output.html', 'pm-output', 'popup');
      if (!(await window.pmDesktop.hasProjector())) toast('No projector found, so the output opened as a normal window. Plug the projector in and reopen it.');
      return;
    }
    let feat = 'popup,width=960,height=540';
    try {
      if ('getScreenDetails' in window) {
        const d = await window.getScreenDetails();
        const s = d.screens.find((x) => x !== d.currentScreen);
        if (s) feat = `popup,left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`;
      }
    } catch (e) { /* permission declined: open a normal window instead */ }
    const w = window.open('output.html', 'pm-output', feat);
    if (!w) toast('The browser blocked the window. Allow pop-ups for this page, then click again.');
    else toast('Drag the new window onto the projector if needed, then click it for fullscreen.');
  }
  $('btnOutput').onclick = openOutput;

  /* Desktop app: called once by the shell after load. */
  const desktop = !!window.pmDesktop;
  window.PMDesktopReady = (info) => {
    // Listen to the laptop's sound from the start, unless the user chose otherwise.
    const choice = localStorage.getItem('pm.audioChoice') || 'system';
    if (choice !== 'off') setAudio(choice);
    if (info && info.projector && P().surfaces.length) openOutput();
  };
  if (desktop) {
    $('selAudio').querySelector('[value=system]').textContent = 'Music: laptop sound';
    document.body.classList.add('desktop');

    /* Phone remote: publish what the phone needs, apply what it sends. */
    let stateTimer = 0;
    const pushState = () => {
      clearTimeout(stateTimer);
      stateTimer = setTimeout(() => {
        const p = P();
        window.pmDesktop.sendState({ scenes: p.scenes.map((x) => ({ id: x.id, name: x.name })), active: p.activeScene, blackout: p.settings.blackout, brightness: p.settings.brightness });
      }, 60);
    };
    store.on((why) => { if (why !== 'drag') pushState(); });
    pushState();
    window.pmDesktop.onRemote((c) => {
      const p = P();
      if (c.scene && p.scenes.some((x) => x.id === c.scene)) p.activeScene = c.scene;
      if (c.step) {
        const i = p.scenes.findIndex((x) => x.id === p.activeScene);
        p.activeScene = p.scenes[(i + c.step + p.scenes.length) % p.scenes.length].id;
      }
      if ('blackout' in c) p.settings.blackout = c.blackout;
      if ('brightness' in c) p.settings.brightness = c.brightness;
      store.changed('edit');
      if (!('brightness' in c)) store.commit();
    });
    $('btnRemote').onclick = async () => {
      const body = $('remoteBody');
      body.replaceChildren('Starting…');
      $('remote').showModal();
      const info = await window.pmDesktop.remoteInfo();
      if (!info.links.length) {
        body.replaceChildren(h('p', { class: 'warn' }, info.error || 'This laptop is not on a network. Connect it to Wi-Fi, or link your phone by Bluetooth tethering, then open this again.'));
        return;
      }
      const img = h('img', { alt: 'QR code for the phone remote', width: 240, height: 240, style: 'display:block;margin:8px auto;border-radius:8px' });
      const addr = h('p', { class: 'muted', style: 'text-align:center;word-break:break-all;user-select:text' });
      const show = (l) => { img.src = l.qr; addr.textContent = l.url; };
      const pick = h('select', { onchange: (e) => show(info.links[+e.target.value]) }, info.links.map((l, i) => h('option', { value: i }, l.name)));
      show(info.links[0]);
      body.replaceChildren(...[
        h('ol', null,
          h('li', null, 'Put your phone on the same Wi-Fi as this laptop.'),
          h('li', null, 'Scan this code with the phone camera.'),
          h('li', null, 'If Windows asks about network access, choose Allow.')),
        info.links.length > 1 ? field('Connection', pick) : null, img, addr,
        h('p', { class: 'muted' }, 'No Wi-Fi? Turn on Bluetooth tethering on the phone, join it from Windows Bluetooth settings, then reopen this window and pick the Bluetooth connection.')].filter(Boolean));
    };
  }

  store.onMessage((m) => {
    if (m.t === 'hello') {
      lastHello = Date.now();
      const st = P().settings;
      if (m.w > 0 && m.h > 0 && (st.outW !== m.w || st.outH !== m.h)) { st.outW = m.w; st.outH = m.h; store.changed('input'); layout(); }
      $('outStatus').textContent = `Projector: ${m.w} × ${m.h}`;
      $('outStatus').classList.add('on');
      sendUi();
    } else if (m.t === 'project') { store.adopt(m.p); }
  });
  setInterval(() => {
    sendUi();
    if (Date.now() - lastHello > 5000) { $('outStatus').textContent = 'Projector: not connected'; $('outStatus').classList.remove('on'); }
  }, 2000);

  /* ---------- Frame loop ---------- */
  const meter = $('meter'), mctx = meter.getContext('2d');
  function frame() {
    requestAnimationFrame(frame);
    let audio = null;
    if (PM.audio.active) {
      audio = PM.audio.update(P().settings.audioGain);
      store.send({ t: 'audio', a: { bass: audio.bass, mid: audio.mid, treble: audio.treble, level: audio.level, spec: audio.spec } });
    }
    audioStatus(audio);
    renderer.render(P(), audio);
    const dpr = window.devicePixelRatio || 1;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, ovc.width, ovc.height);
    PM.drawOverlay(octx, P(), ui, { x: view.x, y: view.y, w: view.w, h: view.h, editor: true, guides: true, draft, cursor });
    mctx.clearRect(0, 0, meter.width, meter.height);
    if (audio) {
      [audio.bass, audio.mid, audio.treble].forEach((v, i) => {
        mctx.fillStyle = ['#ff5fa2', '#ffd23f', '#3ddcff'][i];
        mctx.fillRect(4 + i * 22, meter.height - 2 - v * (meter.height - 4), 18, v * (meter.height - 4));
      });
    }
  }

  store.on((why) => {
    if (why === 'history') {
      if (ui.selId && !selSurface() && !selMask()) { ui.selType = null; ui.selId = null; }
      ui.selPoint = -1; sendUi(); layout();
    }
    if (why !== 'drag' && why !== 'input') renderLeft();
    if (why !== 'drag') renderInspector(why === 'history');
    syncTop();
  });

  layout();
  renderLeft(); renderInspector(true); syncTop();
  refreshMedia();
  store.send({ t: 'ping' });
  if (P().settings.audio === 'mic' && navigator.permissions) {
    navigator.permissions.query({ name: 'microphone' }).then((r) => { if (r.state === 'granted') setAudio('mic', true); }).catch(() => {});
  }
  if (!P().surfaces.length && !localStorage.getItem('pm.seenHelp')) { localStorage.setItem('pm.seenHelp', '1'); $('help').showModal(); }
  requestAnimationFrame(frame);
  window.PMDebug = { ui, renderer };
})();

/* Mesh-warp geometry, the WebGL renderer and the mask / guide overlay. Shared by editor and output. */
(function () {
  const PM = (window.PM = window.PM || {});

  /* ---------- Geometry ---------- */
  function homography(p0, p1, p2, p3) { // unit square (0,0) (1,0) (1,1) (0,1) -> quad
    const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], sx = p0[0] - p1[0] + p2[0] - p3[0];
    const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1], sy = p0[1] - p1[1] + p2[1] - p3[1];
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    if (g + 1 <= 0.02 || h + 1 <= 0.02 || g + h + 1 <= 0.02) return null; // not convex enough
    const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], c = p0[0];
    const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1], f = p0[1];
    return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  }
  function cr(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t, o = [0, 0];
    for (let i = 0; i < 2; i++) {
      o[i] = 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
        (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3);
    }
    return o;
  }
  function pt(s, c, r) { // control point with linear extrapolation past the edges
    const ex = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
    if (c < 0) return ex(pt(s, 0, r), pt(s, 1, r));
    if (c >= s.cols) return ex(pt(s, s.cols - 1, r), pt(s, s.cols - 2, r));
    if (r < 0) return ex(pt(s, c, 0), pt(s, c, 1));
    if (r >= s.rows) return ex(pt(s, c, s.rows - 1), pt(s, c, s.rows - 2));
    return s.points[r * s.cols + c];
  }
  function splineEval(s, u, v) {
    const fu = u * (s.cols - 1), fv = v * (s.rows - 1);
    const ci = Math.max(0, Math.min(Math.floor(fu), s.cols - 2)), ri = Math.max(0, Math.min(Math.floor(fv), s.rows - 2));
    const tu = fu - ci, tv = fv - ri, row = [];
    for (let k = -1; k <= 2; k++) row.push(cr(pt(s, ci - 1, ri + k), pt(s, ci, ri + k), pt(s, ci + 1, ri + k), pt(s, ci + 2, ri + k), tu));
    return cr(row[0], row[1], row[2], row[3], tv);
  }
  const geom = (PM.geom = {
    /* fn(u,v) -> [x,y] in output space. Four-corner surfaces are perspective-correct. */
    evaluator(s) {
      if (s.cols === 2 && s.rows === 2) {
        const H = homography(s.points[0], s.points[1], s.points[3], s.points[2]);
        if (H) return H;
      }
      return (u, v) => splineEval(s, u, v);
    },
    resample(s, cols, rows) {
      const ev = geom.evaluator(s), pts = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push(ev(c / (cols - 1), r / (rows - 1)));
      s.cols = cols; s.rows = rows; s.points = pts;
    },
    outline(s, steps) {
      const ev = geom.evaluator(s), n = steps || 12, o = [];
      for (let i = 0; i < n; i++) o.push(ev(i / n, 0));
      for (let i = 0; i < n; i++) o.push(ev(1, i / n));
      for (let i = 0; i < n; i++) o.push(ev(1 - i / n, 1));
      for (let i = 0; i < n; i++) o.push(ev(0, 1 - i / n));
      return o;
    },
    inPoly(poly, x, y) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    },
  });

  /* ---------- Renderer ---------- */
  const hex = (h) => { const n = parseInt((h || '#000000').slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const NO_AUDIO = { bass: 0, mid: 0, treble: 0, level: 0, spec: new Array(32).fill(0) };

  PM.Renderer = class {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = (this.gl = canvas.getContext('webgl', { alpha: false, antialias: true }));
      if (!gl) throw new Error('WebGL is not available in this browser.');
      this.programs = {};
      this.meshes = new Map();
      this.textures = new Map();
      this.shown = null;
      this.fade = 1;
      this.last = 0;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      this.fullQuad = { id: '__full', cols: 2, rows: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]] };
      PM.store.onMessage((m) => { if (m.t === 'media') this.forgetMissing(); });
    }
    program(name) {
      if (this.programs[name]) return this.programs[name];
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, PM.VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, PM.FRAG_HEAD + PM.SHADERS[name] + PM.FRAG_MAIN));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
      const u = {};
      for (const n of ['uTime', 'uOpacity', 'uSpeed', 'uScale', 'uReact', 'uFeather', 'uBright', 'uAspect', 'uAudio', 'uA', 'uB', 'uC', 'uSpec', 'uTex', 'uFlip', 'uBrick']) {
        u[n] = gl.getUniformLocation(p, n === 'uSpec' ? 'uSpec[0]' : n);
      }
      return (this.programs[name] = { p, u, aPos: gl.getAttribLocation(p, 'aPos'), aUv: gl.getAttribLocation(p, 'aUv') });
    }
    mesh(s) {
      const gl = this.gl;
      const sig = this.canvas.width + '/' + this.canvas.height + '/' + s.cols + 'x' + s.rows + ':' + s.points.map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');
      let m = this.meshes.get(s.id);
      if (m && m.sig === sig) return m;
      if (!m) { m = { vbo: gl.createBuffer(), ibo: gl.createBuffer() }; this.meshes.set(s.id, m); }
      const sub = s.cols === 2 && s.rows === 2 ? 24 : 10;
      const nu = (s.cols - 1) * sub, nv = (s.rows - 1) * sub, ev = geom.evaluator(s);
      const verts = new Float32Array((nu + 1) * (nv + 1) * 4);
      let k = 0;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv, p = ev(u, v);
        verts[k++] = p[0]; verts[k++] = p[1]; verts[k++] = u; verts[k++] = v;
      }
      const idx = new Uint16Array(nu * nv * 6);
      k = 0;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      m.sig = sig; m.count = idx.length;
      const P = s.points, C = s.cols, R = s.rows, W = this.canvas.width, Hh = this.canvas.height;
      const len = (a, b) => Math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * Hh);
      const tl = P[0], tr = P[C - 1], bl = P[(R - 1) * C], br = P[R * C - 1];
      m.aspect = (len(tl, tr) + len(bl, br)) / Math.max(1, len(tl, bl) + len(tr, br));
      return m;
    }
    newTexture() {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    }
    upload(e, src) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); e.ready = true; } catch (err) { /* frame not decodable yet */ }
    }
    /* Image / video texture from the media library. Returns null until ready. */
    mediaTex(id) {
      let e = this.textures.get(id);
      if (!e) {
        e = { tex: this.newTexture(), ready: false, state: 'loading', video: null };
        this.textures.set(id, e);
        PM.media.get(id).then((rec) => {
          if (!rec) { e.state = 'missing'; return; }
          const url = URL.createObjectURL(rec.blob);
          if ((rec.type || '').startsWith('video')) {
            const v = document.createElement('video');
            v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.src = url;
            v.play().catch(() => {});
            e.video = v; e.state = 'ready';
          } else {
            const im = new Image();
            im.onload = () => { this.upload(e, im); e.state = 'ready'; };
            im.onerror = () => { e.state = 'missing'; };
            im.src = url;
          }
        }).catch(() => { e.state = 'missing'; });
      }
      e.used = this.frame;
      if (e.video) {
        if (e.video.paused) e.video.play().catch(() => {});
        if (e.video.readyState >= 2 && e.stamp !== this.frame) { this.upload(e, e.video); e.stamp = this.frame; }
      }
      return e.ready ? e : null;
    }
    widgetTex(s, content, project) {
      const w = PM.widgets.get(s.id, content, project), key = 'w:' + s.id + ':' + content.type;
      let e = this.textures.get(key);
      if (!e) { e = { tex: this.newTexture(), ready: false, ver: -1 }; this.textures.set(key, e); }
      if (e.ver !== w.ver) { this.upload(e, w.canvas); e.ver = w.ver; }
      e.used = this.frame;
      return e.ready ? e : null;
    }
    forgetMissing() {
      for (const [k, e] of this.textures) if (e.state === 'missing') { this.gl.deleteTexture(e.tex); this.textures.delete(k); }
      PM.widgets.forgetMedia();
    }
    mediaState(id) { const e = this.textures.get(id); return e ? e.state : 'loading'; }
    draw(s, c, env) {
      const gl = this.gl;
      let name = 'solid', tex = null;
      if (c.type === 'none') return;
      if (c.type === 'grid') name = 'grid';
      else if (c.type === 'effect') name = PM.SHADERS[c.effect] ? c.effect : 'mood';
      else if (c.type === 'media') { if (!c.mediaId) return; tex = this.mediaTex(c.mediaId); if (!tex) return; name = 'tex'; }
      else if (c.type === 'clock' || c.type === 'weather' || c.type === 'slideshow') { tex = this.widgetTex(s, c, env.project); if (!tex) return; name = 'tex'; }
      const pr = this.program(name), m = this.mesh(s), u = pr.u, a = env.audio;
      gl.useProgram(pr.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.enableVertexAttribArray(pr.aPos); gl.vertexAttribPointer(pr.aPos, 2, gl.FLOAT, false, 16, 0);
      if (pr.aUv >= 0) { gl.enableVertexAttribArray(pr.aUv); gl.vertexAttribPointer(pr.aUv, 2, gl.FLOAT, false, 16, 8); }
      gl.uniform1f(u.uTime, env.time);
      gl.uniform1f(u.uOpacity, c.opacity);
      gl.uniform1f(u.uSpeed, c.speed);
      gl.uniform1f(u.uScale, Math.max(0.05, c.scale));
      gl.uniform1f(u.uReact, c.react);
      gl.uniform1f(u.uFeather, c.feather);
      gl.uniform1f(u.uBright, env.bright);
      gl.uniform1f(u.uAspect, m.aspect || 1);
      gl.uniform4f(u.uAudio, a.bass, a.mid, a.treble, a.level);
      gl.uniform3fv(u.uA, hex(c.type === 'color' ? c.color : c.colorA));
      gl.uniform3fv(u.uB, hex(c.colorB));
      gl.uniform3fv(u.uC, hex(c.colorC));
      if (u.uSpec) gl.uniform1fv(u.uSpec, a.spec);
      gl.uniform2f(u.uFlip, c.flipH ? 1 : 0, c.flipV ? 1 : 0);
      if (u.uBrick) gl.uniform4f(u.uBrick, c.bricksX || 8, c.bricksY || 12, c.brickShift ? 1 : 0, c.brickGuide ? 1 : 0);
      if (tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.tex); gl.uniform1i(u.uTex, 0); }
      gl.blendFunc(gl.ONE, c.blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    }
    render(project, audio) {
      const gl = this.gl, now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame = (this.frame || 0) + 1;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const st = project.settings;
      // Scene changes fade through black.
      if (this.shown === null || !project.scenes.some((s) => s.id === this.shown)) { this.shown = project.activeScene; this.fade = 1; }
      if (this.shown !== project.activeScene) { this.fade -= dt / 0.25; if (this.fade <= 0) { this.fade = 0; this.shown = project.activeScene; } }
      else if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.25);
      if (!st.blackout) {
        const env = { project, audio: audio || NO_AUDIO, time: (Date.now() % 3600000) / 1000, bright: st.brightness * this.fade };
        gl.enable(gl.BLEND);
        if (st.testPattern) {
          env.bright = st.brightness;
          this.draw(this.fullQuad, Object.assign(PM.defaultContent('grid')), env);
        } else {
          const scene = project.scenes.find((s) => s.id === this.shown);
          for (const s of project.surfaces) {
            const c = scene && scene.contents[s.id];
            if (s.visible && c) this.draw(s, c, env);
          }
        }
      }
      // Pause videos that are no longer on screen; drop meshes of deleted surfaces.
      if (this.frame % 60 === 0) {
        for (const e of this.textures.values()) if (e.video && e.used < this.frame - 30 && !e.video.paused) e.video.pause();
        for (const [id, m] of this.meshes) {
          if (id !== '__full' && !project.surfaces.some((s) => s.id === id)) { gl.deleteBuffer(m.vbo); gl.deleteBuffer(m.ibo); this.meshes.delete(id); }
        }
      }
    }
  };

  /* ---------- Overlay: masks (always) + alignment guides ---------- */
  function path(ctx, pts, X, Y) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.closePath();
  }
  /* view: { x, y, w, h, editor, guides, draft }  ui: { selType, selId, selPoint } */
  PM.drawOverlay = function (ctx, project, ui, view) {
    const X = (x) => view.x + x * view.w, Y = (y) => view.y + y * view.h;
    const masks = project.masks.filter((m) => m.visible && m.points.length >= 3);
    const dim = view.editor ? 'rgba(0,0,0,0.6)' : '#000';
    const windows = masks.filter((m) => m.mode === 'window');
    if (!project.settings.testPattern || view.editor) {
      if (windows.length) {
        ctx.fillStyle = dim;
        ctx.fillRect(view.x, view.y, view.w, view.h);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = '#000';
        for (const m of windows) { path(ctx, m.points, X, Y); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.fillStyle = dim;
      for (const m of masks) if (m.mode !== 'window') { path(ctx, m.points, X, Y); ctx.fill(); }
    }
    if (!view.guides) return;
    const big = view.editor ? 1 : Math.max(1.5, view.w / 900);
    ctx.lineJoin = 'round';
    for (const s of project.surfaces) {
      if (!s.visible) continue;
      const sel = ui.selType === 'surface' && ui.selId === s.id;
      const ev = PM.geom.evaluator(s);
      ctx.strokeStyle = sel ? '#ffd23f' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = (sel ? 1.5 : 1) * big;
      if (!sel) { path(ctx, PM.geom.outline(s), X, Y); ctx.stroke(); continue; }
      const n = 10;
      ctx.beginPath();
      for (let r = 0; r < s.rows; r++) for (let i = 0; i <= (s.cols - 1) * n; i++) {
        const p = ev(i / ((s.cols - 1) * n), r / (s.rows - 1));
        if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1]));
      }
      for (let c = 0; c < s.cols; c++) for (let i = 0; i <= (s.rows - 1) * n; i++) {
        const p = ev(c / (s.cols - 1), i / ((s.rows - 1) * n));
        if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1]));
      }
      ctx.stroke();
      s.points.forEach((p, i) => handle(ctx, X(p[0]), Y(p[1]), ui.selPoint === i, big, '#ffd23f'));
    }
    for (const m of project.masks) {
      if (!m.visible) continue;
      const sel = ui.selType === 'mask' && ui.selId === m.id;
      if (!view.editor && !sel) continue;
      ctx.strokeStyle = m.mode === 'window' ? '#3ddc84' : '#ff5fa2';
      ctx.lineWidth = (sel ? 2 : 1) * big;
      ctx.setLineDash(sel ? [] : [5, 4]);
      path(ctx, m.points, X, Y); ctx.stroke();
      ctx.setLineDash([]);
      if (sel) m.points.forEach((p, i) => handle(ctx, X(p[0]), Y(p[1]), ui.selPoint === i, big, ctx.strokeStyle));
    }
    if (view.draft && view.draft.length) {
      ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = 2;
      ctx.beginPath();
      view.draft.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
      if (view.cursor) ctx.lineTo(X(view.cursor[0]), Y(view.cursor[1]));
      ctx.stroke();
      view.draft.forEach((p, i) => handle(ctx, X(p[0]), Y(p[1]), i === 0, 1, '#ff5fa2'));
    }
  };
  function handle(ctx, x, y, selected, big, color) {
    const r = (selected ? 7 : 5) * big;
    if (selected) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = big;
      ctx.beginPath();
      ctx.moveTo(x - r * 4, y); ctx.lineTo(x - r * 1.4, y); ctx.moveTo(x + r * 1.4, y); ctx.lineTo(x + r * 4, y);
      ctx.moveTo(x, y - r * 4); ctx.lineTo(x, y - r * 1.4); ctx.moveTo(x, y + r * 1.4); ctx.lineTo(x, y + r * 4);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? '#fff' : color; ctx.fill();
    ctx.lineWidth = 1.5 * big; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.strokeStyle = color;
  }
})();

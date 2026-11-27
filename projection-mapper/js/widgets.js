/* Ambient widgets drawn to 2D canvases and used as textures: clock, weather, slideshow. */
(function () {
  const PM = (window.PM = window.PM || {});
  const items = new Map();
  const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

  function make(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    return { canvas, ctx: canvas.getContext('2d'), ver: 0, sig: '' };
  }

  /* ---------- Clock ---------- */
  function clock(it, c) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    let h = d.getHours(), suffix = '';
    if (!c.h24) { suffix = h < 12 ? ' AM' : ' PM'; h = h % 12 || 12; }
    let time = (c.h24 ? pad(h) : h) + ':' + pad(d.getMinutes());
    if (c.seconds) time += ':' + pad(d.getSeconds());
    const date = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const sig = [time, suffix, c.date ? date : '', c.colorA].join('|');
    if (sig === it.sig) return;
    it.sig = sig; it.ver++;
    const { ctx, canvas } = it;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = c.colorA; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = c.seconds ? 210 : 280;
    ctx.font = `600 ${size}px ${FONT}`;
    const full = time + suffix;
    const w = ctx.measureText(full).width;
    if (w > canvas.width * 0.92) { size *= (canvas.width * 0.92) / w; ctx.font = `600 ${size}px ${FONT}`; }
    ctx.fillText(full, canvas.width / 2, c.date ? 220 : 256);
    if (c.date) { ctx.font = `400 60px ${FONT}`; ctx.fillText(date, canvas.width / 2, 420); }
  }

  /* ---------- Weather (Open-Meteo, no key needed) ---------- */
  const wx = { key: '', at: 0, data: null, error: '', busy: false };
  const WMO = [
    [0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Cloudy'], [48, 'Fog'], [57, 'Drizzle'],
    [67, 'Rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorm'],
  ];
  const describe = (code) => (WMO.find((w) => code <= w[0]) || WMO[WMO.length - 1])[1];
  function fetchWeather(s) {
    const key = [s.lat, s.lon, s.units].join(',');
    if (s.lat == null || wx.busy) return;
    if (key === wx.key && Date.now() - wx.at < 15 * 60e3) return;
    wx.busy = true; wx.key = key; wx.at = Date.now();
    const unit = s.units === 'f' ? '&temperature_unit=fahrenheit' : '';
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto${unit}`)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => {
        wx.data = {
          temp: Math.round(j.current.temperature_2m),
          text: describe(j.current.weather_code),
          hi: Math.round(j.daily.temperature_2m_max[0]),
          lo: Math.round(j.daily.temperature_2m_min[0]),
        };
        wx.error = '';
      })
      .catch(() => { wx.error = 'Weather unavailable'; wx.at = Date.now() - 13 * 60e3; })
      .finally(() => { wx.busy = false; });
  }
  PM.geocode = async function (name) {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(name));
    if (!r.ok) throw new Error('Lookup failed');
    const j = await r.json();
    if (!j.results || !j.results.length) throw new Error('Place not found');
    const p = j.results[0];
    return { place: p.name + (p.country_code ? ', ' + p.country_code : ''), lat: p.latitude, lon: p.longitude };
  };
  function weather(it, c, project) {
    const s = project.settings.weather;
    fetchWeather(s);
    const d = wx.data;
    const sig = [s.place, s.lat, d ? d.temp + d.text + d.hi + d.lo : wx.error, c.colorA].join('|');
    if (sig === it.sig) return;
    it.sig = sig; it.ver++;
    const { ctx, canvas } = it;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = c.colorA; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cx = canvas.width / 2;
    if (s.lat == null) { ctx.font = `400 56px ${FONT}`; ctx.fillText('Set a location', cx, 256); return; }
    if (!d) { ctx.font = `400 56px ${FONT}`; ctx.fillText(wx.error || 'Loading weather…', cx, 256); return; }
    ctx.font = `600 230px ${FONT}`; ctx.fillText(d.temp + '°', cx, 170);
    ctx.font = `400 70px ${FONT}`; ctx.fillText(d.text, cx, 335);
    ctx.font = `400 46px ${FONT}`; ctx.globalAlpha = 0.75;
    ctx.fillText(`${s.place}  ·  H ${d.hi}°  L ${d.lo}°`, cx, 430);
    ctx.globalAlpha = 1;
  }

  /* ---------- Slideshow ---------- */
  const imgs = new Map();
  function img(id) {
    let e = imgs.get(id);
    if (!e) {
      e = { img: null, state: 'loading' };
      imgs.set(id, e);
      PM.media.get(id).then((rec) => {
        if (!rec) { e.state = 'missing'; return; }
        const im = new Image();
        im.onload = () => { e.img = im; e.state = 'ready'; };
        im.onerror = () => { e.state = 'missing'; };
        im.src = URL.createObjectURL(rec.blob);
      }).catch(() => { e.state = 'missing'; });
    }
    return e;
  }
  function cover(ctx, im, W, H, alpha) {
    const s = Math.max(W / im.width, H / im.height);
    const w = im.width * s, h = im.height * s;
    ctx.globalAlpha = alpha;
    ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
    ctx.globalAlpha = 1;
  }
  function slideshow(it, c) {
    const ready = (c.mediaIds || []).map(img).filter((e) => e.state === 'ready');
    const { ctx, canvas } = it;
    if (!ready.length) {
      if (it.sig !== 'empty') { it.sig = 'empty'; it.ver++; ctx.clearRect(0, 0, canvas.width, canvas.height); }
      return;
    }
    const period = Math.max(2, c.interval || 8) * 1000;
    const now = Date.now();
    const k = Math.floor(now / period);
    const t = Math.min(1, (now % period) / 1000);
    const cur = ready[k % ready.length], prev = ready[(k + ready.length - 1) % ready.length];
    const sig = [k, ready.length, t < 1 ? t : 1].join('|');
    if (sig === it.sig) return;
    it.sig = sig; it.ver++;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (t < 1 && ready.length > 1) cover(ctx, prev.img, canvas.width, canvas.height, 1);
    cover(ctx, cur.img, canvas.width, canvas.height, ready.length > 1 ? t : 1);
  }

  PM.widgets = {
    /* Returns { canvas, ver } kept up to date for this frame. */
    get(surfaceId, content, project) {
      const key = surfaceId + ':' + content.type;
      let it = items.get(key);
      if (!it) { it = content.type === 'slideshow' ? make(1280, 720) : make(1024, 512); items.set(key, it); }
      if (content.type === 'clock') clock(it, content);
      else if (content.type === 'weather') weather(it, content, project);
      else slideshow(it, content);
      return it;
    },
    forgetMedia() { imgs.clear(); },
  };
})();

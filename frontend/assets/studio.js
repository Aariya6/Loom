/* LOOM studio core: state, transport, audio assets, piano roll, inspector, project I/O, import/export.
   studio-views.js adds the Steps, Arrange and Mixer views and the chord palette through window.LoomApp. */
(() => {
'use strict';
const A = window.LoomAudio, GN = window.LoomGen;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = v => Math.round(v * 10000) / 10000;
const NN = GN.NN;
const noteName = p => NN[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
const isBlack = p => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const uid = () => 'x' + Math.random().toString(36).slice(2, 9);
const SCALES = { 'Chromatic (off)': null, Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Mixolydian: [0, 2, 4, 5, 7, 9, 10], 'Pentatonic Major': [0, 2, 4, 7, 9], 'Pentatonic Minor': [0, 3, 5, 7, 10], Blues: [0, 3, 5, 6, 7, 10] };
const SNAPS = [['1 bar', 4], ['1/2 bar', 2], ['1/4 (beat)', 1], ['1/8', .5], ['1/8 triplet', 1 / 3], ['1/16', .25], ['1/16 triplet', 1 / 6], ['1/32', .125]];
const BAR_OPTIONS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48, 52, 56, 60, 64];
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
const DRUM_KEYS = [36, 37, 38, 39, 41, 45, 42, 46, 70, 51, 49];
const DRUM_ABBR = { 36: 'Kk', 37: 'Rm', 38: 'Sn', 39: 'Cp', 41: 'LT', 45: 'HT', 42: 'CH', 46: 'OH', 51: 'Rd', 49: 'Cr', 54: 'Tb', 56: 'Cb', 62: 'Cg', 64: 'cg', 70: 'Sh', 75: 'Cl' };
const LAYERABLE = [...A.ELEMENTS.mids.instruments, ...A.ELEMENTS.bass.instruments, ...A.ELEMENTS.vox.instruments.filter(i => i !== 'Audio Clips')];
const KEYW = 72, RULER = 24;

/* ---------- state ---------- */
let project = null, S = null, cur = 0, dirty = false, projects = [];
const sel = new Set();
const ui = { lane: 'velocity', view: 'roll', tool: 'draw', snap: .25, ppb: 48, lastLen: .25, rec: false, metro: false, octave: 4, pressed: null, follow: true, cursor: 0, clipSel: null, groups: {}, chords: true };
const DATA = { genres: [], structures: {}, beats: [] };
const undo = [], redo = [];
let clipboard = [];
const T = { ctx: null, G: null, playing: false, anchors: [], sched: 0, pos: 0, timer: 0, jump: false };
const hooks = { refresh: [], change: [], frame: [], view: [], browse: [], help: [], conflict: [], history: [] }, keyHandlers = [];
const on = (ev, fn) => hooks[ev].push(fn), emit = (ev, ...a) => hooks[ev].forEach(f => f(...a));

const track = () => S.tracks[cur];
const spb = () => 60 / S.tempo;
const total = () => S.bars * 4;
const envOf = () => ({ tempo: S.tempo, anySolo: S.tracks.some(t => t.solo), samples: S.master.samples !== false });
const isAudioTrack = t => t.instrument === 'Audio Clips';
const clipEnd = c => c.start + c.len / (c.rate || 1) / spb();

/* ---------- state construction ---------- */
function baseParams(instrument, extra) { return { ...A.BASE_PARAMS, ...(A.INSTRUMENT_DEFAULTS[instrument] || {}), ...(extra || {}) }; }
function newTrack(element, instrument, name, notes = [], params = {}, extra = {}) {
  return { id: uid(), name, element, instrument, notes, clips: [], layer: null, auto: {}, role: extra.role || null, params: baseParams(instrument, params), mute: false, solo: false };
}
function guessElement(instr) {
  const s = String(instr || '').toLowerCase();
  if (s.includes('drum') || s.includes('kit')) return 'drums';
  if (s.includes('bass')) return 'bass';
  if (/vox|voice|choir|mic/.test(s)) return 'vox';
  return 'mids';
}
const cleanNotes = list => (Array.isArray(list) ? list : []).filter(n => n && Number.isFinite(+n.pitch) && Number.isFinite(+n.start)).map(n => ({
  pitch: clamp(Math.round(+n.pitch), 0, 127), start: Math.max(0, r4(+n.start)), duration: Math.max(.03, r4(+n.duration || .25)), velocity: clamp(n.velocity == null ? .75 : +n.velocity, .02, 1),
}));
const AUTO_KEYS = Object.keys(A.AUTO_PARAMS);
const cleanAuto = a => {
  const out = {}; if (!a || typeof a !== 'object') return out;
  AUTO_KEYS.forEach(k => {
    const def = A.AUTO_PARAMS[k], list = Array.isArray(a[k]) ? a[k] : [];
    const pts = list.filter(p => p && Number.isFinite(+p.t) && Number.isFinite(+p.v)).slice(0, 400).map(p => ({ t: clamp(r4(+p.t), 0, 256), v: clamp(r4(+p.v), def.min, def.max) })).sort((x, y) => x.t - y.t);
    if (pts.length) out[k] = pts;
  });
  return out;
};
const cleanClip = c => c && Number.isFinite(+c.asset) && +c.len > .02 ? {
  id: c.id || uid(), asset: +c.asset, name: String(c.name || 'audio').slice(0, 80), start: Math.max(0, r4(+c.start || 0)), offset: Math.max(0, +c.offset || 0), len: clamp(+c.len, .02, 3600),
  gain: clamp(c.gain == null ? 1 : +c.gain, 0, 2), fadeIn: clamp(+c.fadeIn || 0, 0, 30), fadeOut: clamp(+c.fadeOut || 0, 0, 30), rate: clamp(+c.rate || 1, .25, 4), warp: !!c.warp,
} : null;
function normalize(st) {
  st = st && typeof st === 'object' ? st : {};
  const out = { tempo: clamp(+st.tempo || 96, 30, 240), swing: clamp(+st.swing || 0, 0, 1) };
  let root = Number.isInteger(st.keyRoot) ? st.keyRoot : 0, scale = SCALES.hasOwnProperty(st.scale) ? st.scale : 'Chromatic (off)';
  if (st.keyRoot === undefined && typeof st.key === 'string') {
    const m = st.key.match(/^([A-G])([#b]?)\s*(major|minor)?/i);
    if (m) { root = (NN.indexOf(m[1].toUpperCase()) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12; scale = /minor/i.test(m[3] || '') ? 'Minor' : /major/i.test(m[3] || '') ? 'Major' : scale; }
  }
  out.keyRoot = ((root % 12) + 12) % 12; out.scale = scale; out.key = NN[out.keyRoot] + ' ' + scale.toLowerCase();
  out.tracks = (Array.isArray(st.tracks) ? st.tracks : []).slice(0, 24).map(t => {
    const element = A.ELEMENTS[t.element] ? t.element : guessElement(t.instrument);
    const list = A.ELEMENTS[element].instruments, legacy = t.instrument === 'Mic Recorder' ? 'Audio Clips' : t.instrument;
    const instrument = list.includes(legacy) ? legacy : list[0];
    const ly = t.layer && LAYERABLE.includes(t.layer.instrument) ? { instrument: t.layer.instrument, volume: clamp(t.layer.volume == null ? .6 : +t.layer.volume, 0, 1), shift: clamp(Math.round(+t.layer.shift || 0), -24, 24) } : null;
    return { id: t.id || uid(), name: String(t.name || A.ELEMENTS[element].label).slice(0, 40), element, instrument, notes: cleanNotes(t.notes), clips: (Array.isArray(t.clips) ? t.clips : []).map(cleanClip).filter(Boolean).slice(0, 60), layer: element === 'drums' ? null : ly, role: typeof t.role === 'string' ? t.role : null, auto: cleanAuto(t.auto), params: baseParams(instrument, t.params), mute: !!t.mute, solo: !!t.solo };
  });
  if (!out.tracks.length) out.tracks.push(newTrack('mids', 'Soft Keys', 'Mids 1'));
  const maxEnd = Math.max(0, ...out.tracks.flatMap(t => [...t.notes.map(n => n.start + n.duration), ...t.clips.map(c => c.start + c.len / c.rate / (60 / out.tempo))]));
  out.bars = BAR_OPTIONS.includes(+st.bars) ? +st.bars : BAR_OPTIONS.find(b => b * 4 >= maxEnd && b >= 4) || 64;
  const lp = st.loop || {};
  out.loop = { on: !!lp.on, start: clamp(+lp.start || 0, 0, out.bars * 4 - .25), end: clamp(+lp.end || out.bars * 4, .25, out.bars * 4) };
  if (out.loop.end <= out.loop.start) out.loop = { on: false, start: 0, end: out.bars * 4 };
  const m = st.master || {};
  out.master = { gain: clamp(m.gain == null ? .8 : +m.gain, 0, 1), reverb: clamp(m.reverb == null ? .6 : +m.reverb, 0, 1), comp: m.comp !== false, samples: m.samples !== false };
  out.markers = (Array.isArray(st.markers) ? st.markers : []).filter(m => m && Number.isFinite(+m.beat)).map(m => ({ beat: clamp(r4(+m.beat), 0, out.bars * 4), name: String(m.name || 'Section').slice(0, 30) })).slice(0, 64);
  out.genre = st.genre && typeof st.genre.id === 'string' ? { id: st.genre.id.slice(0, 40), seed: +st.genre.seed || 1 } : null;
  out.lyrics = (Array.isArray(st.lyrics) ? st.lyrics : []).filter(l => l && Number.isFinite(+l.t) && typeof l.text === 'string').slice(0, 400).map(l => ({ t: clamp(r4(+l.t), 0, 256), text: l.text.slice(0, 160), stanza: Math.max(1, Math.round(+l.stanza) || 1) })).sort((a, b) => a.t - b.t);
  out.poem = st.poem && typeof st.poem.text === 'string' ? { text: st.poem.text.slice(0, 12000), mood: String(st.poem.mood || '').slice(0, 40), wpm: clamp(+st.poem.wpm || 105, 50, 220) } : null;
  return out;
}
function blankState() {
  return normalize({ tempo: 96, bars: 8, tracks: [newTrack('drums', 'Acoustic Kit', 'Drums 1'), newTrack('bass', 'Synth Bass', 'Bass 1'), newTrack('mids', 'Soft Keys', 'Mids 1'), newTrack('vox', 'Choir Ahh', 'Vox 1', [], { reverb: .3 }), newTrack('fx', 'Riser', 'Effects 1', [], { reverb: .3 })] });
}
function fromPlan(plan, keepTracks = [], extra = {}) {
  const tracks = plan.tracks.map(t => newTrack(t.element, t.instrument, t.name, t.notes, t.params, { role: t.role }));
  return normalize({ tempo: plan.tempo, swing: plan.swing, keyRoot: plan.keyRoot, scale: plan.scale, bars: plan.bars, markers: plan.markers, genre: plan.genre, tracks: [...tracks, ...keepTracks], ...extra });
}
function starterState() {
  const g = DATA.genres.find(x => x.id === 'lofi') || DATA.genres[0];
  return g ? fromPlan(GN.generate(g, DATA.structures, DATA.beats, 1)) : blankState();
}

/* ---------- undo / dirty ---------- */
const snapshot = () => JSON.stringify(S);
function pushUndo() { undo.push(snapshot()); if (undo.length > 100) undo.shift(); redo.length = 0; syncUndoButtons(); }
function syncUndoButtons() { $('#undoBtn').disabled = !undo.length; $('#redoBtn').disabled = !redo.length; }
function applySnapshot(str) {
  const id = track()?.id;
  S = normalize(JSON.parse(str)); project.state = S;
  cur = Math.max(0, S.tracks.findIndex(t => t.id === id)); sel.clear(); ui.clipSel = null;
  if (T.G) { A.applyMaster(T.G, S.master); applyAllBuses(); }
  fullRefresh(); markDirty();
}
function doUndo() { if (!undo.length) return; redo.push(snapshot()); applySnapshot(undo.pop()); syncUndoButtons(); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); applySnapshot(redo.pop()); syncUndoButtons(); }
function markDirty() { dirty = true; $('#dirtyDot').hidden = false; }
let sliderSnap = false;
const sliderUndo = () => { if (!sliderSnap) { pushUndo(); sliderSnap = true; } };
document.addEventListener('change', () => { sliderSnap = false; }, true);
document.addEventListener('pointerup', () => { sliderSnap = false; }, true);

/* ---------- audio assets (vocals, loops) ---------- */
const assets = new Map(), pending = new Map();
function peaksOf(buf) {
  const ch = buf.getChannelData(0), n = 1200, step = Math.max(1, Math.floor(ch.length / n)), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) { const a = Math.abs(ch[j]); if (a > m) m = a; } out[i] = m; }
  return out;
}
const getBuffer = id => assets.get(id)?.buffer || null;
const getAsset = id => assets.get(id) || null;
async function fetchAsset(id) {
  if (assets.has(id)) return assets.get(id);
  if (pending.has(id)) return pending.get(id);
  const p = (async () => {
    const r = await fetch(`/api/projects/${project.id}/audio/${id}`, { credentials: 'include' });
    if (!r.ok) throw new Error('missing audio ' + id);
    const buffer = await ensureAudio().decodeAudioData(await r.arrayBuffer());
    const a = { buffer, peaks: peaksOf(buffer) }; assets.set(id, a); return a;
  })().finally(() => pending.delete(id));
  pending.set(id, p); return p;
}
async function uploadAsset(blob, name, video = false) {
  const fd = new FormData(); fd.append('file', blob, name); fd.append('video', video ? 'true' : 'false');
  const r = await fetch(`/api/projects/${project.id}/audio`, { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrf }, credentials: 'include' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || 'Upload failed (' + r.status + ')');
  return d;
}
async function addAudioFile(file, { track: tIdx = cur, start = null } = {}) {
  if (file.size > 12 * 1024 * 1024) { toast(`${file.name}: files are limited to 12 MB`); return null; }
  const bytes = await file.arrayBuffer();
  let buffer; try { buffer = await ensureAudio().decodeAudioData(bytes.slice(0)); } catch (e) { toast(`${file.name}: this browser could not decode that audio`); return null; }
  let d; try { d = await uploadAsset(file, file.name); } catch (e) { toast(e.message); return null; }
  assets.set(d.id, { buffer, peaks: peaksOf(buffer) });
  pushUndo();
  let t = S.tracks[tIdx];
  if (!t || !isAudioTrack(t)) { t = newTrack('vox', 'Audio Clips', file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Audio', [], { reverb: .2 }); S.tracks.push(t); cur = S.tracks.length - 1; }
  const clip = { id: uid(), asset: d.id, name: file.name.slice(0, 80), start: start == null ? Math.max(0, snapRound(T.playing ? beatNow() : ui.cursor)) : start, offset: 0, len: buffer.duration, gain: 1, fadeIn: 0, fadeOut: 0, rate: 1 };
  ensureBars(clipEnd(clip)); t.clips.push(clip); ui.clipSel = { tid: t.id, cid: clip.id };
  markDirty(); fullRefresh(); toast(`Added "${file.name}" to ${t.name}`);
  return clip;
}
async function addAudioFiles(files, opts) { for (const f of files) await addAudioFile(f, opts); }
function encodeWavMono(buf) {
  const n = buf.length, ch = buf.numberOfChannels, out = new DataView(new ArrayBuffer(44 + n * 2)), sr = buf.sampleRate, data = [];
  for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += data[c][i]; out.setInt16(44 + i * 2, clamp(v / ch, -1, 1) * 32767, true); }
  return new Blob([out], { type: 'audio/wav' });
}
function findClip(sel2 = ui.clipSel) {
  if (!sel2) return null; const t = S.tracks.find(x => x.id === sel2.tid), c = t && t.clips.find(x => x.id === sel2.cid);
  return c ? { t, c } : null;
}
function ensureBars(endBeat) {
  let bars = S.bars; while (bars * 4 < endBeat - 1e-6 && bars < 64) bars = BAR_OPTIONS.find(b => b > bars);
  if (bars * 4 < endBeat - 1e-6) { toast('The song is at its 64-bar limit.'); return false; }
  if (bars !== S.bars) { S.bars = bars; syncTopbar(); resizeAll(); }
  return true;
}
// Time-stretched copies are computed in the background the first time a clip needs one.
function requestWarp(c) {
  if (!(c.warp && c.rate && c.rate !== 1) || A.warpReady(c)) return; const b = getBuffer(c.asset); if (!b) return;
  A.warpEnsure(c, b).then(() => { requestDraw(); const st = $('#warpNote'); if (st) st.textContent = ''; }).catch(() => toast('Could not time-stretch that clip.'));
  const st = $('#warpNote'); if (st) st.textContent = 'stretching…';
}
function splitSelClip() {
  const f = findClip(); if (!f) { toast('Select a clip in Arrange first.'); return; }
  const { t, c } = f, b = beatNow();
  if (b <= c.start + .02 || b >= clipEnd(c) - .02) { toast('Put the playhead inside the clip to split it.'); return; }
  pushUndo(); const secIn = (b - c.start) * spb() * (c.rate || 1);
  const right = { ...c, id: uid(), start: r4(b), offset: c.offset + secIn, len: c.len - secIn, fadeIn: 0 };
  c.len = secIn; c.fadeOut = 0; t.clips.push(right); ui.clipSel = { tid: t.id, cid: right.id }; markDirty(); fullRefresh();
}
function deleteSelClip() { const f = findClip(); if (!f) return false; pushUndo(); f.t.clips = f.t.clips.filter(x => x !== f.c); ui.clipSel = null; markDirty(); fullRefresh(); toastUndo(`Deleted clip “${f.c.name}”`); return true; }
function duplicateSelClip() {
  const f = findClip(); if (!f) return; pushUndo();
  const c = { ...f.c, id: uid(), start: r4(clipEnd(f.c)) }; if (!ensureBars(clipEnd(c))) return;
  f.t.clips.push(c); ui.clipSel = { tid: f.t.id, cid: c.id }; markDirty(); fullRefresh();
}

/* ---------- audio / transport ---------- */
function ensureAudio() {
  if (!T.ctx) { T.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); T.G = A.makeGraph(T.ctx); A.applyMaster(T.G, S.master); }
  if (T.ctx.state !== 'running') T.ctx.resume();
  return T.ctx;
}
// Recorded samples: load what this project uses in the background; until then the synth voices play.
function usedSounds() { return [...new Set(S.tracks.flatMap(t => [t.instrument, t.layer && t.layer.instrument]).filter(Boolean))]; }
let sampleToken = 0;
async function refreshSamples() {
  const token = ++sampleToken, st = $('#sampleStatus'); if (!st) return;
  if (S.master.samples === false) { st.textContent = 'synth only'; return; }
  await A.loadManifest(); const names = usedSounds().filter(n => A.hasSamples(n)); if (!names.length) { st.textContent = 'no sampled sounds in use'; return; }
  const todo = names.filter(n => !A.samplesReady(n)); if (!todo.length) { st.textContent = `${names.length} sampled sound${names.length > 1 ? 's' : ''} ready`; return; }
  st.textContent = `loading ${todo.length} recorded sound${todo.length > 1 ? 's' : ''}…`;
  await A.loadSamples(names); if (token === sampleToken) st.textContent = `${names.filter(n => A.samplesReady(n)).length} sampled sound${names.length > 1 ? 's' : ''} ready`;
}
function applyAllBuses() { if (!T.G) return; const e = envOf(); S.tracks.forEach(t => A.applyBus(T.G, t, e)); }
function beatNow() {
  if (!T.playing) return T.pos;
  const now = T.ctx.currentTime; let a = T.anchors[0];
  for (const x of T.anchors) if (x.t0 <= now) a = x;
  return Math.max(0, a.b0 + (now - a.t0) / spb());
}
function scheduleRange(a, from, to, jump) {
  const sp = spb(), e = envOf(), G = T.G, now = T.ctx.currentTime;
  const at = b => Math.max(now, a.t0 + (A.swingTime(b, S.swing) - a.b0) * sp);
  S.tracks.forEach(t => {
    A.scheduleAuto(G, t, e, from, to, b => a.t0 + (b - a.b0) * sp, jump);
    if (t.mute || (e.anySolo && !t.solo)) return;
    if (!isAudioTrack(t)) for (const n of t.notes) if (n.start >= from && n.start < to) A.playNote(G, t, n, at(n.start), n.duration * sp * .98, e);
    for (const c of t.clips) {
      const src = A.clipSource(c, getBuffer); if (!src) { requestWarp(c); continue; }
      if (c.start >= from && c.start < to) A.playClip(G, t, src.clip, src.buf, at(c.start), e, 0);
      else if (jump && c.start < from && clipEnd(c) > from) A.playClip(G, t, src.clip, src.buf, Math.max(now, a.t0 + (from - a.b0) * sp), e, (from - c.start) * sp);
    }
  });
  if (ui.metro) for (let b = Math.ceil(from - 1e-9); b < to; b++) A.click(G, Math.max(now, a.t0 + (b - a.b0) * sp), b % 4 === 0);
}
function pump() {
  const sp = spb(), lookT = T.ctx.currentTime + .18;
  for (let g = 0; g < 8; g++) {
    const a = T.anchors[T.anchors.length - 1], horizon = a.b0 + (lookT - a.t0) / sp, lp = S.loop;
    let end = horizon, wrap = false;
    if (lp.on && T.sched < lp.end && lp.end <= horizon) { end = lp.end; wrap = true; }
    if (end > T.sched) { scheduleRange(a, T.sched, end, T.jump); T.jump = false; }
    T.sched = Math.max(T.sched, end);
    if (wrap) { T.anchors.push({ t0: a.t0 + (lp.end - a.b0) * sp, b0: lp.start }); if (T.anchors.length > 4) T.anchors.shift(); T.sched = lp.start; T.jump = true; continue; }
    break;
  }
  if (!S.loop.on && T.sched >= total() && beatNow() > total() + 2.5 / sp) { halt(); T.pos = 0; setPlayUI(); requestDraw(); }
}
function play() {
  if (T.playing) return;
  ensureAudio(); T.playing = true; T.jump = true;
  T.anchors = [{ t0: T.ctx.currentTime + .06, b0: T.pos }]; T.sched = T.pos;
  pump(); T.timer = setInterval(pump, 25); setPlayUI();
}
function halt() {
  if (!T.playing) return;
  T.pos = beatNow(); clearInterval(T.timer); T.playing = false; A.killAll(T.G);
  finishHeld(); if (micState.active) micStop();
}
function pause() { halt(); setPlayUI(); requestDraw(); }
function stop() { const was = T.playing; halt(); T.pos = S.loop.on ? S.loop.start : 0; if (!was) T.pos = 0; ui.cursor = T.pos; setPlayUI(); requestDraw(); }
function togglePlay() { T.playing ? pause() : play(); }
function seek(b) {
  b = Math.max(0, r4(b));
  if (T.playing) { A.killAll(T.G); T.anchors = [{ t0: T.ctx.currentTime + .05, b0: b }]; T.sched = b; T.jump = true; }
  T.pos = b; ui.cursor = b; requestDraw();
}
function reanchor() { if (T.playing) { const b = beatNow(); T.anchors.push({ t0: T.ctx.currentTime, b0: b }); if (T.anchors.length > 4) T.anchors.shift(); } }
function setPlayUI() { $('#playBtn').textContent = T.playing ? '⏸' : '▶'; }
function audition(t, pitch, vel = .8) {
  if (isAudioTrack(t)) return;
  ensureAudio(); A.playNote(T.G, t, { pitch, velocity: vel }, T.ctx.currentTime + .005, .35, envOf());
}

/* ---------- roll geometry ---------- */
const LANE_KEYS = ['velocity', ...AUTO_KEYS];
const roll = $('#roll'), wrap = $('#rollWrap'), spacer = $('#rollSpacer'), velC = $('#vel');
let rows = [], rowIdx = new Map(), rowH = 16, cw = 300, ch = 200;
const dpr = () => window.devicePixelRatio || 1;
const X = b => KEYW + b * ui.ppb - wrap.scrollLeft;
const B = x => (x - KEYW + wrap.scrollLeft) / ui.ppb;
const rowAtY = y => Math.floor((y - RULER + wrap.scrollTop) / rowH);
const snapRound = b => r4(Math.round(b / ui.snap) * ui.snap);
const snapFloor = b => r4(Math.floor(b / ui.snap + 1e-6) * ui.snap);
function computeRows() {
  const t = track();
  if (t.element === 'drums') {
    rows = A.DRUM_LANES.map(l => l[0]);
    [...new Set(t.notes.map(n => n.pitch))].filter(p => !rows.includes(p)).sort((a, b) => b - a).forEach(p => rows.push(p));
    rowH = 22;
  } else {
    const el = A.ELEMENTS[t.element]; let lo = el.lo, hi = el.hi;
    t.notes.forEach(n => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
    rows = []; for (let p = hi; p >= lo; p--) rows.push(p); rowH = 16;
  }
  rowIdx = new Map(rows.map((p, i) => [p, i]));
}
function scaleSet() { const iv = SCALES[S.scale]; return iv ? new Set(iv) : null; }
function rowLabel(p) { if (track().element === 'drums') { const d = A.DRUM_LANES.find(l => l[0] === p); if (d) return d[1]; } return noteName(p); }   // drum names only on drum tracks (pitch 62 is both 'Conga Hi' and D4)
function resizeAll() {
  const d = dpr();
  if (wrap.clientWidth > 0) {
    cw = Math.max(200, wrap.clientWidth); ch = Math.max(100, wrap.clientHeight);
    roll.width = cw * d; roll.height = ch * d; roll.style.width = cw + 'px'; roll.style.height = ch + 'px';
    spacer.style.width = Math.max(cw, KEYW + total() * ui.ppb + 80) + 'px';
    spacer.style.height = Math.max(ch, RULER + rows.length * rowH + 30) + 'px';
  }
  [velC, $('#densityChart'), $('#pitchChart'), $('#scope'), $('#meter')].forEach(c => { if (c.clientWidth > 0) { c.width = Math.max(10, c.clientWidth * d); c.height = Math.max(10, c.clientHeight * d); } });
  requestDraw(); if (!$('#lab').hidden) drawCharts(); clearTimeout(statTimer); statTimer = setTimeout(fetchStats, 400);
  emit('refresh', 'resize');
}
function scrollToNotes() {
  const t = track();
  if (t.element === 'drums') wrap.scrollTop = 0;
  else if (!t.notes.length) wrap.scrollTop = Math.max(0, (rows.length * rowH - ch) / 2 + 10);
  else { const avg = t.notes.reduce((s, n) => s + n.pitch, 0) / t.notes.length; const i = rowIdx.get(Math.round(avg)) ?? 0; wrap.scrollTop = Math.max(0, i * rowH - ch / 2 + RULER); }
  wrap.scrollLeft = 0;
}

/* ---------- drawing ---------- */
let needDraw = true;
const requestDraw = () => { needDraw = true; };
const MONO = () => getComputedStyle(document.body).getPropertyValue('--mono');
function drawRoll() {
  if (ui.view !== 'roll') return;
  const g = roll.getContext('2d'), d = dpr(), t = track(), el = A.ELEMENTS[t.element], sy = wrap.scrollTop, tot = total(), audio = isAudioTrack(t);
  g.setTransform(d, 0, 0, d, 0, 0);
  g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, cw, ch);
  const first = Math.max(0, Math.floor(sy / rowH)), last = Math.min(rows.length - 1, Math.ceil((sy + ch - RULER) / rowH));
  const sc = scaleSet(), pitched = t.element !== 'drums';
  for (let i = first; i <= last; i++) {
    const y = RULER + i * rowH - sy, p = rows[i], pc = ((p % 12) + 12) % 12;
    let fill = null;
    if (pitched) {
      if (sc) { if (!sc.has((pc - S.keyRoot + 12) % 12)) fill = 'rgba(36,30,29,.08)'; else if (pc === S.keyRoot) fill = 'rgba(179,138,81,.24)'; }
      else if (isBlack(p)) fill = 'rgba(36,30,29,.05)';
    } else if (i % 2) fill = 'rgba(36,30,29,.035)';
    if (fill) { g.fillStyle = fill; g.fillRect(KEYW, y, cw - KEYW, rowH); }
    g.fillStyle = pc === 0 && pitched ? 'rgba(36,30,29,.25)' : 'rgba(36,30,29,.07)'; g.fillRect(KEYW, y + rowH - 1, cw - KEYW, 1);
  }
  let step = ui.snap; while (step * ui.ppb < 7) step *= 2;
  const b1 = Math.min(tot, Math.ceil(B(cw)) + 1);
  for (let b = Math.max(0, Math.floor(B(KEYW) / step) * step); b <= b1 + 1e-6; b = r4(b + step)) {
    const x = X(b); if (x < KEYW) continue;
    const bar = Math.abs(b / 4 - Math.round(b / 4)) < .002, beat = Math.abs(b - Math.round(b)) < .002;
    g.fillStyle = bar ? 'rgba(36,30,29,.38)' : beat ? 'rgba(36,30,29,.18)' : 'rgba(36,30,29,.07)'; g.fillRect(Math.round(x), RULER, 1, ch - RULER);
  }
  if (X(tot) < cw) { g.fillStyle = 'rgba(36,30,29,.14)'; g.fillRect(Math.max(KEYW, X(tot)), RULER, cw, ch); }
  if (S.loop.on) { g.fillStyle = 'rgba(151,75,55,.09)'; const a = Math.max(KEYW, X(S.loop.start)), z = X(S.loop.end); g.fillRect(a, RULER, Math.max(0, z - a), ch - RULER); }
  S.markers.forEach(m => { const x = X(m.beat); if (x >= KEYW && x <= cw) { g.fillStyle = 'rgba(123,90,138,.5)'; g.fillRect(Math.round(x), RULER, 1.5, ch - RULER); } });
  S.tracks.forEach((o, oi) => {                         // ghost notes from the other layers
    if (oi === cur || (o.element === 'drums') !== !pitched || isAudioTrack(o)) return;
    g.fillStyle = A.ELEMENTS[o.element].color; g.globalAlpha = .16;
    o.notes.forEach(n => { const i = rowIdx.get(n.pitch); if (i === undefined) return; const x = X(n.start), w = Math.max(2, n.duration * ui.ppb - 1); if (x + w < KEYW || x > cw) return; g.fillRect(x, RULER + i * rowH - sy + 3, w, rowH - 6); });
    g.globalAlpha = 1;
  });
  if (audio) { g.font = '12px ' + MONO(); g.fillStyle = 'rgba(36,30,29,.55)'; g.fillText('Audio track — open the Arrange tab to place, trim and fade clips. Import audio or record a take from the inspector.', KEYW + 16, RULER + 34); }
  t.notes.forEach(n => {
    const i = rowIdx.get(n.pitch); if (i === undefined) return;
    const x = X(n.start), w = Math.max(3, n.duration * ui.ppb - 1), y = RULER + i * rowH - sy + 1;
    if (x + w < KEYW || x > cw || y + rowH < RULER || y > ch) return;
    g.globalAlpha = .4 + .6 * n.velocity; g.fillStyle = el.color; g.fillRect(x, y, w, rowH - 2); g.globalAlpha = 1;
    g.strokeStyle = sel.has(n) ? '#241e1d' : 'rgba(0,0,0,.28)'; g.lineWidth = sel.has(n) ? 2 : 1; g.strokeRect(x + .5, y + .5, w - 1, rowH - 3);
    if (w > 28 && rowH >= 16) { g.fillStyle = '#fff'; g.font = '9px monospace'; g.fillText(rowLabel(n.pitch), x + 3, y + rowH - 6); }
  });
  if (drag && drag.k === 'box') { g.strokeStyle = '#5b292f'; g.fillStyle = 'rgba(91,41,47,.12)'; const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1); g.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)); g.strokeRect(x + .5, y + .5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0)); }
  if (!T.playing) { const cx = X(ui.cursor); if (cx >= KEYW) { g.strokeStyle = 'rgba(91,41,47,.7)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(cx + .5, RULER); g.lineTo(cx + .5, ch); g.stroke(); g.setLineDash([]); } }
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, cw, RULER);                      // ruler
  if (S.loop.on) { g.fillStyle = 'rgba(151,75,55,.35)'; const a = Math.max(KEYW, X(S.loop.start)), z = X(S.loop.end); g.fillRect(a, 0, Math.max(0, z - a), RULER); }
  g.font = '10px ' + MONO(); g.textBaseline = 'middle';
  for (let b = Math.max(0, Math.floor(B(KEYW))); b <= Math.min(tot, b1); b++) {
    const x = X(b); if (x < KEYW) continue;
    g.fillStyle = 'rgba(36,30,29,.5)'; g.fillRect(Math.round(x), b % 4 ? RULER - 6 : 4, 1, b % 4 ? 6 : RULER - 4);
    if (b % 4 === 0 && b < tot) { g.fillStyle = '#241e1d'; g.fillText(String(b / 4 + 1), x + 4, 11); }
  }
  S.markers.forEach(m => { const x = X(m.beat); if (x >= KEYW && x <= cw) { g.fillStyle = '#7b5a8a'; g.fillText('▸' + m.name, x + 2, 19); } });
  for (let i = first; i <= last; i++) {                                    // keys
    const y = RULER + i * rowH - sy, p = rows[i], hit = ui.pressed === p;
    g.fillStyle = hit ? '#b38a51' : pitched ? (isBlack(p) ? '#3a302d' : '#fffaf0') : '#f1e6d3'; g.fillRect(0, y, KEYW, rowH);
    g.fillStyle = 'rgba(36,30,29,.2)'; g.fillRect(0, y + rowH - 1, KEYW, 1);
    if (!pitched || p % 12 === 0 || rowH >= 20) { g.fillStyle = pitched && isBlack(p) && !hit ? '#fffaf0' : '#241e1d'; g.font = '10px ' + MONO(); g.fillText(rowLabel(p), 6, y + rowH / 2); }
  }
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, KEYW, RULER); g.fillStyle = 'rgba(36,30,29,.5)'; g.fillRect(KEYW - 1, 0, 1, ch);
  const px = X(beatNow());
  if (px >= KEYW - 1 && px <= cw) { g.fillStyle = '#b3261e'; g.fillRect(Math.round(px), 0, 1.5, ch); g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 6, 0); g.lineTo(px + .5, 9); g.fill(); }
}
function autoY(def, v, h) { return 4 + (1 - (v - def.min) / (def.max - def.min)) * (h - 8); }
function drawAuto() {
  const g = velC.getContext('2d'), d = dpr(), w = velC.width / d, h = velC.height / d, t = track(), key = ui.lane, def = A.AUTO_PARAMS[key], pts = (t.auto && t.auto[key]) || [], color = A.ELEMENTS[t.element].color;
  g.setTransform(d, 0, 0, d, 0, 0); g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(36,30,29,.08)'; [.25, .5, .75].forEach(f => g.fillRect(KEYW, h * (1 - f), w - KEYW, 1));
  for (let b = 0; b <= total(); b += 1) { const x = X(b); if (x >= KEYW && x <= w) { g.fillStyle = b % 4 ? 'rgba(36,30,29,.06)' : 'rgba(36,30,29,.25)'; g.fillRect(Math.round(x), 0, 1, h); } }
  const base = autoY(def, t.params[key], h);
  if (!pts.length) { g.strokeStyle = 'rgba(36,30,29,.35)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(KEYW, base); g.lineTo(w, base); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(36,30,29,.5)'; g.font = '11px monospace'; g.fillText('click to add a point — the knob value is used until then', KEYW + 12, 16); }
  else {
    g.beginPath(); g.moveTo(KEYW, autoY(def, pts[0].v, h)); pts.forEach(p => g.lineTo(X(p.t), autoY(def, p.v, h))); g.lineTo(Math.max(w, X(pts[pts.length - 1].t)), autoY(def, pts[pts.length - 1].v, h));
    g.strokeStyle = color; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; g.lineTo(w, h); g.lineTo(KEYW, h); g.closePath(); g.globalAlpha = .13; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    pts.forEach(p => { const x = X(p.t), y = autoY(def, p.v, h); if (x < KEYW - 6 || x > w + 6) return; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fillStyle = p === autoDrag?.pt ? '#241e1d' : '#fff'; g.fill(); g.strokeStyle = color; g.lineWidth = 2; g.stroke(); });
  }
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, KEYW, h); g.fillStyle = 'rgba(36,30,29,.6)'; g.font = '10px monospace'; g.fillText(def.label.split(' ')[0].toLowerCase(), 8, 14); g.fillText(String(def.max), 8, 28); g.fillText(String(def.min), 8, h - 6);
  const px = X(beatNow()); if (px >= KEYW) { g.fillStyle = '#b3261e'; g.fillRect(Math.round(px), 0, 1.5, h); }
}
function drawVel() {
  if (ui.view !== 'roll' || !velC.clientWidth) return;
  if (ui.lane !== 'velocity') { drawAuto(); return; }
  const g = velC.getContext('2d'), d = dpr(), w = velC.width / d, h = velC.height / d, t = track(), el = A.ELEMENTS[t.element];
  g.setTransform(d, 0, 0, d, 0, 0); g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(36,30,29,.08)'; [.25, .5, .75].forEach(f => g.fillRect(KEYW, h * (1 - f), w - KEYW, 1));
  for (let b = 0; b <= total(); b += 1) { const x = X(b); if (x >= KEYW && x <= w) { g.fillStyle = b % 4 ? 'rgba(36,30,29,.06)' : 'rgba(36,30,29,.25)'; g.fillRect(Math.round(x), 0, 1, h); } }
  t.notes.forEach(n => { const x = X(n.start); if (x < KEYW || x > w) return; const bh = n.velocity * (h - 8); g.fillStyle = sel.has(n) ? '#241e1d' : el.color; g.fillRect(x - 1.5, h - bh - 2, 4, bh); g.fillRect(x - 3.5, h - bh - 4, 8, 3); });
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, KEYW, h); g.fillStyle = 'rgba(36,30,29,.55)'; g.font = '10px monospace'; g.fillText('velocity', 8, 14); g.fillText('100%', 8, 28); g.fillText('0', 8, h - 6);
  const px = X(beatNow()); if (px >= KEYW) { g.fillStyle = '#b3261e'; g.fillRect(Math.round(px), 0, 1.5, h); }
}
function bars(c, vals, color, labels, hi) {
  if (!c.clientWidth) return;
  const g = c.getContext('2d'), d = dpr(), w = c.width / d, h = c.height / d;
  g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
  const max = Math.max(1, ...vals), bw = w / vals.length;
  vals.forEach((v, i) => { const bh = (v / max) * (h - 26); g.fillStyle = hi && hi.has(i) ? '#5b292f' : color; g.fillRect(i * bw + 2, h - bh - 14, Math.max(1, bw - 4), bh); if (labels && labels[i]) { g.fillStyle = 'rgba(36,30,29,.6)'; g.font = '9px monospace'; g.fillText(labels[i], i * bw + 2, h - 3); } });
}
let chartTimer = 0, statTimer = 0, statSeq = 0;
function scheduleCharts() { clearTimeout(chartTimer); chartTimer = setTimeout(drawCharts, 60); clearTimeout(statTimer); statTimer = setTimeout(fetchStats, 400); }
function drawCharts() {
  if ($('#lab').hidden) return;
  const t = track(), el = A.ELEMENTS[t.element], nb = Math.min(S.bars, 64);
  bars($('#densityChart'), Array.from({ length: nb }, (_, i) => t.notes.filter(n => Math.floor(n.start / 4) === i).length), el.color, nb <= 16 ? Array.from({ length: nb }, (_, i) => i + 1) : null);
  const title = $('#pitchChart').parentNode.querySelector('.chart-title');
  if (t.element === 'drums') { title.textContent = 'HITS PER DRUM'; const lanes = [...A.DRUM_LANES].reverse(); bars($('#pitchChart'), lanes.map(l => t.notes.filter(n => n.pitch === l[0]).length), el.color, lanes.map(l => DRUM_ABBR[l[0]])); }
  else {
    title.textContent = 'PITCH CLASS'; const sc = scaleSet(), inKey = new Set(); if (sc) NN.forEach((_, i) => { if (sc.has((i - S.keyRoot + 12) % 12)) inKey.add(i); });
    bars($('#pitchChart'), NN.map((_, pc) => t.notes.filter(n => n.pitch % 12 === pc).length), '#b38a51', NN.map(n => n.replace('#', '♯')), sc ? inKey : null);
  }
}
async function fetchStats() {
  const t = track(), seq = ++statSeq, box = $('#stats');
  if (isAudioTrack(t)) { box.textContent = `${t.name}: ${t.clips.length} audio clip${t.clips.length === 1 ? '' : 's'} · key ${S.key} · ${S.tempo} BPM · ${S.bars} bars`; return; }
  if (!t.notes.length) { box.textContent = `${t.name}: no notes yet · key ${S.key} · ${S.tempo} BPM · ${S.bars} bars`; return; }
  try {
    const a = await api('/analyze', { method: 'POST', body: JSON.stringify({ notes: t.notes.slice(0, 10000), bars: S.bars }) });
    if (seq !== statSeq) return;
    const s = a.stats, rng = t.element === 'drums' ? '' : ` · range ${noteName(s.pitch_min)}–${noteName(s.pitch_max)}`;
    box.textContent = `${t.name}: ${s.note_count} notes${rng} · ${s.density_mean.toFixed(1)}/bar · avg length ${s.duration_mean.toFixed(2)} beats · avg velocity ${Math.round(s.velocity_mean * 100)}% · key ${S.key} · ${S.tempo} BPM`;
  } catch (e) { box.textContent = `${t.name}: ${t.notes.length} notes`; }
}
function drawLive() {
  const m = $('#meter'), mg = m.getContext('2d'), d = dpr();
  mg.setTransform(d, 0, 0, d, 0, 0); mg.clearRect(0, 0, m.width / d, m.height / d);
  let rms = 0;
  const labOpen = !$('#lab').hidden, sc = $('#scope'), g = sc.getContext('2d'), w = sc.width / d, h = sc.height / d;
  if (labOpen) { g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(91,41,47,.75)'; g.lineWidth = 1.3; g.beginPath(); }
  if (T.G && T.playing) {
    const buf = new Uint8Array(T.G.analyser.fftSize); T.G.analyser.getByteTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; rms += v * v; if (labOpen) { const x = i / (buf.length - 1) * w, y = h / 2 + v * (h / 2 - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); } }
    rms = Math.sqrt(rms / buf.length);
  } else if (labOpen) { g.moveTo(0, h / 2); g.lineTo(w, h / 2); }
  if (labOpen) g.stroke();
  const lvl = clamp(rms * 2.2, 0, 1), mw = m.width / d; mg.fillStyle = lvl > .9 ? '#b3261e' : '#5b292f'; mg.fillRect(0, 0, mw * lvl, m.height / d);
  $$('#trackList .trk').forEach((el, i) => { const t = S.tracks[i]; const lv = T.G && T.playing && t ? clamp(A.busLevel(T.G, t.id) * 2.6, 0, 1) : 0; const bar = el.querySelector('.tm i'); if (bar) bar.style.width = (lv * 100) + '%'; });
}
function updateTimeRead() {
  const b = beatNow(), s = b * spb();
  $('#timeRead').textContent = `${Math.floor(b / 4) + 1}:${Math.floor(b % 4) + 1}:${Math.floor((b % 1) * 4) + 1}`;
  $('#timeRead').title = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function frame() {
  if (T.playing) {
    const x = KEYW + beatNow() * ui.ppb;
    if (ui.view === 'roll' && ui.follow && !drag && (x > wrap.scrollLeft + cw - 30 || x < wrap.scrollLeft + KEYW)) wrap.scrollLeft = Math.max(0, x - KEYW - 40);
    needDraw = true;
  }
  updateTimeRead();
  if (needDraw) { drawRoll(); drawVel(); needDraw = false; }
  drawLive(); emit('frame');
  requestAnimationFrame(frame);
}

/* ---------- roll interaction ---------- */
let drag = null;
function noteAt(x, y) {
  if (x < KEYW || y < RULER) return null;
  const t = track(); if (isAudioTrack(t)) return null;
  const i = rowAtY(y), pitch = rows[i]; if (pitch === undefined) return null;
  for (let k = t.notes.length - 1; k >= 0; k--) {
    const n = t.notes[k]; if (n.pitch !== pitch) continue;
    const nx = X(n.start), w = Math.max(3, n.duration * ui.ppb - 1);
    if (x >= nx - 1 && x <= nx + w + 1) return { note: n, edge: w > 14 && x > nx + w - 6 ? 'right' : 'body' };
  }
  return null;
}
const selected = () => [...sel];
function changed() { markDirty(); requestDraw(); scheduleCharts(); refreshTrackMeta(); emit('change'); }
function delNotes(list) { const t = track(); list.forEach(n => sel.delete(n)); t.notes = t.notes.filter(n => !list.includes(n)); }
function evPos(e) { const r = roll.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

roll.addEventListener('contextmenu', e => e.preventDefault());
roll.addEventListener('pointerdown', e => {
  roll.setPointerCapture(e.pointerId); const { x, y } = evPos(e), t = track();
  if (y < RULER && x >= KEYW) {
    if (e.shiftKey) drag = { k: 'loop', a: snapRound(B(x)) }; else { drag = { k: 'seek' }; seek(snapRound(B(x))); }
    return;
  }
  if (x < KEYW && y >= RULER) { const p = rows[rowAtY(y)]; if (p !== undefined) { ui.pressed = p; audition(t, p); requestDraw(); drag = { k: 'key' }; } return; }
  if (isAudioTrack(t)) return;
  const hit = noteAt(x, y);
  if (e.button === 2) { if (hit) { pushUndo(); delNotes([hit.note]); changed(); } return; }
  if (ui.tool === 'erase') { drag = { k: 'erase', undone: false }; eraseAt(x, y); return; }
  if (!hit && ui.tool === 'draw') {
    const p = rows[rowAtY(y)], start = snapFloor(B(x)); if (p === undefined || start >= total()) return;
    pushUndo();
    const n = { pitch: p, start, duration: Math.max(ui.snap, ui.lastLen), velocity: .75 };
    t.notes.push(n); sel.clear(); sel.add(n); ui.cursor = start; audition(t, p, n.velocity);
    drag = { k: 'newlen', note: n }; changed(); renderInspector(); return;
  }
  if (hit) {
    if (!sel.has(hit.note)) { if (!e.shiftKey) sel.clear(); sel.add(hit.note); }
    else if (e.shiftKey) { sel.delete(hit.note); requestDraw(); renderInspector(); return; }
    audition(t, hit.note.pitch, hit.note.velocity);
    const base = new Map(selected().map(n => [n, { start: n.start, duration: n.duration, row: rowIdx.get(n.pitch) }]));
    drag = hit.edge === 'right' ? { k: 'resize', x0: B(x), base, snapped: false } : { k: 'move', x0: B(x), r0: rowAtY(y), base, snapped: false, lastRow: rowAtY(y) };
    requestDraw(); renderInspector(); return;
  }
  if (!e.shiftKey) sel.clear();
  ui.cursor = snapRound(B(x));
  drag = { k: 'box', x0: x, y0: y, x1: x, y1: y, keep: new Set(sel) }; requestDraw(); renderInspector();
});
function eraseAt(x, y) {
  const hit = noteAt(x, y); if (!hit) return;
  if (!drag.undone) { pushUndo(); drag.undone = true; }
  delNotes([hit.note]); changed();
}
roll.addEventListener('pointermove', e => {
  const { x, y } = evPos(e);
  if (!drag) { const h = noteAt(x, y); roll.style.cursor = h ? (h.edge === 'right' ? 'ew-resize' : 'grab') : (y < RULER || x < KEYW ? 'pointer' : ui.tool === 'erase' ? 'not-allowed' : 'crosshair'); return; }
  const t = track();
  switch (drag.k) {
    case 'seek': seek(snapRound(B(x))); break;
    case 'loop': { const b = snapRound(B(x)), a = Math.min(drag.a, b), z = Math.max(drag.a, b); if (z - a >= ui.snap) { S.loop = { on: true, start: clamp(a, 0, total()), end: clamp(z, 0, total()) }; syncTopbar(); markDirty(); requestDraw(); } break; }
    case 'newlen': { const d2 = Math.max(ui.snap, r4(snapRound(B(x)) - drag.note.start)); drag.note.duration = Math.min(d2, total() - drag.note.start); ui.lastLen = drag.note.duration; requestDraw(); break; }
    case 'resize': {
      const dd = r4(Math.round((B(x) - drag.x0) / ui.snap) * ui.snap);
      if (dd && !drag.snapped) { pushUndo(); drag.snapped = true; }
      drag.base.forEach((b, n) => { n.duration = Math.max(.0625, r4(b.duration + dd)); ui.lastLen = n.duration; }); changed(); break;
    }
    case 'move': {
      const db = r4(Math.round((B(x) - drag.x0) / ui.snap) * ui.snap), dr = rowAtY(y) - drag.r0;
      if ((db || dr) && !drag.snapped) { pushUndo(); drag.snapped = true; }
      drag.base.forEach((b, n) => { n.start = Math.max(0, r4(b.start + db)); if (b.row !== undefined) n.pitch = rows[clamp(b.row + dr, 0, rows.length - 1)]; });
      const r = rowAtY(y); if (r !== drag.lastRow && rows[r] !== undefined) { drag.lastRow = r; audition(t, rows[r]); }
      changed(); break;
    }
    case 'box': {
      drag.x1 = x; drag.y1 = y; const x0 = Math.min(drag.x0, x), x1 = Math.max(drag.x0, x), y0 = Math.min(drag.y0, y), y1 = Math.max(drag.y0, y);
      sel.clear(); drag.keep.forEach(n => sel.add(n));
      t.notes.forEach(n => { const i = rowIdx.get(n.pitch); if (i === undefined) return; const nx = X(n.start), nw = n.duration * ui.ppb, ny = RULER + i * rowH - wrap.scrollTop; if (nx < x1 && nx + nw > x0 && ny < y1 && ny + rowH > y0) sel.add(n); });
      requestDraw(); break;
    }
    case 'erase': eraseAt(x, y); break;
  }
});
const endDrag = () => { const k = drag && drag.k; if (k === 'key') { ui.pressed = null; requestDraw(); } drag = null; if (k === 'box' || k === 'newlen' || k === 'move') renderInspector(); requestDraw(); };
roll.addEventListener('pointerup', endDrag); roll.addEventListener('pointercancel', endDrag);
wrap.addEventListener('scroll', requestDraw);
wrap.addEventListener('wheel', e => {
  if (!e.ctrlKey) return; e.preventDefault();
  const { x } = evPos(e), anchor = B(x);
  setZoom(clamp(ui.ppb * Math.exp(-e.deltaY * .0025), 12, 160)); wrap.scrollLeft = Math.max(0, anchor * ui.ppb - (x - KEYW));
}, { passive: false });
function setZoom(v) { ui.ppb = v; $('#zoom').value = v; spacer.style.width = Math.max(cw, KEYW + total() * ui.ppb + 80) + 'px'; requestDraw(); }
let velDrag = false, velSnap = false;
function velApply(e) {
  const r = velC.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, h = r.height;
  if (x < KEYW) return;
  const v = clamp(r4(1 - (y - 4) / (h - 8)), .02, 1), hits = track().notes.filter(n => Math.abs(X(n.start) - x) <= 4);
  if (!hits.length) return;
  const picked = hits.some(n => sel.has(n)) ? new Set([...hits, ...selected()]) : new Set(hits);
  if (!velSnap) { pushUndo(); velSnap = true; }
  picked.forEach(n => { n.velocity = v; }); changed();
}
let autoDrag = null;
const autoPts = () => { const t = track(); t.auto = t.auto || {}; return (t.auto[ui.lane] = t.auto[ui.lane] || []); };
function autoPoint(x, y) {
  const t = track(), pts = (t.auto && t.auto[ui.lane]) || [], def = A.AUTO_PARAMS[ui.lane], h = velC.clientHeight;
  return pts.find(p => Math.hypot(X(p.t) - x, autoY(def, p.v, h) - y) <= 8) || null;
}
const autoVal = (def, y) => clamp(r4(Math.round((def.min + (1 - (y - 4) / (velC.clientHeight - 8)) * (def.max - def.min)) * 100) / 100), def.min, def.max);
function autoAfter() { const t = track(); AUTO_KEYS.forEach(k => { if (t.auto && t.auto[k] && !t.auto[k].length) delete t.auto[k]; }); applyAllBuses(); changed(); renderInspector(); }
velC.addEventListener('contextmenu', e => e.preventDefault());
velC.addEventListener('pointerdown', e => {
  velC.setPointerCapture(e.pointerId);
  if (ui.lane === 'velocity') { velDrag = true; velSnap = false; velApply(e); return; }
  const r = velC.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; if (x < KEYW) return;
  const def = A.AUTO_PARAMS[ui.lane], hit = autoPoint(x, y);
  if (e.button === 2) { if (hit) { pushUndo(); const pts = autoPts(); pts.splice(pts.indexOf(hit), 1); autoAfter(); } return; }
  pushUndo();
  if (hit) autoDrag = { pt: hit, moved: false };
  else { const pts = autoPts(), p = { t: clamp(snapRound(B(x)), 0, total()), v: autoVal(def, y) }; pts.push(p); pts.sort((a, b) => a.t - b.t); autoDrag = { pt: p, moved: true }; applyAllBuses(); changed(); }
  requestDraw();
});
velC.addEventListener('pointermove', e => {
  if (ui.lane === 'velocity') { if (velDrag) velApply(e); return; }
  const r = velC.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  if (!autoDrag) { velC.style.cursor = autoPoint(x, y) ? 'grab' : 'crosshair'; return; }
  const def = A.AUTO_PARAMS[ui.lane], p = autoDrag.pt; p.t = clamp(snapRound(B(x)), 0, total()); p.v = autoVal(def, y); autoDrag.moved = true;
  autoPts().sort((a, b) => a.t - b.t); applyAllBuses(); changed();
});
velC.addEventListener('pointerup', () => { velDrag = false; if (autoDrag) { autoDrag = null; autoAfter(); } else renderInspector(); });
velC.addEventListener('dblclick', e => {
  if (ui.lane === 'velocity') return; const r = velC.getBoundingClientRect(), hit = autoPoint(e.clientX - r.left, e.clientY - r.top);
  if (hit) { pushUndo(); const pts = autoPts(); pts.splice(pts.indexOf(hit), 1); autoAfter(); }
});
const laneSel = $('#laneSel');
laneSel.innerHTML = LANE_KEYS.map(k => `<option value="${k}">${k === 'velocity' ? 'Velocity (notes)' : 'Automation: ' + A.AUTO_PARAMS[k].label}</option>`).join('');
laneSel.onchange = () => { ui.lane = laneSel.value; syncLaneUI(); requestDraw(); };
function syncLaneUI() {
  const t = track(), auto = ui.lane !== 'velocity', n = auto ? ((t.auto && t.auto[ui.lane]) || []).length : 0;
  $('#laneHelp').textContent = auto ? `${n} point${n === 1 ? '' : 's'} on ${t.name} · click to add, drag to move, right-click or double-click a point to delete` : 'drag the bars';
  $('#laneClear').hidden = !auto || !n; laneSel.value = ui.lane;
}
$('#laneClear').onclick = () => { const t = track(); if (!t.auto || !t.auto[ui.lane]) return; pushUndo(); delete t.auto[ui.lane]; autoAfter(); syncLaneUI(); };
on('change', syncLaneUI); on('refresh', syncLaneUI);

/* ---------- note editing actions ---------- */
const targets = () => (sel.size ? selected() : track().notes);
function fitToKey() {
  const iv = SCALES[S.scale], t = track(); if (!iv || t.element === 'drums') { toast(iv ? 'Fit to key is for pitched tracks.' : 'Choose a key and scale in the top bar first.'); return; }
  const set = new Set(iv); pushUndo();
  targets().forEach(n => { for (let d = 0; d < 7; d++) { const dn = n.pitch - d, up = n.pitch + d; if (set.has((((dn - S.keyRoot) % 12) + 12) % 12)) { n.pitch = dn; break; } if (set.has((((up - S.keyRoot) % 12) + 12) % 12)) { n.pitch = up; break; } } });
  computeRows(); resizeAll(); changed(); toast('Notes moved into ' + S.key);
}
function quantize() { pushUndo(); targets().forEach(n => { n.start = Math.max(0, snapRound(n.start)); n.duration = Math.max(ui.snap, snapRound(n.duration)); }); changed(); }
function humanize() { pushUndo(); targets().forEach(n => { n.start = Math.max(0, r4(n.start + (Math.random() - .5) * .05)); n.velocity = clamp(r4(n.velocity + (Math.random() - .5) * .16), .05, 1); }); changed(); }
function repeatPattern() {
  const t = track(); if (!t.notes.length) return;
  const span = Math.max(4, Math.ceil(Math.max(...t.notes.map(n => n.start + n.duration)) / 4) * 4);
  if (span * 2 > 64 * 4) { toast('The song is at its 64-bar limit.'); return; }
  pushUndo(); ensureBars(span * 2);
  t.notes.slice().forEach(n => t.notes.push({ ...n, start: r4(n.start + span) }));
  syncTopbar(); resizeAll(); changed(); toast(`Pattern repeated after bar ${span / 4}`);
}
function shiftSel(dBeat, dPitch) {
  if (!sel.size) return; pushUndo();
  selected().forEach(n => { n.start = Math.max(0, r4(n.start + dBeat)); n.pitch = clamp(n.pitch + dPitch, 0, 127); });
  computeRows(); resizeAll(); changed(); if (dPitch) audition(track(), selected()[0].pitch);
}
function copySel(cut) {
  if (!sel.size) return; const list = selected(), base = Math.min(...list.map(n => n.start));
  clipboard = list.map(n => ({ ...n, start: r4(n.start - base) }));
  if (cut) { pushUndo(); delNotes(list); changed(); renderInspector(); }
}
function pasteAt(beat) {
  if (!clipboard.length) return; pushUndo(); sel.clear();
  clipboard.forEach(c => { const n = { ...c, start: r4(beat + c.start) }; track().notes.push(n); sel.add(n); });
  computeRows(); resizeAll(); changed(); renderInspector();
}
function duplicateSel() {
  if (!sel.size) return; const list = selected(), a = Math.min(...list.map(n => n.start)), z = Math.max(...list.map(n => n.start + n.duration));
  copySel(false); pasteAt(a + Math.max(ui.snap, Math.ceil((z - a) / ui.snap) * ui.snap));
}
// Used by the chord palette: write pitches at the insert cursor, then move the cursor on so chords chain.
function insertPattern(rel, len, hear = []) {
  const t = track(); if (t.element === 'drums' || isAudioTrack(t)) { toast('Chords and riffs go on a pitched track (bass, mids, vox or effects).'); return false; }
  const start = Math.max(0, snapRound(ui.cursor)); if (!ensureBars(start + len)) return false;
  pushUndo();
  const added = rel.map(n => ({ pitch: clamp(n.pitch, 0, 127), start: r4(start + n.start), duration: n.duration, velocity: n.velocity }));
  t.notes.push(...added); sel.clear(); added.forEach(n => sel.add(n)); ui.cursor = r4(start + len);
  hear.forEach(p => audition(t, p, .7)); computeRows(); resizeAll(); changed(); renderInspector();
  const x = X(start); if (x < KEYW || x > cw - 60) wrap.scrollLeft = Math.max(0, start * ui.ppb - 40);
  return true;
}
function insertNotes(pitches, len, vel = .75) { return insertPattern(pitches.map(p => ({ pitch: p, start: 0, duration: r4(len * .95), velocity: vel })), len, pitches); }
function arpSelection(opts) {
  const list = selected(); if (list.length < 2) { toast('Select a chord (drag a box around its notes) first.'); return; }
  pushUndo(); const out = GN.arpeggiate(list, opts); delNotes(list); track().notes.push(...out); sel.clear(); out.forEach(n => sel.add(n)); computeRows(); resizeAll(); changed(); renderInspector();
}

/* ---------- tracks / inspector / topbar ---------- */
function selectTrack(i) { cur = clamp(i, 0, S.tracks.length - 1); sel.clear(); computeRows(); resizeAll(); scrollToNotes(); renderTracks(); renderInspector(); requestDraw(); scheduleCharts(); emit('refresh', 'track'); }
function renderTracks() {
  $('#trackList').innerHTML = S.tracks.map((t, i) => {
    const el = A.ELEMENTS[t.element], what = isAudioTrack(t) ? `${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}` : `${t.notes.length} notes${t.clips.length ? ' · ' + t.clips.length + ' clips' : ''}`;
    const opts = el.instruments.map(n => `<option ${n === t.instrument ? 'selected' : ''}>${esc(n)}</option>`).join('');
    return `<div class="trk ${i === cur ? 'active' : ''}" data-i="${i}"><span class="bar" style="background:${el.color}"></span><div><div class="nm" title="Double-click to rename">${esc(t.name)}</div><div class="mt">${el.n} ${el.label}${t.layer ? ' + ' + esc(t.layer.instrument) : ''} · <span data-count>${what}</span></div></div><div class="ms"><button data-act="mute" class="${t.mute ? 'on' : ''}" title="Mute">M</button><button data-act="solo" class="${t.solo ? 'on' : ''}" title="Solo">S</button><button data-act="del" class="x" title="Delete this track">✕</button></div><div class="tinst"><select class="ti" aria-label="Sound for ${esc(t.name)}">${opts}</select><button data-act="browse" title="Browse all sounds">♪</button><button data-act="up" title="Move up">↑</button><button data-act="down" title="Move down">↓</button></div><input class="tv" type="range" min="0" max="1.2" step=".01" value="${t.params.volume}" aria-label="Volume for ${esc(t.name)}"><div class="tm"><i></i></div></div>`;
  }).join('');
}
function refreshTrackMeta() { $$('#trackList .trk').forEach((el, i) => { const c = $('[data-count]', el), t = S.tracks[i]; if (c && t) c.textContent = isAudioTrack(t) ? `${t.clips.length} clips` : `${t.notes.length} notes${t.clips.length ? ' · ' + t.clips.length + ' clips' : ''}`; }); }
$('#trackList').addEventListener('click', e => {
  const row = e.target.closest('.trk'); if (!row || e.target.matches('input')) return; const i = +row.dataset.i, act = e.target.dataset.act;
  if (act === 'mute' || act === 'solo') { const t = S.tracks[i]; t[act] = !t[act]; applyAllBuses(); markDirty(); renderTracks(); emit('refresh', 'mix'); return; }
  if (act === 'del') { removeTrack(i); return; }
  if (act === 'up' || act === 'down') { moveTrack(i, act === 'up' ? -1 : 1); return; }
  if (act === 'browse') { if (i !== cur) selectTrack(i); emit('browse', i); return; }
  if (i !== cur) selectTrack(i);
});
$('#trackList').addEventListener('change', e => { if (!e.target.matches('.ti')) return; const i = +e.target.closest('.trk').dataset.i; changeInstrument(i, e.target.value); });
$('#trackList').addEventListener('dblclick', e => {
  const nm = e.target.closest('.nm'); if (!nm) return; const i = +nm.closest('.trk').dataset.i, t = S.tracks[i];
  const name = prompt('Rename track:', t.name); if (!name || !name.trim()) return; pushUndo(); t.name = name.trim().slice(0, 40); markDirty(); renderTracks(); renderInspector(); emit('refresh', 'mix');
});
function removeTrack(i) {
  if (S.tracks.length < 2) { toast('A project needs at least one track.'); return; }
  const t = S.tracks[i]; pushUndo(); if (T.G) A.killAll(T.G);
  S.tracks.splice(i, 1); ui.clipSel = null; markDirty(); selectTrack(Math.min(cur > i ? cur - 1 : cur, S.tracks.length - 1));
  toastUndo(`Deleted track “${t.name}”`);
}
function moveTrack(i, d) {
  const j = i + d; if (j < 0 || j >= S.tracks.length) return; pushUndo();
  const keep = track(), t = S.tracks[i]; S.tracks.splice(i, 1); S.tracks.splice(j, 0, t); cur = S.tracks.indexOf(keep);
  markDirty(); renderTracks(); emit('refresh', 'track');
}
const elementOf = name => Object.keys(A.ELEMENTS).find(k => A.ELEMENTS[k].instruments.includes(name));
// Switch a track's sound. A sound from another element (e.g. a guitar on a bass track) moves the track to that element.
function changeInstrument(i, name) {
  const t = S.tracks[i], ek = elementOf(name); if (!t || !ek || t.instrument === name) return; pushUndo();
  if (ek !== t.element) { t.element = ek; t.layer = null; t.params = baseParams(name, { volume: t.params.volume, pan: t.params.pan, reverb: t.params.reverb, delay: t.params.delay }); } else { t.instrument = name; Object.assign(t.params, A.INSTRUMENT_DEFAULTS[name] || {}); }
  t.instrument = name; if (T.G) A.killAll(T.G);
  markDirty(); if (i === cur) { computeRows(); resizeAll(); scheduleCharts(); } renderTracks(); renderInspector(); requestDraw(); emit('refresh', 'track');
  A.loadSamples([name]).then(() => { refreshSamples(); audition(t, t.element === 'drums' ? 36 : t.element === 'bass' ? 40 : 60); });
}
async function previewInstrument(name) {
  const ek = elementOf(name); if (!ek) return; ensureAudio(); if (S.master.samples !== false) await A.loadSamples([name]);
  const t = { id: '__preview', element: ek, instrument: name, params: baseParams(name), layer: null, mute: false, solo: false }, env = { tempo: 120, anySolo: false, samples: S.master.samples !== false }, when = T.ctx.currentTime + .03, play = (p, at, d = .35, v = .85) => A.playNote(T.G, t, { pitch: p, velocity: v }, when + at, d, env);
  if (ek === 'drums') [36, 42, 38, 42, 36, 36, 38, 46].forEach((p, k) => play(p, k * .2, .15));
  else if (ek === 'fx') play(60, 0, 1.2);
  else if (ek === 'bass') [36, 36, 43, 40, 36].forEach((p, k) => play(p, k * .3, .28));
  else { [60, 64, 67, 72].forEach((p, k) => play(p, k * .22, .3)); [60, 64, 67].forEach(p => play(p, 1.05, 1.2, .7)); }
}
function toastUndo(msg) {
  $$('.toast-undo').forEach(x => x.remove());
  const d = document.createElement('div'); d.className = 'toast-undo'; d.innerHTML = `<span>${esc(msg)}</span><button type="button">Undo</button>`;
  d.querySelector('button').onclick = () => { doUndo(); d.remove(); }; document.body.appendChild(d); setTimeout(() => d.remove(), 7000);
}
function deleteSelected() { if (!sel.size) return; const n = sel.size; pushUndo(); delNotes(selected()); changed(); renderInspector(); toastUndo(`Deleted ${n} note${n > 1 ? 's' : ''}`); }
$('#delSelBtn').onclick = deleteSelected;
$('#trackList').addEventListener('input', e => {
  if (!e.target.matches('.tv')) return; const i = +e.target.closest('.trk').dataset.i;
  sliderUndo(); S.tracks[i].params.volume = +e.target.value; applyAllBuses(); markDirty(); if (i === cur) renderInspectorValues(); emit('refresh', 'mix');
});
$('#elementBtns').innerHTML = Object.entries(A.ELEMENTS).map(([k, el]) => `<button data-el="${k}" style="border-left-color:${el.color}" title="Add a ${el.label} track: ${el.instruments.join(', ')}"><b>${el.n}</b>${el.label}</button>`).join('');
$('#elementBtns').addEventListener('click', e => {
  const b = e.target.closest('[data-el]'); if (!b) return; const k = b.dataset.el, el = A.ELEMENTS[k];
  if (S.tracks.length >= 24) { toast('A project is limited to 24 tracks.'); return; }
  pushUndo();
  S.tracks.push(newTrack(k, el.instruments[0], `${el.label} ${S.tracks.filter(t => t.element === k).length + 1}`, [], k === 'vox' || k === 'fx' ? { reverb: .3 } : {}));
  markDirty(); selectTrack(S.tracks.length - 1);
});

const fmt = { pct: v => Math.round(v * 100) + '%', sec: v => v.toFixed(2) + 's', st: v => (v > 0 ? '+' : '') + v + ' st', pan: v => v === 0 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100), db: v => (v > 0 ? '+' : '') + (+v).toFixed(0) + ' dB' };
function sl(key, label, min, max, step, f) {
  const v = track().params[key];
  return `<div class="lm-slider"><label>${label}<b data-v="${key}">${f(v)}</b></label><input type="range" data-p="${key}" data-f="${Object.keys(fmt).find(k => fmt[k] === f)}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}
const group = (key, title, body, dflt = true) => `<details data-g="${key}" ${ui.groups[key] === undefined ? (dflt ? 'open' : '') : (ui.groups[key] ? 'open' : '')}><summary>${title}</summary>${body}</details>`;
function renderInspector() {
  $('#delSelBtn').disabled = !sel.size;
  const t = track(), el = A.ELEMENTS[t.element], drums = t.element === 'drums', audio = isAudioTrack(t);
  const opts = (list, v) => list.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
  let h = `<div class="panel-label">inspector</div><h3>${esc(t.name)}</h3><span class="chip" style="background:${el.color}">${el.n} · ${el.label}</span>
  <div class="row"><label for="inName" class="note">name</label><input type="text" id="inName" value="${esc(t.name)}" maxlength="40"></div>
  <div class="row"><label for="inEl" class="note">element</label><select id="inEl">${Object.entries(A.ELEMENTS).map(([k, e]) => `<option value="${k}" ${k === t.element ? 'selected' : ''}>${e.n} · ${e.label}</option>`).join('')}</select></div>
  <div class="row"><label for="inInstr" class="note">${drums ? 'drum kit' : 'instrument'}</label><select id="inInstr">${opts(el.instruments, t.instrument)}</select><button type="button" id="inBrowse" style="margin-top:5px;width:100%">♪ browse all sounds…</button></div>`;
  if (audio) {
    const f = findClip(), c = f && f.t === t ? f.c : null;
    h += group('audio', 'audio clips', `<div class="btns"><button id="impAudio">⤒ import audio…</button><button id="micBtn" class="${micState.active ? 'on' : ''}">${micState.active ? '■ stop take' : '● record vocal'}</button></div>
    <p class="note">WAV, MP3, OGG, FLAC or M4A up to 12 MB (60 MB per project). Clips can overlap — fade them in and out to crossfade. Recording starts at the playhead and plays your other tracks along; use headphones.</p>
    ${t.clips.map(x => `<div class="clip ${c === x ? 'sel' : ''}" data-clip="${x.id}"><span>${esc(x.name)} · bar ${Math.floor(x.start / 4) + 1}.${Math.floor(x.start % 4) + 1} · ${(x.len / x.rate).toFixed(1)}s</span></div>`).join('') || '<p class="note">No clips yet — drop a file on the Arrange view or use the buttons above.</p>'}`);
  }
  const f2 = findClip();
  if (f2) {
    const c = f2.c;
    h += group('clip', 'selected clip', `<div class="note">${esc(c.name)}</div>
    <div class="row"><label class="note">start (beats)</label><input type="number" id="clStart" step="0.25" min="0" value="${c.start}"></div>
    <div class="lm-slider"><label>gain<b data-c="gain">${fmt.pct(c.gain)}</b></label><input type="range" data-cl="gain" data-cf="pct" min="0" max="2" step=".01" value="${c.gain}"></div>
    <div class="lm-slider"><label>fade in<b data-c="fadeIn">${fmt.sec(c.fadeIn)}</b></label><input type="range" data-cl="fadeIn" data-cf="sec" min="0" max="8" step=".01" value="${c.fadeIn}"></div>
    <div class="lm-slider"><label>fade out<b data-c="fadeOut">${fmt.sec(c.fadeOut)}</b></label><input type="range" data-cl="fadeOut" data-cf="sec" min="0" max="8" step=".01" value="${c.fadeOut}"></div>
    <div class="lm-slider"><label>speed<b data-c="rate">${c.rate.toFixed(2)}×</b></label><input type="range" data-cl="rate" data-cf="rate" min=".5" max="2" step=".01" value="${c.rate}"></div>
    <label class="lm-check" title="Change the speed without changing the pitch (a voice stays a voice). Off = tape-style speed change where pitch follows."><input type="checkbox" data-cw="warp" ${c.warp ? 'checked' : ''}> keep pitch (time-stretch) <span class="note" id="warpNote"></span></label>
    <div class="btns"><button id="clMatch" title="Enter the clip's original tempo; speed is set so it lines up with the project">match tempo…</button><button id="clSplit">split at playhead</button><button id="clDup">duplicate</button><button id="clDel" class="danger">delete</button></div>`);
  }
  if (!audio) {
    h += group('sound', 'sound', `${drums ? '' : sl('attack', 'attack', .002, 2, .002, fmt.sec)}${sl('release', drums ? 'decay' : 'release', .02, 3, .01, fmt.sec)}${sl('tone', 'tone / brightness', 0, 1, .01, fmt.pct)}${drums ? '' : sl('transpose', 'pitch shift', -24, 24, 1, fmt.st)}`);
    if (!drums) {
      const ly = t.layer;
      h += group('layer', 'layer (stack a 2nd sound)', `<div class="row"><select id="lyInstr"><option value="">— none —</option>${opts(LAYERABLE, ly ? ly.instrument : '')}</select></div>
      ${ly ? `<div class="lm-slider"><label>layer level<b data-ly="v">${fmt.pct(ly.volume)}</b></label><input type="range" data-ly="volume" min="0" max="1" step=".01" value="${ly.volume}"></div>
      <div class="row"><label class="note">layer transpose</label><select id="lyShift">${[-12, -7, 0, 7, 12].map(v => `<option value="${v}" ${v === ly.shift ? 'selected' : ''}>${v > 0 ? '+' : ''}${v} st</option>`).join('')}</select></div>` : '<p class="note">Play two instruments from the same notes, e.g. pad + pluck, or a bass an octave up.</p>'}`, false);
    }
  }
  h += group('tone', 'filter · EQ · drive', `${sl('filter', 'low-pass filter', 0, 1, .01, fmt.pct)}${sl('drive', 'drive / saturation', 0, 1, .01, fmt.pct)}${sl('tape', 'tape wobble & warmth', 0, 1, .01, fmt.pct)}${sl('eqLo', 'EQ low (120 Hz)', -12, 12, 1, fmt.db)}${sl('eqMid', 'EQ mid (1 kHz)', -12, 12, 1, fmt.db)}${sl('eqHi', 'EQ high (6 kHz)', -12, 12, 1, fmt.db)}`, false);
  h += group('space', 'delay · reverb', `${sl('delay', 'delay (dotted 8th)', 0, 1, .01, fmt.pct)}${sl('reverb', 'reverb send', 0, 1, .01, fmt.pct)}`, false);
  h += group('mix', 'mix', `${sl('volume', 'volume', 0, 1.2, .01, fmt.pct)}${sl('pan', 'pan', -1, 1, .01, fmt.pan)}`);
  if (sel.size) {
    const list = selected(), avg = list.reduce((s, n) => s + n.velocity, 0) / list.length;
    h += group('selection', `${list.length} note${list.length > 1 ? 's' : ''} selected`, `<div class="lm-slider"><label>velocity<b>${Math.round(avg * 100)}%</b></label><input type="range" id="selVel" min="2" max="100" value="${Math.round(avg * 100)}"></div>
    <div class="btns"><button data-sel="p-12">−12</button><button data-sel="p-1">−1</button><button data-sel="p1">+1</button><button data-sel="p12">+12</button><button data-sel="dup">duplicate</button><button data-sel="del">delete</button></div>
    ${drums ? '' : `<div class="row"><label class="note">arpeggiate selection</label><div class="btns"><select id="arpPat"><option value="up">up</option><option value="down">down</option><option value="updown">up-down</option><option value="random">random</option></select><select id="arpRate"><option value="0.5">1/8</option><option value="0.25" selected>1/16</option><option value="1">1/4</option><option value=".333">1/8T</option></select><button id="arpGo">arp</button></div></div>`}`);
  }
  h += `<div class="btns" style="margin-top:14px"><button id="dupTrack">duplicate track</button><button id="delTrack" class="danger">delete track</button></div>
  <p class="note" style="margin-top:10px">Keys: Space play · Enter stop · 1/2/3 tools · A–L play notes (Z/X octave) · Ctrl+Z/Y undo · Ctrl+C/X/V/D · right-click deletes a note · Shift-drag the ruler sets the loop · Ctrl+wheel zooms.</p>`;
  $('#inspector').innerHTML = h;
}
function renderInspectorValues() { const t = track(); $$('#inspector [data-p]').forEach(i => { i.value = t.params[i.dataset.p]; const b = $(`[data-v="${i.dataset.p}"]`); if (b) b.textContent = fmt[i.dataset.f](t.params[i.dataset.p]); }); }
const insp = $('#inspector');
insp.addEventListener('toggle', e => { const g = e.target.dataset && e.target.dataset.g; if (g) ui.groups[g] = e.target.open; }, true);
insp.addEventListener('input', e => {
  const t = track(), el = e.target;
  if (el.dataset.p) { sliderUndo(); const k = el.dataset.p; t.params[k] = +el.value; $(`[data-v="${k}"]`, insp).textContent = fmt[el.dataset.f](t.params[k]); applyAllBuses(); markDirty(); if (k === 'volume') { const tv = $(`#trackList .trk[data-i="${cur}"] .tv`); if (tv) tv.value = el.value; } emit('refresh', 'mix'); }
  else if (el.dataset.cl) { const f = findClip(); if (!f) return; sliderUndo(); const k = el.dataset.cl; f.c[k] = +el.value; $(`[data-c="${k}"]`, insp).textContent = k === 'rate' ? (+el.value).toFixed(2) + '×' : fmt[el.dataset.cf](+el.value); markDirty(); requestDraw(); emit('change'); }
  else if (el.dataset.ly) { sliderUndo(); t.layer.volume = +el.value; $('[data-ly="v"]', insp).textContent = fmt.pct(t.layer.volume); markDirty(); }
  else if (el.id === 'selVel') { sliderUndo(); selected().forEach(n => { n.velocity = +el.value / 100; }); el.previousElementSibling.querySelector('b').textContent = el.value + '%'; changed(); }
  else if (el.id === 'inName') { t.name = el.value.slice(0, 40); markDirty(); const nm = $(`#trackList .trk[data-i="${cur}"] .nm`); if (nm) nm.textContent = t.name; emit('refresh', 'mix'); }
});
insp.addEventListener('change', e => {
  const t = track(), el = e.target;
  if (el.id === 'inEl') { pushUndo(); t.element = el.value; t.instrument = A.ELEMENTS[t.element].instruments[0]; t.layer = null; t.params = baseParams(t.instrument, { volume: t.params.volume, pan: t.params.pan, reverb: t.params.reverb, delay: t.params.delay }); if (T.G) A.killAll(T.G); markDirty(); computeRows(); resizeAll(); renderTracks(); renderInspector(); scheduleCharts(); emit('refresh', 'track'); }
  else if (el.id === 'inInstr') { pushUndo(); t.instrument = el.value; Object.assign(t.params, A.INSTRUMENT_DEFAULTS[t.instrument] || {}); markDirty(); renderTracks(); renderInspector(); requestDraw(); scheduleCharts(); audition(t, t.element === 'drums' ? 36 : 60); emit('refresh', 'track'); }
  else if (el.id === 'lyInstr') { pushUndo(); t.layer = el.value ? { instrument: el.value, volume: t.layer ? t.layer.volume : .6, shift: t.layer ? t.layer.shift : 0 } : null; markDirty(); renderTracks(); renderInspector(); if (t.layer) audition(t, 60); }
  else if (el.id === 'lyShift') { pushUndo(); t.layer.shift = +el.value; markDirty(); audition(t, 60); }
  else if (el.dataset.cw === 'warp') { const f = findClip(); if (!f) return; pushUndo(); f.c.warp = el.checked; requestWarp(f.c); markDirty(); requestDraw(); emit('change'); }
  else if (el.dataset.cl === 'rate') { const f = findClip(); if (f) requestWarp(f.c); }
  else if (el.id === 'clStart') { const f = findClip(); if (!f) return; pushUndo(); f.c.start = Math.max(0, r4(+el.value || 0)); ensureBars(clipEnd(f.c)); markDirty(); requestDraw(); emit('change'); }
});
insp.addEventListener('click', e => {
  const cl = e.target.closest('[data-clip]'); if (cl && !e.target.closest('button')) { ui.clipSel = { tid: track().id, cid: cl.dataset.clip }; renderInspector(); emit('refresh', 'clip'); return; }
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'dupTrack') { pushUndo(); const t = track(), c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.name = (t.name + ' copy').slice(0, 40); c.clips.forEach(x => { x.id = uid(); }); S.tracks.splice(cur + 1, 0, c); markDirty(); selectTrack(cur + 1); }
  else if (b.id === 'delTrack') removeTrack(cur);
  else if (b.id === 'inBrowse') emit('browse', cur);
  else if (b.id === 'micBtn') micToggle();
  else if (b.id === 'impAudio') $('#audioFile').click();
  else if (b.id === 'clSplit') splitSelClip();
  else if (b.id === 'clDup') duplicateSelClip();
  else if (b.id === 'clDel') deleteSelClip();
  else if (b.id === 'clMatch') {
    const f = findClip(); if (!f) return; const bpm = parseFloat(prompt('What tempo (BPM) was this audio recorded at?', String(S.tempo)));
    if (!bpm || bpm < 30 || bpm > 300) return; pushUndo(); f.c.rate = clamp(r4(S.tempo / bpm), .5, 2); f.c.warp = true; requestWarp(f.c); markDirty(); renderInspector(); requestDraw(); emit('change');
  }
  else if (b.id === 'arpGo') arpSelection({ pattern: $('#arpPat').value, step: +$('#arpRate').value, gate: .9 });
  else if (b.dataset.sel) {
    const a = b.dataset.sel;
    if (a === 'del') deleteSelected(); else if (a === 'dup') duplicateSel(); else shiftSel(0, +a.slice(1));
  }
});

function syncTopbar() {
  $('#tempo').value = S.tempo; $('#swing').value = Math.round(S.swing * 100); $('#keyRoot').value = S.keyRoot; $('#keyScale').value = S.scale; $('#barsSel').value = S.bars;
  $('#loopBtn').classList.toggle('on', S.loop.on); $('#metroBtn').classList.toggle('on', ui.metro); $('#recBtn').classList.toggle('armed', ui.rec);
  $('#mGain').value = S.master.gain; $('#mRev').value = S.master.reverb; $('#mComp').checked = S.master.comp; $('#mSamples').checked = S.master.samples !== false;
  $('#mgV').textContent = fmt.pct(S.master.gain); $('#mrV').textContent = fmt.pct(S.master.reverb);
  $('#songName').value = project.name || ''; $('#projLabel').textContent = project.name || 'Project';
  $('#varyBtn').disabled = !S.genre;
  $('#delBtn').disabled = !!project.shared; $('#shareBtn').hidden = !!project.shared;
}
function fullRefresh() {
  computeRows(); resizeAll(); scrollToNotes(); syncTopbar(); renderTracks(); renderInspector(); syncUndoButtons(); requestDraw(); scheduleCharts(); emit('refresh', 'full');
}

/* ---------- views ---------- */
function setView(v) {
  ui.view = v;
  $$('#tabs [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
  if (v === 'roll') { resizeAll(); requestDraw(); }
  emit('view', v);
}
$$('#tabs [data-view]').forEach(b => { b.onclick = () => setView(b.dataset.view); });
$('#inspBtn').onclick = () => { const g = $('#grid'); g.classList.toggle('no-insp'); $('#inspBtn').classList.toggle('on', !g.classList.contains('no-insp')); setTimeout(resizeAll, 30); };
$('#labBtn').onclick = () => { const l = $('#lab'); l.hidden = !l.hidden; $('#labBtn').classList.toggle('on', !l.hidden); setTimeout(() => { resizeAll(); drawCharts(); }, 30); };
$('#hintX').onclick = () => { $('#hint').hidden = true; try { localStorage.setItem('loom-hint', '1'); } catch (e) {} };

/* ---------- top bar controls ---------- */
$('#keyRoot').innerHTML = NN.map((n, i) => `<option value="${i}">${n}</option>`).join('');
$('#keyScale').innerHTML = Object.keys(SCALES).map(s => `<option>${s}</option>`).join('');
$('#barsSel').innerHTML = BAR_OPTIONS.map(b => `<option value="${b}">${b}</option>`).join('');
$('#snapSel').innerHTML = SNAPS.map(([n, v]) => `<option value="${v}" ${v === .25 ? 'selected' : ''}>${n}</option>`).join('');
$('#playBtn').onclick = togglePlay; $('#stopBtn').onclick = stop; $('#rewindBtn').onclick = () => seek(S.loop.on ? S.loop.start : 0);
$('#recBtn').onclick = () => { ui.rec = !ui.rec; syncTopbar(); toast(ui.rec ? 'Record armed: press play, then use the keyboard (A–L) or a MIDI keyboard' : 'Record disarmed'); };
$('#loopBtn').onclick = () => { pushUndo(); S.loop.on = !S.loop.on; if (S.loop.end <= S.loop.start) S.loop = { on: true, start: 0, end: total() }; markDirty(); syncTopbar(); requestDraw(); emit('change'); };
$('#metroBtn').onclick = () => { ui.metro = !ui.metro; syncTopbar(); };
$('#tempo').onchange = e => { pushUndo(); S.tempo = clamp(Math.round(+e.target.value) || 96, 30, 240); reanchor(); applyAllBuses(); markDirty(); syncTopbar(); requestDraw(); emit('change'); };
$('#swing').oninput = e => { sliderUndo(); S.swing = +e.target.value / 100; markDirty(); };
$('#keyRoot').onchange = e => { pushUndo(); S.keyRoot = +e.target.value; S.key = NN[S.keyRoot] + ' ' + S.scale.toLowerCase(); markDirty(); requestDraw(); scheduleCharts(); emit('refresh', 'key'); };
$('#keyScale').onchange = e => { pushUndo(); S.scale = e.target.value; S.key = NN[S.keyRoot] + ' ' + S.scale.toLowerCase(); markDirty(); requestDraw(); scheduleCharts(); emit('refresh', 'key'); };
$('#barsSel').onchange = e => {
  const n = +e.target.value, end = Math.max(0, ...S.tracks.flatMap(t => [...t.notes.map(x => x.start + x.duration), ...t.clips.map(clipEnd)]));
  if (n * 4 < end && !confirm('Some material sits past the new end of the song and will not play. Continue?')) { syncTopbar(); return; }
  pushUndo(); S.bars = n; S.loop = { on: S.loop.on, start: Math.min(S.loop.start, n * 4 - 1), end: Math.min(S.loop.end, n * 4) }; markDirty(); syncTopbar(); resizeAll(); scheduleCharts(); emit('refresh', 'bars');
};
$('#mGain').oninput = e => { sliderUndo(); S.master.gain = +e.target.value; $('#mgV').textContent = fmt.pct(S.master.gain); if (T.G) A.applyMaster(T.G, S.master); markDirty(); };
$('#mRev').oninput = e => { sliderUndo(); S.master.reverb = +e.target.value; $('#mrV').textContent = fmt.pct(S.master.reverb); if (T.G) A.applyMaster(T.G, S.master); markDirty(); };
$('#mComp').onchange = e => { pushUndo(); S.master.comp = e.target.checked; if (T.G) A.applyMaster(T.G, S.master); markDirty(); };
$('#mSamples').onchange = e => { pushUndo(); S.master.samples = e.target.checked; markDirty(); refreshSamples(); toast(S.master.samples ? 'Using recorded samples where available' : 'Synth sounds only'); };
$$('#tools button').forEach(b => b.onclick = () => setTool(b.dataset.tool));
function setTool(k) { ui.tool = k; $$('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === k)); }
$('#snapSel').onchange = e => { ui.snap = +e.target.value; ui.lastLen = ui.snap; requestDraw(); emit('refresh', 'snap'); };
$('#zoom').oninput = e => setZoom(+e.target.value);
$('#followChk').onchange = e => { ui.follow = e.target.checked; };
$('#quantBtn').onclick = quantize; $('#humBtn').onclick = humanize; $('#scaleBtn').onclick = fitToKey; $('#dblBtn').onclick = repeatPattern;
$('#clearBtn').onclick = () => { const t = track(); if (!t.notes.length) return; const n = t.notes.length; pushUndo(); t.notes = []; sel.clear(); changed(); renderInspector(); toastUndo(`Cleared ${n} notes from “${t.name}”`); };
$('#undoBtn').onclick = doUndo; $('#redoBtn').onclick = doRedo;
$('#chordToggle').onclick = () => { ui.chords = !ui.chords; $('#chordToggle').classList.toggle('on', ui.chords); $('#chordBar').hidden = !ui.chords; setTimeout(resizeAll, 30); };
$('#songName').oninput = e => { project.name = e.target.value; $('#projLabel').textContent = project.name || 'Project'; markDirty(); };
$('#varyBtn').onclick = () => vary();
document.addEventListener('pointerdown', e => { $$('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });

/* ---------- beats ---------- */
function applyBeat(id) {
  const beat = DATA.beats.find(b => b.id === id), t = track(); if (!beat) return false;
  if (t.element !== 'drums') { toast('Select a Drums track to use beat presets.'); return false; }
  pushUndo(); t.notes = GN.beatNotes(beat, S.bars); sel.clear(); computeRows(); resizeAll(); changed(); renderInspector();
  const [lo, hi] = beat.bpm; toast(`${beat.name} written to ${t.name}` + (S.tempo < lo - 8 || S.tempo > hi + 8 ? ` — it usually sits around ${lo}–${hi} BPM` : ''));
  return true;
}
$('#beatSel').onchange = e => { const id = e.target.value; e.target.value = ''; if (id) applyBeat(id); };
function fillBeatMenu() {
  const fam = {}; DATA.beats.forEach(b => (fam[b.family] = fam[b.family] || []).push(b));
  $('#beatSel').innerHTML = '<option value="">beat…</option>' + Object.entries(fam).map(([f, list]) => `<optgroup label="${esc(f)}">${list.map(b => `<option value="${b.id}">${esc(b.name)} (${b.bpm[0]}–${b.bpm[1]})</option>`).join('')}</optgroup>`).join('');
}

/* ---------- genre templates ---------- */
// Turn a generated plan into a project: as a new project, or replacing this one's tracks (recorded / imported audio tracks are kept).
async function applyPlan(plan, name, mode, extra = {}) {
  const st = fromPlan(plan, [], extra);
  if (mode === 'new') {
    if (dirty && !confirm('Discard unsaved changes in the current project?')) return false;
    const p = await api('/projects', { method: 'POST', body: JSON.stringify({ name, bpm: st.tempo, state: st }) });
    projects.unshift(p); adopt(p);
  } else {
    pushUndo(); if (T.playing) { halt(); setPlayUI(); }
    const keep = S.tracks.filter(isAudioTrack), st2 = fromPlan(plan, keep, extra);
    st2.master = S.master; S = project.state = st2; cur = 0; sel.clear(); ui.clipSel = null; if (T.G) { A.killAll(T.G); A.applyMaster(T.G, S.master); }
    fullRefresh(); markDirty(); refreshSamples();
  }
  return true;
}
async function generateFromRecipe(recipe, seed, mode) {
  if (!(await applyPlan(GN.generate(recipe, DATA.structures, DATA.beats, seed), recipe.name + ' sketch', mode))) return;
  toast(`${recipe.name}: ${recipe.tempo} BPM, ${NN[recipe.root]} ${recipe.scale.toLowerCase()} — press play`);
}
function vary() {
  if (!S.genre) { toast('Vary works on songs made from a genre template.'); return; }
  const base = DATA.genres.find(g => g.id === S.genre.id); if (!base) return;
  const seed = Math.floor(Math.random() * 99999) + 1, plan = GN.generate({ ...base, root: S.keyRoot }, DATA.structures, DATA.beats, seed);
  pushUndo(); let n = 0;
  plan.tracks.forEach(pt => { const t = S.tracks.find(x => x.role === pt.role); if (t) { t.notes = cleanNotes(pt.notes); n++; } });
  S.genre.seed = seed; sel.clear(); computeRows(); resizeAll(); markDirty(); changed(); renderInspector(); emit('refresh', 'full');
  toast(n ? `New variation #${seed} written to ${n} tracks` : 'No template tracks to vary');
}

/* ---------- keyboard + MIDI keyboard ---------- */
const held = new Map();
function recNoteOn(id, pitch, vel) {
  const t = track(); audition(t, pitch, vel); ui.pressed = pitch; requestDraw();
  if (ui.rec && T.playing && !isAudioTrack(t)) {
    pushUndo(); const n = { pitch, start: Math.max(0, snapRound(beatNow())), duration: ui.snap, velocity: clamp(vel, .05, 1) }; t.notes.push(n); held.set(id, n); computeRows(); resizeAll(); changed();
  }
}
function recNoteOff(id) {
  ui.pressed = null; requestDraw(); const n = held.get(id);
  if (n) { held.delete(id); const d = r4(beatNow() - n.start); n.duration = d > 0 && d < 16 ? Math.max(ui.snap, d) : ui.snap; changed(); }
}
function finishHeld() { held.forEach(n => { n.duration = Math.max(ui.snap, r4(beatNow() - n.start)); if (n.duration > total()) n.duration = ui.snap; }); if (held.size) { held.clear(); changed(); } }
document.addEventListener('keydown', e => {
  const tag = e.target.tagName, type = e.target.type, mod = e.ctrlKey || e.metaKey;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox'].includes(type));
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing || document.querySelector('dialog[open]')) return;
  if (e.code === 'Space') { e.preventDefault(); if (tag === 'BUTTON') e.target.blur(); togglePlay(); return; }
  if (tag === 'INPUT') return;
  for (const h of keyHandlers) if (h(e)) return;
  const k = e.key.toLowerCase();
  if (mod) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (k === 'y') { e.preventDefault(); doRedo(); }
    else if (k === 'e') { e.preventDefault(); splitSelClip(); }
    else if (ui.view === 'roll' || ui.view === 'steps') {
      if (k === 'a') { e.preventDefault(); sel.clear(); track().notes.forEach(n => sel.add(n)); requestDraw(); renderInspector(); }
      else if (k === 'c') { e.preventDefault(); copySel(false); } else if (k === 'x') { e.preventDefault(); copySel(true); }
      else if (k === 'v') { e.preventDefault(); pasteAt(snapRound(beatNow())); } else if (k === 'd') { e.preventDefault(); duplicateSel(); }
    } else if (k === 'd') { e.preventDefault(); duplicateSelClip(); }
    return;
  }
  switch (e.code) {
    case 'Enter': e.preventDefault(); stop(); return;
    case 'Home': seek(S.loop.on ? S.loop.start : 0); return;
    case 'Delete': case 'Backspace': if (ui.clipSel && ui.view === 'arrange') { e.preventDefault(); deleteSelClip(); } else if (sel.size) { e.preventDefault(); deleteSelected(); } return;
    case 'ArrowUp': if (sel.size) { e.preventDefault(); shiftSel(0, e.shiftKey ? 12 : 1); } return;
    case 'ArrowDown': if (sel.size) { e.preventDefault(); shiftSel(0, e.shiftKey ? -12 : -1); } return;
    case 'ArrowLeft': if (sel.size) { e.preventDefault(); shiftSel(-ui.snap, 0); } return;
    case 'ArrowRight': if (sel.size) { e.preventDefault(); shiftSel(ui.snap, 0); } return;
    case 'Escape': sel.clear(); ui.clipSel = null; requestDraw(); renderInspector(); emit('refresh', 'clip'); return;
    case 'Digit1': setTool('draw'); return; case 'Digit2': setTool('select'); return; case 'Digit3': setTool('erase'); return;
  }
  if (e.key === '?') { emit('help'); return; }
  if (k === 'z' || k === 'x') { ui.octave = clamp(ui.octave + (k === 'x' ? 1 : -1), 0, 8); toast('Keyboard octave C' + ui.octave); return; }
  if (e.repeat || !(k in KEYMAP)) return;
  const t = track(), idx = KEYMAP[k];
  let pitch; if (t.element === 'drums') { pitch = DRUM_KEYS[idx]; if (pitch === undefined) return; } else pitch = clamp(ui.octave * 12 + 12 + idx, 0, 127);
  recNoteOn(k, pitch, .85);
});
document.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in KEYMAP) recNoteOff(k); });
let midiOn = false;
$('#midiInBtn').onclick = async () => {
  if (!navigator.requestMIDIAccess) { toast('This browser has no Web MIDI support (try Chrome, Edge or Brave).'); return; }
  if (midiOn) { toast('MIDI keyboard already connected.'); return; }
  try {
    const acc = await navigator.requestMIDIAccess(), hook = () => acc.inputs.forEach(i => { i.onmidimessage = onMidi; });
    hook(); acc.onstatechange = hook; midiOn = true; $('#midiInBtn').classList.add('on');
    toast(acc.inputs.size ? `MIDI input ready (${[...acc.inputs.values()].map(i => i.name).join(', ')})` : 'MIDI enabled — plug in a keyboard');
  } catch (e) { toast('MIDI access was blocked: ' + (e.message || e.name)); }
};
function onMidi(m) {
  const [st, d1, d2] = m.data, kind = st & 0xF0;
  if (kind === 0x90 && d2 > 0) recNoteOn('m' + d1, d1, d2 / 127); else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) recNoteOff('m' + d1);
}

/* ---------- microphone ---------- */
const micState = { active: false };
let mediaRec = null, micStream = null, micChunks = [], micStartBeat = 0, micTrackId = null;
function micToggle() { micState.active ? micStop() : micBegin(); }
async function micBegin() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('This browser cannot record from a microphone.'); return; }
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch (e) { toast('Microphone unavailable: ' + (e.message || e.name)); return; }
  micTrackId = track().id; micChunks = []; micStartBeat = T.playing ? beatNow() : snapRound(ui.cursor);
  if (!T.playing) T.pos = micStartBeat;
  mediaRec = new MediaRecorder(micStream);
  mediaRec.ondataavailable = ev => { if (ev.data.size) micChunks.push(ev.data); };
  mediaRec.onstop = async () => {
    micStream.getTracks().forEach(t => t.stop());
    try {
      const buf = await ensureAudio().decodeAudioData(await new Blob(micChunks).arrayBuffer());
      const wav = encodeWavMono(buf), idx = S.tracks.findIndex(t => t.id === micTrackId), n = (S.tracks[idx]?.clips.length || 0) + 1;
      await addAudioFile(new File([wav], `take ${n}.wav`, { type: 'audio/wav' }), { track: idx, start: micStartBeat });
    } catch (e) { toast('Could not save the recording: ' + (e.message || 'decode failed')); }
    renderInspector();
  };
  mediaRec.start(); micState.active = true; if (!T.playing) play(); renderInspector();
}
function micStop() { if (!micState.active) return; micState.active = false; try { mediaRec.stop(); } catch (e) {} if (T.playing) pause(); renderInspector(); }
$('#audioFile').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; await addAudioFiles(files); };

/* ---------- project I/O ---------- */
function fillProjects() { $('#projectSelect').innerHTML = projects.map(p => `<option value="${p.id}">${esc(p.name)}${p.shared ? ' — shared by ' + esc(p.owner_name || 'a friend') : ''}</option>`).join(''); if (project) $('#projectSelect').value = project.id; }
function adopt(p) {
  if (T.playing) { halt(); setPlayUI(); }
  project = p; S = project.state = normalize(p.state); cur = 0; sel.clear(); ui.clipSel = null; undo.length = redo.length = 0; ui.cursor = 0; assets.clear();
  T.pos = 0; if (T.G) { A.killAll(T.G); A.applyMaster(T.G, S.master); }
  fullRefresh(); dirty = false; $('#dirtyDot').hidden = true; fillProjects(); refreshSamples();
  const ids = new Set(S.tracks.flatMap(t => t.clips.map(c => c.asset)));
  ids.forEach(id => fetchAsset(id).then(() => { S.tracks.forEach(t => t.clips.forEach(c => { if (c.asset === id) requestWarp(c); })); requestDraw(); emit('refresh', 'asset'); }).catch(() => toast('Some audio for this project could not be loaded.')));
}
async function loadProjects(pickId) {
  projects = await api('/projects');
  if (!projects.length) projects = [await api('/projects', { method: 'POST', body: JSON.stringify({ name: 'First room', bpm: 78, state: starterState() }) })];
  adopt(projects.find(x => x.id === pickId) || projects[0]);
}
$('#projectSelect').onchange = async e => {
  if (dirty && !confirm('Discard unsaved changes?')) { $('#projectSelect').value = project.id; return; }
  adopt(await api('/projects/' + e.target.value)); $('#projMenu').open = false;
};
$('#newBtn').onclick = async () => {
  $('#projMenu').open = false; if (dirty && !confirm('Discard unsaved changes?')) return;
  const name = 'Untitled ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const p = await api('/projects', { method: 'POST', body: JSON.stringify({ name, bpm: 96, state: blankState() }) });
  projects.unshift(p); adopt(p); toast('New room with all five elements');
};
$('#delBtn').onclick = async () => {
  $('#projMenu').open = false; if (!confirm(`Delete "${project.name}", its history and its audio? This cannot be undone.`)) return;
  await api('/projects/' + project.id, { method: 'DELETE' }); dirty = false; await loadProjects();
};
// Saves with the revision we started from, so a newer save by a collaborator is reported instead of silently overwritten.
async function save(force = false) {
  if (!project || !project.id) return false;
  const name = (project.name || 'Untitled').trim() || 'Untitled', body = { name, bpm: S.tempo, state: S };
  if (!force) body.base_revision = project.revision;
  try {
    const res = await fetch('/api/projects/' + project.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, credentials: 'include', body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (res.status === 409) { emit('conflict', d); return false; }
    if (!res.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Save failed (' + res.status + ')');
    project.name = name; project.revision = d.revision; dirty = false; $('#dirtyDot').hidden = true; fillProjects(); syncTopbar(); toast('Saved (revision ' + d.revision + ')');
    return true;
  } catch (e) { toast('Save failed: ' + e.message); return false; }
}
// Replace the open project with a newer copy from the server, keeping the selected track and playhead.
function adoptRemote(p) {
  const id = track()?.id, pos = beatNow(); adopt(p);
  const i = S.tracks.findIndex(t => t.id === id); if (i > 0) selectTrack(i); T.pos = pos; ui.cursor = pos; requestDraw();
}
$('#saveBtn').onclick = () => save();
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
$('#historyBtn').onclick = () => { $('#projMenu').open = false; emit('history'); };
$('#historyList').addEventListener('click', async e => {
  const b = e.target.closest('[data-rev]'); if (!b) return;
  if (dirty && !confirm('Unsaved changes will be replaced by that revision.')) return;
  const r = await api(`/projects/${project.id}/versions/${b.dataset.rev}/restore`, { method: 'POST' });
  $('#historyDlg').close(); adopt({ ...project, state: r.state, revision: r.revision }); toast('Restored as revision ' + r.revision);
});
$('#logoutBtn').onclick = async () => { if (dirty && !confirm('Leave without saving?')) return; dirty = false; await api('/auth/logout', { method: 'POST' }); location.href = '/'; };

/* ---------- MIDI import / export, WAV, stems ---------- */
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
const fileBase = () => (project.name || 'loom-project').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'loom-project';
$('#midiBtn').onclick = () => {
  $('#exportMenu').open = false;
  const bytes = GN.encodeMidi(S, A.GM_PROGRAM); download(new Blob([bytes], { type: 'audio/midi' }), fileBase() + '.mid'); toast('MIDI exported');
};
const GM_REVERSE = (() => { const m = {}; Object.entries(A.GM_PROGRAM).forEach(([name, p]) => { if (!(p in m)) m[p] = name; }); return m; })();
$('#importMidiBtn').onclick = () => { $('#projMenu').open = false; $('#midiFile').click(); };
$('#midiFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const m = GN.parseMidi(await file.arrayBuffer()); if (!m.tracks.length) { toast('That MIDI file has no notes.'); return; }
    pushUndo(); let added = 0;
    m.tracks.slice(0, Math.max(0, 24 - S.tracks.length)).forEach(pt => {
      const drums = pt.channel === 9, avg = pt.notes.reduce((s, n) => s + n.pitch, 0) / pt.notes.length;
      const element = drums ? 'drums' : [52, 53, 54, 55].includes(pt.program) ? 'vox' : (pt.program >= 32 && pt.program <= 39) || avg < 48 ? 'bass' : 'mids';
      const list = A.ELEMENTS[element].instruments, gm = GM_REVERSE[pt.program], instrument = !drums && gm && list.includes(gm) ? gm : list[0];
      S.tracks.push(newTrack(element, instrument, (pt.name || element).slice(0, 40), cleanNotes(pt.notes))); added++;
    });
    S.tempo = m.tempo; const end = Math.max(...S.tracks.flatMap(t => t.notes.map(n => n.start + n.duration))); ensureBars(end);
    syncTopbar(); markDirty(); selectTrack(S.tracks.length - 1); toast(`Imported ${added} track${added === 1 ? '' : 's'} at ${m.tempo} BPM`);
  } catch (err) { toast('MIDI import failed: ' + err.message); }
};
async function renderMix(opts) { return A.renderWav(S, getBuffer, opts); }
$('#wavBtn').onclick = async () => {
  $('#exportMenu').open = false; toast('Rendering mix…');
  try {
    const from = S.loop.on ? S.loop.start : 0, to = S.loop.on ? S.loop.end : total();
    const r = await renderMix({ from, to }); download(r.blob, fileBase() + '.wav'); toast(r.peak > .98 ? 'WAV rendered (levels reduced to avoid clipping)' : 'WAV rendered');
  } catch (e) { toast('Render failed: ' + e.message); }
};
let lameLoading = null;
const loadLame = () => (window.lamejs && window.lamejs.Mp3Encoder) ? Promise.resolve() : (lameLoading = lameLoading || new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = '/assets/vendor/lame.min.js'; s.onload = () => (window.lamejs && window.lamejs.Mp3Encoder ? res() : rej(new Error('MP3 encoder did not start'))); s.onerror = () => rej(new Error('could not load the MP3 encoder')); document.head.appendChild(s);
}));
// 16-bit PCM -> MP3 with LAME (LGPL; shipped unmodified as its own file, loaded only when you export an MP3).
async function encodeMp3(buf, kbps = 192, gain = 1) {
  await loadLame(); const ch = Math.min(2, buf.numberOfChannels), enc = new window.lamejs.Mp3Encoder(ch, buf.sampleRate, kbps), parts = [], block = 1152;
  const pcm = c => { const f = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)), o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) o[i] = clamp(f[i] * gain, -1, 1) * 32767; return o; };
  const L2 = pcm(0), R2 = ch > 1 ? pcm(1) : null;
  for (let i = 0, k = 0; i < L2.length; i += block, k++) {
    const out = ch > 1 ? enc.encodeBuffer(L2.subarray(i, i + block), R2.subarray(i, i + block)) : enc.encodeBuffer(L2.subarray(i, i + block));
    if (out.length) parts.push(new Uint8Array(out)); if (k % 400 === 399) await new Promise(r => setTimeout(r));
  }
  const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}
$('#mp3Btn').onclick = async () => {
  $('#exportMenu').open = false; toast('Rendering and encoding the MP3…');
  try {
    const from = S.loop.on ? S.loop.start : 0, to = S.loop.on ? S.loop.end : total(), r = await renderMix({ from, to });
    download(await encodeMp3(r.buffer, 192, r.peak > .98 ? .98 / r.peak : 1), fileBase() + '.mp3'); toast('MP3 exported (192 kbps)');
  } catch (e) { toast('MP3 export failed: ' + e.message); }
};
$('#stemBtn').onclick = async () => {
  $('#exportMenu').open = false;
  const list = S.tracks.filter(t => t.notes.length || t.clips.length); if (!list.length) { toast('Nothing to export yet.'); return; }
  if (!confirm(`Render ${list.length} stems? Your browser will download ${list.length} WAV files (allow multiple downloads if it asks).`)) return;
  const from = S.loop.on ? S.loop.start : 0, to = S.loop.on ? S.loop.end : total();
  for (let i = 0; i < list.length; i++) {
    toast(`Stem ${i + 1}/${list.length}: ${list[i].name}`);
    try { const r = await renderMix({ from, to, only: list[i].id }); download(r.blob, `${fileBase()}-${String(i + 1).padStart(2, '0')}-${list[i].name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.wav`); } catch (e) { toast('Stem failed: ' + e.message); }
    await new Promise(r => setTimeout(r, 350));
  }
  toast('Stems exported');
};

/* ---------- public surface for studio-views.js ---------- */
window.LoomApp = {
  A, GN, DATA, ui, sel, T, SCALES, SNAPS, BAR_OPTIONS, NN, KEYW, DRUM_ABBR, LAYERABLE,
  get S() { return S; }, get cur() { return cur; }, get project() { return project; }, get projects() { return projects; },
  track, spb, total, clipEnd, isAudioTrack, noteName, rowLabel, cleanAuto, esc, uid, r4, clamp, newTrack, normalize, cleanNotes,
  pushUndo, markDirty, changed, requestDraw, seek, beatNow, toast: m => toast(m), audition, selectTrack, renderTracks, renderInspector, fullRefresh, computeRows, resizeAll,
  applyAllBuses, snapRound, findClip, getBuffer, getAsset, fetchAsset, addAudioFiles, micToggle, micState, splitSelClip, deleteSelClip, duplicateSelClip, ensureBars,
  applyPlan, fromPlan, refreshSamples, requestWarp, encodeMp3, uploadAsset, save, adoptRemote, adopt, isDirty: () => dirty, insertNotes, insertPattern, arpSelection, applyBeat, changeInstrument, previewInstrument, removeTrack, moveTrack, elementOf, toastUndo, deleteSelected, generateFromRecipe, vary, setView, on, emit, keyHandlers, play, stop, togglePlay, ensureAudio, syncTopbar, fillBeatMenu, snapshot,
};

/* ---------- boot ---------- */
async function boot() {
  await bootstrap();
  const me = await getMe(); if (!me) { location.href = '/auth'; return; }
  $('#userName').textContent = me.user.display_name;
  csrf = me.csrf_token;                                          // session token from site.js; bootstrap() only gave the pre-login one
  S = blankState(); project = { id: 0, name: '', state: S };
  A.loadManifest();
  try { const [g, b] = await Promise.all([api('/genres'), api('/beats')]); DATA.genres = g.genres; DATA.structures = g.structures; DATA.beats = b.beats; fillBeatMenu(); }
  catch (e) { toast('Genre and beat data could not be loaded.'); }
  try { if (!localStorage.getItem('loom-hint')) $('#hint').hidden = false; } catch (e) { $('#hint').hidden = false; }
  new ResizeObserver(() => { resizeAll(); }).observe(document.body);
  await loadProjects();
  emit('refresh', 'boot'); requestAnimationFrame(frame);
  window.LOOM = { get S() { return S; }, get T() { return T; }, A, GN, DATA, play, stop, normalize, beatNow, app: window.LoomApp };
}
document.addEventListener('DOMContentLoaded', boot);
})();

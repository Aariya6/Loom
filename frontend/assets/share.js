/* LOOM public share page: watch the walkthrough, play the song, read the transcript and summary, comment and react.
   No account needed. Everything shown is escaped; the song is rendered in the browser with the same engine as the studio. */
(() => {
'use strict';
const A = window.LoomAudio, GN = window.LoomGen;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmtT = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const token = location.pathname.replace(/\/+$/, '').split('/').pop();
const EMOJI = ['👍', '🔥', '❤️', '😮', '👏', '🎵'];
const api = (path, opts) => fetch('/api/public/' + token + path, opts);
let data = null, S = null, ctx = null, comments = [], reactions = {}, activeKind = 'song', allowComments = true;
const assets = new Map();
let songOffset = 0, songPlaying = false;

function fail(msg) { $('#shTitle').textContent = 'Not available'; const e = $('#shError'); e.textContent = msg; e.hidden = false; }

/* ---------- build a playable project from the shared snapshot ---------- */
function prepare(state) {
  const tracks = (state.tracks || []).filter(t => t && A.ELEMENTS[t.element] && (t.notes || t.clips)).map((t, i) => ({
    id: t.id || 't' + i, name: t.name || 'Track', element: t.element, instrument: t.instrument, mute: !!t.mute, solo: !!t.solo, layer: t.layer || null,
    notes: Array.isArray(t.notes) ? t.notes : [], clips: Array.isArray(t.clips) ? t.clips : [], auto: t.auto && typeof t.auto === 'object' ? t.auto : {},
    params: { ...A.BASE_PARAMS, ...(A.INSTRUMENT_DEFAULTS[t.instrument] || {}), ...(t.params || {}) },
  }));
  return { tempo: state.tempo || 96, swing: state.swing || 0, bars: state.bars || 8, lyrics: Array.isArray(state.lyrics) ? state.lyrics : [], key: state.key, keyRoot: state.keyRoot || 0, scale: state.scale, markers: state.markers || [], tracks, master: { gain: .8, reverb: .6, comp: true, ...(state.master || {}) } };
}
async function loadAssets() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const ids = [...new Set(S.tracks.flatMap(t => t.clips.map(c => c.asset)))];
  await Promise.all(ids.map(async id => {
    try { const r = await api('/media/' + id); if (r.ok) assets.set(id, await ctx.decodeAudioData(await r.arrayBuffer())); } catch (e) { /* a missing clip simply stays silent */ }
  }));
  await Promise.all(S.tracks.flatMap(t => t.clips).filter(c => c.warp && c.rate && c.rate !== 1).map(c => assets.has(c.asset) ? A.warpEnsure(c, assets.get(c.asset)) : null));
}
// Real-time playback (same scheduler idea as the studio): starts instantly, nothing is pre-rendered.
let G = null, songDur = 0, anchor = { t0: 0, b0: 0 }, sched = 0, jumpNext = false, pumpTimer = 0;
const spb = () => 60 / S.tempo, total = () => S.bars * 4, clipEnd = c => c.start + c.len / (c.rate || 1) / spb();
async function renderSong() {
  if (!S.tracks.some(t => t.notes.length || t.clips.length)) { $('#songStatus').textContent = 'This project has no music yet.'; return; }
  if (S.master.samples !== false) { $('#songStatus').textContent = 'Loading recorded sounds…'; await A.loadSamples(S.tracks.flatMap(t => [t.instrument, t.layer && t.layer.instrument]).filter(Boolean)); }
  G = A.makeGraph(ctx); A.applyMaster(G, S.master); songDur = total() * spb() + 1.5;
  $('#songPlay').disabled = false; $('#songSeek').disabled = false;
  $('#songStatus').textContent = `${S.key || ''} · ${S.tempo} BPM · ${fmtT(total() * spb())}`.replace(/^ · /, '');
  drawMarks(); drawSections();
}
const beatNow = () => (songPlaying ? Math.max(0, anchor.b0 + (ctx.currentTime - anchor.t0) / spb()) : songOffset / spb());
const songTime = () => Math.min(songDur, beatNow() * spb());
function schedule(from, to, jump) {
  const sp = spb(), env = { tempo: S.tempo, anySolo: S.tracks.some(t => t.solo), samples: S.master.samples !== false }, now = ctx.currentTime, at = b => Math.max(now, anchor.t0 + (A.swingTime(b, S.swing) - anchor.b0) * sp);
  S.tracks.forEach(t => {
    A.scheduleAuto(G, t, env, from, to, b => anchor.t0 + (b - anchor.b0) * sp, jump);
    if (t.mute || (env.anySolo && !t.solo)) return;
    if (t.instrument !== 'Audio Clips') for (const n of t.notes) if (n.start >= from && n.start < to) A.playNote(G, t, n, at(n.start), n.duration * sp * .98, env);
    for (const c of t.clips) {
      const src = A.clipSource(c, id => assets.get(id) || null); if (!src) continue;
      if (c.start >= from && c.start < to) A.playClip(G, t, src.clip, src.buf, at(c.start), env, 0);
      else if (jump && c.start < from && clipEnd(c) > from) A.playClip(G, t, src.clip, src.buf, Math.max(now, anchor.t0 + (from - anchor.b0) * sp), env, (from - c.start) * sp);
    }
  });
}
function pump() {
  const horizon = anchor.b0 + (ctx.currentTime + .2 - anchor.t0) / spb();
  if (horizon > sched) { schedule(sched, Math.min(horizon, total()), jumpNext); jumpNext = false; sched = horizon; }
  if (songTime() >= songDur - .05) { stopSong(false); songOffset = 0; ui(); }
}
function playSong(from = songOffset) {
  if (!G) return; if (ctx.state !== 'running') ctx.resume(); stopSong(false);
  const vid = $('#vid'); if (vid && !vid.paused) vid.pause();
  songOffset = Math.min(Math.max(0, from), songDur - .1); anchor = { t0: ctx.currentTime + .05, b0: songOffset / spb() }; sched = anchor.b0; jumpNext = true;
  songPlaying = true; pumpTimer = setInterval(pump, 25); pump(); activeKind = 'song'; ui();
}
function stopSong(keep = true) { if (songPlaying && keep) songOffset = songTime(); clearInterval(pumpTimer); if (G) A.killAll(G); songPlaying = false; }
$('#songPlay').onclick = () => { songPlaying ? (stopSong(), ui()) : playSong(); };
$('#songSeek').oninput = e => { if (!songDur) return; const t = e.target.value / 1000 * songDur; activeKind = 'song'; songPlaying ? playSong(t) : (songOffset = t, ui()); };
function ui() {
  $('#songPlay').textContent = songPlaying ? '⏸' : '▶';
  if (songDur) { const t = songTime(); $('#songTime').textContent = fmtT(t); if (document.activeElement !== $('#songSeek')) $('#songSeek').value = Math.round(t / songDur * 1000); }
  const vid = $('#vid'), vt = vid && !$('#videoCard').hidden ? vid.currentTime : 0;
  const t = activeKind === 'video' ? vt : songTime();
  $('#cAt').textContent = `Commenting on the ${activeKind === 'video' ? 'walkthrough' : 'song'} at ${fmtT(t)}`;
  if (lyr.length) { const bt = songTime() / spb(); let k = -1; for (let i = 0; i < lyr.length; i++) if (lyr[i].t <= bt + .01) k = i; if (k !== lyrNow) { lyrNow = k; document.querySelectorAll('#lyrics .ly').forEach((el, i) => el.classList.toggle('now', i === k)); const el = document.querySelectorAll('#lyrics .ly')[k]; if (el && songPlaying) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  document.querySelectorAll('.cm').forEach(el => el.classList.toggle('now', el.dataset.kind === activeKind && Math.abs(+el.dataset.at - t) < 2));
  document.querySelectorAll('.tl').forEach(el => el.classList.toggle('now', activeKind === 'video' && t >= +el.dataset.t && t < +el.dataset.end));
}
function loop() { ui(); requestAnimationFrame(loop); }
function drawMarks() {
  if (!songDur) return; const d = songDur;
  $('#songMarks').innerHTML = S.markers.map(m => `<i class="sec" style="left:${m.beat * 60 / S.tempo / d * 100}%" title="${esc(m.name)}"></i>`).join('') + comments.filter(c => c.kind === 'song').map(c => `<i style="left:${Math.min(100, c.at / d * 100)}%" title="${esc(c.author)}: ${esc(c.body)}"></i>`).join('');
}
function drawSections() {
  if (!songDur) return; const marks = S.markers.slice().sort((a, b) => a.beat - b.beat);
  $('#songSections').innerHTML = marks.map(m => `<button data-s="${m.beat * 60 / S.tempo}">${esc(m.name)}<small>${fmtT(m.beat * 60 / S.tempo)}</small></button>`).join('');
}
$('#songSections').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) playSong(+b.dataset.s); });

/* ---------- comments + reactions ---------- */
function renderComments() {
  $('#cCount').textContent = comments.length;
  $('#cList').innerHTML = comments.map(c => `<div class="cm" data-kind="${c.kind}" data-at="${c.at}"><button class="when ${c.kind}" data-k="${c.kind}" data-at="${c.at}" title="Jump to ${fmtT(c.at)}">${c.kind === 'video' ? '🎬' : '🎵'} ${fmtT(c.at)}</button><div><span class="who">${esc(c.author)}</span><div class="txt">${esc(c.body)}</div></div></div>`).join('') || '<p class="note">No comments yet — be the first.</p>';
  drawMarks();
}
function seekTo(kind, at) { if (kind === 'video' && !$('#videoCard').hidden) { activeKind = 'video'; stopSong(); $('#vid').currentTime = at; $('#vid').play().catch(() => {}); } else playSong(at); }
$('#cList').addEventListener('click', e => { const b = e.target.closest('.when'); if (b) seekTo(b.dataset.k, +b.dataset.at); });
$('#cForm').addEventListener('submit', async e => {
  e.preventDefault(); const body = $('#cBody').value.trim(); if (!body) return;
  const at = activeKind === 'video' ? $('#vid').currentTime : songTime(), btn = $('#cSend'); btn.disabled = true;
  try {
    const r = await api('/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('#cName').value.trim() || 'Guest', body, at, kind: activeKind }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Could not post that comment.');
    comments.push(d); comments.sort((a, b) => a.at - b.at); $('#cBody').value = ''; renderComments();
    try { localStorage.setItem('loom-guest-name', $('#cName').value.trim()); } catch (err) {}
  } catch (err) { alert(err.message); }
  btn.disabled = false;
});
function renderReactions() {
  $('#reactBar').innerHTML = EMOJI.map(m => `<button data-e="${m}" aria-label="React ${m}">${m}<b>${reactions[m] || ''}</b></button>`).join('');
}
$('#reactBar').addEventListener('click', async e => {
  const b = e.target.closest('[data-e]'); if (!b) return; const emoji = b.dataset.e, at = activeKind === 'video' ? $('#vid').currentTime : songTime();
  const f = document.createElement('div'); f.className = 'float-emoji'; f.textContent = emoji; const r = b.getBoundingClientRect(); f.style.left = r.left + r.width / 2 - 12 + 'px'; f.style.top = r.top - 10 + 'px'; document.body.appendChild(f); setTimeout(() => f.remove(), 1500);
  reactions[emoji] = (reactions[emoji] || 0) + 1; renderReactions();
  try { await api('/reactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji, at }) }); } catch (err) { /* counts are best-effort */ }
});
async function refreshFeedback() {
  try {
    const r = await api('/comments'); if (!r.ok) return; const d = await r.json();
    comments = d.comments; allowComments = d.allow_comments; reactions = {}; d.reactions.forEach(x => { reactions[x.emoji] = (reactions[x.emoji] || 0) + 1; });
    $('#cForm').hidden = !allowComments; $('#cOff').hidden = allowComments; renderComments(); renderReactions();
  } catch (e) {}
}

/* ---------- transcript + summary ---------- */
function renderTranscript(q = '') {
  const segs = data.transcript || []; const needle = q.trim().toLowerCase();
  $('#tList').innerHTML = segs.map((s, i) => ({ s, end: segs[i + 1] ? segs[i + 1].t : s.t + 8 })).filter(({ s }) => !needle || s.text.toLowerCase().includes(needle)).map(({ s, end }) => {
    let text = esc(s.text); if (needle) { const re = new RegExp('(' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])) + ')', 'ig'); text = text.replace(re, '<mark>$1</mark>'); }
    return `<div class="tl" data-t="${s.t}" data-end="${end}"><time>${fmtT(s.t)}</time><span>${text}</span></div>`;
  }).join('') || '<p class="note">Nothing matches.</p>';
}
$('#tList').addEventListener('click', e => { const r = e.target.closest('.tl'); if (r) seekTo('video', +r.dataset.t); });
$('#tSearch').addEventListener('input', e => renderTranscript(e.target.value));
let lyr = [], lyrNow = -2;
function renderLyrics() {
  lyr = (S.lyrics || []).filter(l => l && typeof l.text === 'string'); if (!lyr.length) return;
  $('#lyrics').hidden = false;
  $('#lyrics').innerHTML = lyr.map((l, i) => `<div class="ly ${i && l.stanza !== lyr[i - 1].stanza ? 'gap' : ''}" data-t="${l.t}">${esc(l.text)}</div>`).join('');
}
document.addEventListener('click', e => { const el = e.target.closest('#lyrics .ly'); if (el && songDur) { activeKind = 'song'; playSong(+el.dataset.t * spb()); } });
function renderSummary() {
  const sm = GN.summarize(S);
  $('#sumBody').innerHTML = `<div class="sum"><h3>${esc(sm.key)} · ${sm.tempo} BPM</h3><p>${sm.bars} bars · about ${fmtT(sm.seconds)}${sm.commonChords.length ? ' · main chords ' + sm.commonChords.map(c => `<span class="chip">${esc(c)}</span>`).join('') : ''}</p>
    <table><thead><tr><th>Section</th><th>Chords</th><th>Playing</th></tr></thead><tbody>${sm.sections.map(x => `<tr><td><b>${esc(x.name)}</b><br><span class="note">bar ${x.startBar}, ${x.bars} bars</span></td><td>${x.chords.map(c => `<span class="chip">${esc(c)}</span>`).join('') || '—'}</td><td>${esc(x.playing.join(', ')) || '—'}</td></tr>`).join('')}</tbody></table>
    <h3 style="margin-top:14px">Sounds</h3><p>${sm.instruments.map(i => `<span class="chip">${esc(i.name)}: ${esc(i.instrument)}</span>`).join('')}</p></div>`;
}
$('#shTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#shTabs button').forEach(x => x.classList.toggle('on', x === b));
  ['comments', 'transcript', 'summary'].forEach(k => { $('#pane-' + k).hidden = k !== b.dataset.t; });
});

/* ---------- boot ---------- */
(async () => {
  let r; try { r = await api(''); } catch (e) { return fail('Could not reach the server.'); }
  if (!r.ok) return fail(r.status === 404 ? 'This share link does not exist or was turned off by its owner.' : 'Something went wrong loading this page.');
  data = await r.json(); S = prepare(data.state);
  document.title = `${data.title} — LOOM`; $('#shTitle').textContent = data.title; $('#shBy').textContent = data.author ? `by ${data.author} · updated ${new Date(data.updated_at).toLocaleDateString()}` : '';
  $('#shMain').hidden = false;
  try { $('#cName').value = localStorage.getItem('loom-guest-name') || ''; } catch (e) {}
  if (data.walkthrough) {
    $('#videoCard').hidden = false; const vid = $('#vid'); vid.src = `/api/public/${token}/media/${data.walkthrough.asset_id}`; activeKind = 'video';
    vid.addEventListener('play', () => { activeKind = 'video'; stopSong(); });
    vid.addEventListener('seeked', () => { activeKind = 'video'; });
  }
  if ((data.transcript || []).length) { $('#tTab').hidden = false; renderTranscript(); }
  renderSummary(); renderLyrics(); renderReactions(); await refreshFeedback(); requestAnimationFrame(loop); setInterval(refreshFeedback, 20000);
  await loadAssets(); await renderSong();
})();
})();

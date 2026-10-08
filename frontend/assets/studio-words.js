/* LOOM studio: the Words tab — poems and lyrics. Paste words, pick a mood, get a music bed fitted to the stanzas,
   read it over the music (record or import), duck the music under your voice, export timed lyrics. */
(() => {
'use strict';
const L = window.LoomApp, GN = L.GN;
const $ = (s, r = document) => r.querySelector(s);
const { esc, r4, clamp } = L;
const fmtBar = b => `${Math.floor(b / 4) + 1}.${Math.floor(b % 4) + 1}`;
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const poemGenres = () => L.DATA.genres.filter(g => g.poem);
let moodReady = false;

function fillMoods() {
  if (moodReady || !L.DATA.genres.length) return; moodReady = true;
  $('#poemMood').innerHTML = poemGenres().map(g => `<option value="${g.id}">${esc(g.name.replace('Poem · ', ''))}</option>`).join('');
  $('#poemMood').title = poemGenres().map(g => `${g.name.replace('Poem · ', '')}: ${g.blurb}`).join('\n');
}
function recipe() { return L.DATA.genres.find(g => g.id === $('#poemMood').value) || poemGenres()[0]; }
function stats() {
  const poem = GN.parsePoem($('#poemText').value), r = recipe();
  if (!poem.lines) { $('#poemStats').textContent = 'No lines yet.'; return poem; }
  const lay = GN.layoutPoem(poem, { tempo: r.tempo, wpm: +$('#poemPace').value });
  $('#poemStats').textContent = `${poem.lines} lines · ${poem.stanzas.length} stanza${poem.stanzas.length > 1 ? 's' : ''} · about ${lay.totalBars} bars (${fmtT(lay.seconds)}) at ${r.tempo} BPM` + (lay.dropped ? ` · ${lay.dropped} lines will not fit in 64 bars` : '') + (poem.truncated ? ` · first 400 lines used` : '');
  return poem;
}
$('#poemText').addEventListener('input', stats); $('#poemMood').onchange = stats; $('#poemPace').onchange = stats;
$('#poemDice').onclick = () => { $('#poemSeed').value = 1 + Math.floor(Math.random() * 9999); };

async function build() {
  const poem = GN.parsePoem($('#poemText').value), r = recipe();
  if (!poem.lines) { L.toast('Write or paste a poem first.'); return; }
  const wpm = +$('#poemPace').value, seed = clamp(parseInt($('#poemSeed').value, 10) || 1, 1, 99999), lay = GN.layoutPoem(poem, { tempo: r.tempo, wpm });
  const plan = GN.generate(r, L.DATA.structures, L.DATA.beats, seed, lay.sections);
  plan.markers = lay.markers;
  const firstLine = poem.stanzas[0].lines[0].text.slice(0, 36), extra = { lyrics: lay.lyrics, poem: { text: $('#poemText').value, mood: r.id, wpm } };
  const ok = await L.applyPlan(plan, 'Poem · ' + firstLine, $('#poemMode').value, extra); if (!ok) return;
  L.toast(`Music built: ${lay.sections.length - 2} stanza${lay.sections.length > 3 ? 's' : ''}, ${lay.totalBars} bars at ${r.tempo} BPM` + (lay.dropped ? ` — ${lay.dropped} lines did not fit` : '') + '. Press play, then read over it.');
  show();
}
$('#poemBuild').onclick = build;

/* ---------- the timeline of lines ---------- */
let lastNow = -2;
function renderList() {
  const S = L.S, list = $('#lyricList');
  if (!S.lyrics.length) { list.innerHTML = '<p class="note" style="padding:10px">Build music for a poem and each line appears here with its time. Click a line to jump to it.</p>'; return; }
  const sp = 60 / S.tempo; let html = '';
  S.lyrics.forEach((l, i) => { if (i === 0 || l.stanza !== S.lyrics[i - 1].stanza) html += `<div class="ly st">stanza ${l.stanza}</div>`; html += `<div class="ly" data-i="${i}" data-t="${l.t}"><time>${fmtBar(l.t)} · ${fmtT(l.t * sp)}</time><span>${esc(l.text)}</span></div>`; });
  list.innerHTML = html; lastNow = -2;
}
$('#lyricList').addEventListener('click', e => { const el = e.target.closest('.ly[data-t]'); if (el) L.seek(+el.dataset.t); });
L.on('frame', () => {
  const S = L.S; if (!S || !S.lyrics.length || (L.ui.view !== 'words' && !L.T.playing)) return;
  const b = L.beatNow(); let k = -1; for (let i = 0; i < S.lyrics.length; i++) if (S.lyrics[i].t <= b + .01) k = i;
  if (k === lastNow) return; lastNow = k;
  $('#lyricNow').textContent = k >= 0 ? S.lyrics[k].text : '—';
  document.querySelectorAll('#lyricList .ly[data-i]').forEach(el => el.classList.toggle('now', +el.dataset.i === k));
  const el = document.querySelector(`#lyricList .ly[data-i="${k}"]`); if (el && L.T.playing && L.ui.view === 'words') el.scrollIntoView({ block: 'nearest' });
});

/* ---------- reading it: record / import, then duck ---------- */
function voiceTrackIndex(create) {
  const S = L.S; let i = S.tracks.findIndex(t => L.isAudioTrack(t) && /voice|read|poem/i.test(t.name));
  if (i < 0) i = S.tracks.findIndex(t => L.isAudioTrack(t));
  if (i < 0 && create) { L.pushUndo(); S.tracks.push(L.newTrack('vox', 'Audio Clips', 'Voice', [], { reverb: .12, volume: 1 })); i = S.tracks.length - 1; L.markDirty(); }
  return i;
}
$('#poemRec').onclick = () => {
  const S = L.S, i = voiceTrackIndex(true); L.selectTrack(i);
  L.ui.cursor = S.lyrics.length ? S.lyrics[0].t : 0; L.seek(L.ui.cursor); L.micToggle();
};
$('#poemImp').onclick = () => { const i = voiceTrackIndex(true); L.selectTrack(i); const S = L.S; L.ui.cursor = S.lyrics.length ? S.lyrics[0].t : 0; $('#audioFile').click(); };
const musicTracks = () => L.S.tracks.filter(t => !L.isAudioTrack(t));
const voiceIntervals = () => L.S.tracks.filter(L.isAudioTrack).flatMap(t => t.clips.map(c => ({ a: c.start, b: L.clipEnd(c) })));
$('#duckBtn').onclick = () => {
  const iv = voiceIntervals(); if (!iv.length) { L.toast('Record or import your reading first — ducking follows your voice clips.'); return; }
  const depth = +$('#duckDepth').value, total = L.total(); L.pushUndo();
  musicTracks().forEach(t => { t.auto = t.auto || {}; t.auto.volume = GN.duckLane(iv, t.params.volume, depth, 1, total); });
  L.applyAllBuses(); L.changed(); L.renderInspector(); L.toast(`Music lowered to ${Math.round(depth * 100)}% under ${iv.length} voice clip${iv.length > 1 ? 's' : ''}. Edit the curve in Pattern → lane “Volume”.`);
};
$('#unduckBtn').onclick = () => {
  const n = musicTracks().filter(t => t.auto && t.auto.volume).length; if (!n) { L.toast('No volume lanes to remove.'); return; }
  L.pushUndo(); musicTracks().forEach(t => { if (t.auto) delete t.auto.volume; }); L.applyAllBuses(); L.changed(); L.renderInspector(); L.toast('Ducking removed');
};
// If the voice clips move after ducking, re-duck from the same button; nothing here changes volume by itself.

/* ---------- export timed lyrics ---------- */
function download(text, name, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
const base = () => (L.project.name || 'poem').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'poem';
$('#lrcBtn').onclick = () => {
  const S = L.S; if (!S.lyrics.length) { L.toast('Build music for a poem first.'); return; } const sp = 60 / S.tempo;
  const stamp = s => `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`;
  download(`[ti:${L.project.name || 'Poem'}]\n[length:${fmtT(L.total() * sp)}]\n` + S.lyrics.map(l => stamp(l.t * sp) + l.text).join('\n') + '\n', base() + '.lrc', 'text/plain');
};
$('#srtBtn').onclick = () => {
  const S = L.S; if (!S.lyrics.length) { L.toast('Build music for a poem first.'); return; } const sp = 60 / S.tempo, ts = s => { const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  download(S.lyrics.map((l, i) => `${i + 1}\n${ts(l.t * sp)} --> ${ts(Math.min(S.lyrics[i + 1] ? S.lyrics[i + 1].t : L.total(), l.t + 8) * sp - .1)}\n${l.text}\n`).join('\n'), base() + '.srt', 'text/plain');
};

/* ---------- wiring ---------- */
function show() {
  fillMoods(); const S = L.S;
  if (S.poem) { $('#poemText').value = S.poem.text; if (S.poem.mood) $('#poemMood').value = S.poem.mood; $('#poemPace').value = String(S.poem.wpm <= 90 ? 80 : S.poem.wpm >= 120 ? 135 : 105); }
  else if (!$('#poemText').value && !S.lyrics.length) $('#poemText').value = '';
  stats(); renderList();
}
L.on('view', v => { if (v === 'words') show(); });
L.on('refresh', reason => { if (reason === 'boot') fillMoods(); if (L.ui.view === 'words' && ['full', 'asset'].includes(reason)) show(); });
$('#poemText').addEventListener('change', () => { const S = L.S; if (S.poem) { S.poem.text = $('#poemText').value.slice(0, 12000); L.markDirty(); } });
})();

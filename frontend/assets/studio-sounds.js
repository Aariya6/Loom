/* LOOM studio: sound browser (search, categories, audition) and the shortcut / tips sheet. */
(() => {
'use strict';
const L = window.LoomApp, A = L.A;
const $ = (s, r = document) => r.querySelector(s);
const { esc } = L;

/* ---------- sound browser ---------- */
const dlg = $('#soundDlg'), grid = $('#sndGrid'), cats = $('#sndCats'), search = $('#sndSearch'), useBtn = $('#sndUse');
let cat = 'All', picked = null, forTrack = 0;
const allSounds = () => {
  const out = [], seen = new Set();
  Object.entries(A.CATEGORY).forEach(([c, list]) => list.forEach(n => { if (!seen.has(n)) { seen.add(n); out.push({ name: n, cat: c }); } }));
  Object.entries(A.ELEMENTS).forEach(([k, el]) => el.instruments.forEach(n => { if (!seen.has(n) && n !== 'Audio Clips') { seen.add(n); out.push({ name: n, cat: 'Other' }); } }));
  return out;
};
function render() {
  const cur = L.S.tracks[forTrack], q = search.value.trim().toLowerCase();
  $('#sndFor').textContent = cur ? `for “${cur.name}” — now ${cur.instrument}` : '';
  const catNames = ['All', ...Object.keys(A.CATEGORY)];
  cats.innerHTML = catNames.map(c => `<button type="button" data-c="${esc(c)}" class="${c === cat ? 'on' : ''}">${esc(c)}</button>`).join('');
  const list = allSounds().filter(s => (cat === 'All' || s.cat === cat) && (!q || (s.name + ' ' + s.cat).toLowerCase().includes(q)));
  grid.innerHTML = list.map(s => { const ek = L.elementOf(s.name), el = A.ELEMENTS[ek]; return `<button type="button" data-n="${esc(s.name)}" style="--c:${el.color}" class="${s.name === picked ? 'sel' : ''} ${cur && s.name === cur.instrument ? 'cur' : ''}"><b>${esc(s.name)}</b><small>${el.n} ${el.label} · ${esc(s.cat)}</small></button>`; }).join('') || '<p class="note">No sounds match that search.</p>';
  useBtn.disabled = !picked;
}
function open(trackIndex) { forTrack = trackIndex; picked = null; search.value = ''; cat = 'All'; render(); dlg.showModal(); search.focus(); }
function use() {
  if (!picked) return; const t = L.S.tracks[forTrack];
  if (t && L.isAudioTrack(t) && false) return;
  L.changeInstrument(forTrack, picked); dlg.close();
}
cats.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { cat = b.dataset.c; render(); } });
search.addEventListener('input', render);
search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const first = grid.querySelector('[data-n]'); if (first) pick(first.dataset.n); } });
function pick(name) {                       // update in place so a double-click still lands on the same element
  picked = name; L.previewInstrument(name); useBtn.disabled = false;
  grid.querySelectorAll('[data-n]').forEach(b => b.classList.toggle('sel', b.dataset.n === name)); $('#sndPick').textContent = `Selected: ${name}`;
}
grid.addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (b) pick(b.dataset.n); });
grid.addEventListener('dblclick', e => { const b = e.target.closest('[data-n]'); if (b) { picked = b.dataset.n; use(); } });
useBtn.onclick = use;
L.on('browse', open);

/* ---------- help ---------- */
const HELP = [
  ['Playing', [['Space', 'play / pause'], ['Enter', 'stop and rewind'], ['Home', 'back to the start'], ['Shift-drag ruler', 'set the loop region'], ['Ctrl + wheel', 'zoom']]],
  ['Writing notes', [['1 / 2 / 3', 'draw · select · erase tools'], ['A W S E D F …', 'play notes on the keyboard (Z / X octave)'], ['● rec + Space', 'record what you play'], ['Right-click', 'delete a note'], ['Drag a note edge', 'change its length'], ['Click a chord', 'insert it at the dashed cursor']]],
  ['Editing', [['Ctrl + Z / Y', 'undo / redo'], ['Ctrl + C / X / V', 'copy / cut / paste'], ['Ctrl + D', 'duplicate'], ['Delete', 'remove selected'], ['↑ ↓ ← →', 'nudge selected (Shift = octave)'], ['Ctrl + A', 'select all on track'], ['Ctrl + E', 'split the selected clip']]],
  ['Tracks & sounds', [['Dropdown on a track', 'change its sound'], ['♪', 'browse and audition every sound'], ['↑ ↓ ✕', 'reorder or delete a track'], ['Double-click name', 'rename'], ['Ctrl + S', 'save']]],
  ['Good to know', [['Recorded samples', 'on by default; switch under “master”. Credits: /assets/samples/CREDITS.md'], ['Everything is undoable', 'deletes show an Undo button'], ['✦ Genre templates', 'a full song in one click'], ['Steps tab', 'click drum hits like a drum machine'], ['Arrange tab', 'sections, vocals, overlap, fades']]],
];
$('#helpBody').innerHTML = HELP.map(([h, rows]) => `<h4>${h}</h4>` + rows.map(([k, d]) => `<div><span>${d}</span><kbd>${k}</kbd></div>`).join('')).join('');
const openHelp = () => $('#helpDlg').showModal();
$('#helpBtn').onclick = openHelp; L.on('help', openHelp);
})();

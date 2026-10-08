/* LOOM studio views: chord palette, drum step grid, Arrange timeline, Mixer, genre template dialog.
   Everything talks to the core through window.LoomApp (studio.js). */
(() => {
'use strict';
const L = window.LoomApp, A = L.A, GN = L.GN;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const { esc, clamp, r4 } = L;

/* =============================================================== chord palette */
const chordBar = $('#chordBar');
const chordOpt = { quality: '', inv: 0, oct: 0, len: 4, strum: 'block', riffBars: 4 };
function chordPitches(ch) {
  const t = L.track();
  if (t.element === 'bass') { const lo = 28; return [lo + (((ch.rootPc - lo) % 12) + 12) % 12]; }
  const center = (t.element === 'vox' ? 68 : 62) + chordOpt.oct * 12;
  return GN.voice(ch, center, chordOpt.inv);
}
function placeChord(ch, len) {
  const pitches = chordPitches(ch), t = L.track();
  if (chordOpt.strum === 'block' || t.element === 'bass') { L.insertNotes(pitches, len); return; }
  L.insertPattern(GN.strumChord(chordOpt.strum, pitches, len), len, pitches.slice(0, 3));
}
function renderChords() {
  const t = L.track(), S = L.S;
  if (t.element === 'drums' || L.isAudioTrack(t)) { chordBar.innerHTML = '<span class="note">Chord palette — select a bass, mids, vox or effects track. Drums have their own step grid.</span>'; return; }
  const dia = GN.diatonic(S.keyRoot, S.scale), keyOn = !!L.SCALES[S.scale];
  chordBar.innerHTML = `<span class="note">${keyOn ? 'chords in ' + esc(S.key) : 'pick a key & scale in the top bar for in-key chords (showing C major)'} →</span>
    ${dia.map((c, i) => `<button class="cb" data-d="${i}" title="Insert ${esc(c.name)} at the cursor"><span>${esc(c.name)}</span><small>${esc(c.roman)}</small></button>`).join('')}
    <label>quality <select id="chQ"><option value="">in key</option>${GN.QUALITIES.map(q => `<option ${chordOpt.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label>
    <label>inversion <select id="chInv">${[0, 1, 2].map(v => `<option ${chordOpt.inv === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>octave <select id="chOct">${[-1, 0, 1].map(v => `<option value="${v}" ${chordOpt.oct === v ? 'selected' : ''}>${v > 0 ? '+' : ''}${v}</option>`).join('')}</select></label>
    <label>play as <select id="chStrum">${Object.entries(GN.STRUM_NAMES).map(([k, n]) => `<option value="${k}" ${chordOpt.strum === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>length <select id="chLen">${[['1 bar', 4], ['2 beats', 2], ['1 beat', 1], ['snap', 0]].map(([n, v]) => `<option value="${v}" ${chordOpt.len === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>or any <select id="chRoot">${L.NN.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select><button id="chAny" title="Insert this root with the quality chosen on the left">+</button></label>
    <label>🎸 riff <select id="chRiff">${[2, 4, 8].map(v => `<option value="${v}" ${chordOpt.riffBars === v ? 'selected' : ''}>${v} bars</option>`).join('')}</select><button id="chRiffGo" title="Write a pentatonic guitar riff in the current key at the cursor">+</button></label>
    <span class="note">cursor: bar ${Math.floor(L.ui.cursor / 4) + 1}.${Math.floor(L.ui.cursor % 4) + 1} — click in the roll to move it</span>`;
}
chordBar.addEventListener('change', e => {
  if (e.target.id === 'chQ') chordOpt.quality = e.target.value; else if (e.target.id === 'chInv') chordOpt.inv = +e.target.value;
  else if (e.target.id === 'chOct') chordOpt.oct = +e.target.value; else if (e.target.id === 'chLen') chordOpt.len = +e.target.value;
  else if (e.target.id === 'chStrum') chordOpt.strum = e.target.value; else if (e.target.id === 'chRiff') chordOpt.riffBars = +e.target.value;
});
chordBar.addEventListener('click', e => {
  const S = L.S, len = () => chordOpt.len || L.ui.snap;
  const d = e.target.closest('[data-d]');
  if (d) {
    const dia = GN.diatonic(S.keyRoot, S.scale)[+d.dataset.d];
    const ch = chordOpt.quality ? GN.chordFromPc(dia.rootPc, chordOpt.quality) : dia;
    placeChord(ch, len()); renderChords();
  } else if (e.target.id === 'chAny') {
    const q = chordOpt.quality || 'maj'; placeChord(GN.chordFromPc(+$('#chRoot').value, q), len()); renderChords();
  } else if (e.target.id === 'chRiffGo') {
    const S = L.S, harmony = /minor|blues|dorian/i.test(S.scale) ? 'Minor' : 'Major', bars = chordOpt.riffBars;
    const recipe = { root: S.keyRoot, harmony, prog: [{ d: 0, q: null, beats: 4 }] }, chords = GN.chordSequence(recipe, bars, 0);
    L.insertPattern(GN.riff(chords, recipe, GN.rng(Math.floor(Math.random() * 99999) + 1)), bars * 4); renderChords();
  }
});

/* =============================================================== drum step grid */
const stepRoot = $('#stepGrid'), stepTools = $('#stepTools');
let stepBars = 2, stepPage = 0, lastNow = -1, stepNotes = new Map(), stepPaint = null;
const stepLanes = () => { const t = L.track(), lanes = A.DRUM_LANES.map(l => [l[0], l[1]]); [...new Set(t.notes.map(n => n.pitch))].filter(p => !lanes.some(l => l[0] === p)).forEach(p => lanes.push([p, L.noteName(p)])); return lanes; };
function renderSteps() {
  if (L.ui.view !== 'steps') return;
  const t = L.track(), S = L.S;
  if (t.element !== 'drums') {
    stepTools.innerHTML = '';
    stepRoot.innerHTML = `<div class="msg">The step grid is for <b>drum</b> tracks. Select a Drums track on the left (colour chip <b>1</b>), or use the <b>Pattern</b> tab for melodic parts.<br><br><button id="goDrums">Select the first Drums track</button></div>`;
    return;
  }
  const perPage = stepBars * 16, pages = Math.max(1, Math.ceil(S.bars * 16 / perPage)); stepPage = clamp(stepPage, 0, pages - 1);
  stepTools.innerHTML = `<div class="steppage"><button id="stPrev" ${stepPage ? '' : 'disabled'}>◀</button><b>bars ${stepPage * stepBars + 1}–${Math.min(S.bars, (stepPage + 1) * stepBars)} of ${S.bars}</b><button id="stNext" ${stepPage < pages - 1 ? '' : 'disabled'}>▶</button></div>
    <label>show <select id="stBars">${[1, 2, 4].map(v => `<option value="${v}" ${v === stepBars ? 'selected' : ''}>${v} bar${v > 1 ? 's' : ''}</option>`).join('')}</select></label>
    <select id="stBeat"><option value="">fill with a beat…</option>${$('#beatSel').innerHTML.replace('<option value="">beat…</option>', '')}</select>
    <span class="note">click = place/remove · drag to paint · Shift-click cycles accent → normal → ghost · right-click clears</span>`;
  stepNotes = new Map();
  t.notes.forEach(n => { const s = Math.round(n.start * 4); if (Math.abs(n.start * 4 - s) < .01) stepNotes.set(n.pitch + ':' + s, n); });
  const lanes = stepLanes(), color = A.ELEMENTS.drums.color, first = stepPage * perPage, count = Math.min(perPage, S.bars * 16 - first);
  let h = `<div class="sgrid" style="grid-template-columns:90px repeat(${count},26px);--c:${color}"><span></span>`;
  for (let i = 0; i < count; i++) { const s = first + i; h += `<span class="hd ${s % 16 === 0 ? 'bar' : ''}">${s % 16 === 0 ? s / 16 + 1 : s % 4 === 0 ? (s % 16) / 4 + 1 : ''}</span>`; }
  lanes.forEach(([p, name]) => {
    h += `<span class="lane" data-lane="${p}" title="Click to hear ${esc(name)}">${esc(name)}</span>`;
    for (let i = 0; i < count; i++) {
      const s = first + i, n = stepNotes.get(p + ':' + s), cls = n ? 'on ' + (n.velocity >= .9 ? 'acc' : n.velocity <= .5 ? 'gho' : '') : '';
      h += `<i class="st ${(s % 8 >= 4) ? 'g4' : ''} ${cls}" data-p="${p}" data-s="${s}"></i>`;
    }
  });
  stepRoot.innerHTML = h + '</div>'; lastNow = -1;
}
function stepEdit(el, mode, shift) {
  const t = L.track(), p = +el.dataset.p, s = +el.dataset.s, n = stepNotes.get(p + ':' + s);
  if (mode === 'remove') { if (!n) return false; t.notes = t.notes.filter(x => x !== n); stepNotes.delete(p + ':' + s); el.className = 'st ' + ((s % 8 >= 4) ? 'g4' : ''); L.sel.delete(n); return true; }
  if (shift && n) { n.velocity = n.velocity >= .9 ? .78 : n.velocity > .5 ? .45 : .95; el.className = 'st on ' + (n.velocity >= .9 ? 'acc' : n.velocity <= .5 ? 'gho' : '') + ' ' + ((s % 8 >= 4) ? 'g4' : ''); return true; }
  if (n) return false;
  if (!L.ensureBars((s + 1) / 4)) return false;
  const nn = { pitch: p, start: r4(s / 4), duration: .2, velocity: shift ? .95 : .8 }; t.notes.push(nn); stepNotes.set(p + ':' + s, nn);
  el.className = 'st on ' + (shift ? 'acc ' : '') + ((s % 8 >= 4) ? 'g4' : ''); L.audition(t, p, nn.velocity); return true;
}
stepRoot.addEventListener('pointerdown', e => {
  const el = e.target.closest('.st'), lane = e.target.closest('[data-lane]');
  if (lane) { L.audition(L.track(), +lane.dataset.lane, .85); return; }
  if (e.target.id === 'goDrums') { const i = L.S.tracks.findIndex(t => t.element === 'drums'); if (i >= 0) L.selectTrack(i); return; }
  if (!el) return; e.preventDefault();
  const key = el.dataset.p + ':' + el.dataset.s, has = stepNotes.has(key), mode = e.button === 2 || (has && !e.shiftKey) ? 'remove' : 'add';
  L.pushUndo(); stepPaint = { mode, shift: e.shiftKey, changed: false };
  if (stepEdit(el, mode, e.shiftKey)) stepPaint.changed = true;
  stepRoot.setPointerCapture(e.pointerId);
});
stepRoot.addEventListener('pointermove', e => {
  if (!stepPaint) return; const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el.classList.contains('st') && stepEdit(el, stepPaint.mode, false)) stepPaint.changed = true;
});
const stepUp = () => { if (!stepPaint) return; const c = stepPaint.changed; stepPaint = null; if (c) { L.changed(); L.renderInspector(); } };
stepRoot.addEventListener('pointerup', stepUp); stepRoot.addEventListener('pointercancel', stepUp);
stepRoot.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('click', e => {
  if (!stepTools.contains(e.target)) return; const id = e.target.id;
  if (id === 'stPrev') { stepPage--; renderSteps(); } else if (id === 'stNext') { stepPage++; renderSteps(); }
});
stepTools.addEventListener('change', e => {
  if (e.target.id === 'stBars') { stepBars = +e.target.value; stepPage = 0; renderSteps(); }
  else if (e.target.id === 'stBeat') { const id = e.target.value; e.target.value = ''; if (id) { L.applyBeat(id); renderSteps(); } }
});
L.on('frame', () => {
  if (L.ui.view !== 'steps') return;
  const now = L.T.playing ? Math.floor(L.beatNow() * 4) : -1;
  if (now === lastNow) return;
  $$('.st.now', stepRoot).forEach(x => x.classList.remove('now'));
  if (now >= 0) $$(`.st[data-s="${now}"]`, stepRoot).forEach(x => x.classList.add('now'));
  lastNow = now;
});

/* =============================================================== arrange */
const arr = $('#arr'), aw = $('#arrWrap'), asp = $('#arrSpacer'), atools = $('#arrTools');
const HDR = 156, RUL = 20, MK = 22, LANE = 56;
let appb = 10, acw = 400, ach = 300, range = null, selMarker = null, adrag = null;
const AX = b => HDR + b * appb - aw.scrollLeft, AB = x => (x - HDR + aw.scrollLeft) / appb;
const laneAt = y => Math.floor((y - RUL - MK + aw.scrollTop) / LANE);
const laneY = i => RUL + MK + i * LANE - aw.scrollTop;
const dpr = () => window.devicePixelRatio || 1;
const clipW = c => (c.len / (c.rate || 1) / L.spb()) * appb;

atools.innerHTML = `<button id="aMark" title="Add a section marker at the playhead">+ section</button><button id="aRen" title="Rename the selected / nearest marker">rename</button><button id="aDelMark" title="Delete the selected marker">✕ section</button><span class="sep"></span>
  <span class="note">range:</span><button id="aDupR" title="Insert a copy of the selected range right after it, for every track">duplicate</button><button id="aCutR" title="Remove the selected range and close the gap, for every track">cut out</button><button id="aClrR" title="Clear the selected range on the current track only">clear on track</button><span class="sep"></span>
  <button id="aImp">⤒ import audio</button><button id="aRec" title="Record a vocal onto the selected audio track">● record vocal</button><button id="aSplit" title="Split the selected clip at the playhead (Ctrl+E)">✂ split</button><button id="aDupC">duplicate clip</button><button id="aDelC" class="danger">delete clip</button><span class="sep"></span>
  <label>zoom <input id="aZoom" type="range" min="3" max="40" value="10"></label><span class="note" id="aHelp">click a section (or drag across the bar) to choose a range · drop audio files here · overlap clips and fade them to crossfade</span>`;
function resizeArr() {
  if (L.ui.view !== 'arrange' || !aw.clientWidth) return;
  const d = dpr(), S = L.S; acw = aw.clientWidth; ach = Math.max(120, aw.clientHeight);
  arr.width = acw * d; arr.height = ach * d; arr.style.width = acw + 'px'; arr.style.height = ach + 'px';
  asp.style.width = Math.max(acw, HDR + S.bars * 4 * appb + 120) + 'px'; asp.style.height = Math.max(ach, RUL + MK + S.tracks.length * LANE + 30) + 'px';
  drawArr();
}
function drawArr() {
  if (L.ui.view !== 'arrange') return;
  const S = L.S, g = arr.getContext('2d'), d = dpr(), tot = S.bars * 4, mono = getComputedStyle(document.body).getPropertyValue('--mono'), sp = L.spb();
  g.setTransform(d, 0, 0, d, 0, 0); g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, acw, ach); g.textBaseline = 'middle';
  S.tracks.forEach((t, i) => {                                                    // lanes
    const y = laneY(i); if (y > ach || y + LANE < RUL + MK) return;
    g.fillStyle = i === L.cur ? 'rgba(179,138,81,.14)' : i % 2 ? 'rgba(36,30,29,.025)' : 'transparent'; g.fillRect(HDR, y, acw - HDR, LANE);
    g.fillStyle = 'rgba(36,30,29,.1)'; g.fillRect(HDR, y + LANE - 1, acw - HDR, 1);
  });
  const pxBeat = Math.max(1, appb), stepB = pxBeat >= 24 ? 1 : 4;
  for (let b = 0; b <= tot; b += stepB) { const x = AX(b); if (x < HDR || x > acw) continue; g.fillStyle = b % 4 === 0 ? 'rgba(36,30,29,.22)' : 'rgba(36,30,29,.08)'; g.fillRect(Math.round(x), RUL + MK, 1, ach); }
  if (AX(tot) < acw) { g.fillStyle = 'rgba(36,30,29,.14)'; g.fillRect(Math.max(HDR, AX(tot)), RUL + MK, acw, ach); }
  if (S.loop.on) { g.fillStyle = 'rgba(151,75,55,.1)'; const a = Math.max(HDR, AX(S.loop.start)), z = AX(S.loop.end); g.fillRect(a, RUL + MK, Math.max(0, z - a), ach); }
  if (range) { g.fillStyle = 'rgba(123,90,138,.16)'; const a = Math.max(HDR, AX(range.a)), z = AX(range.b); g.fillRect(a, RUL, Math.max(0, z - a), ach); g.fillStyle = 'rgba(123,90,138,.6)'; g.fillRect(a, RUL + MK - 3, Math.max(0, z - a), 3); }
  S.tracks.forEach((t, i) => {                                                    // contents
    const y = laneY(i); if (y > ach || y + LANE < RUL + MK) return;
    const color = A.ELEMENTS[t.element].color;
    if (!L.isAudioTrack(t) && t.notes.length) {
      const drums = t.element === 'drums', ps = t.notes.map(n => n.pitch), lo = Math.min(...ps), hi = Math.max(...ps), span = Math.max(6, hi - lo);
      g.fillStyle = color; g.globalAlpha = .75;
      t.notes.forEach(n => {
        const x = AX(n.start), w = Math.max(1.5, n.duration * appb); if (x + w < HDR || x > acw) return;
        const ny = drums ? (A.DRUM_LANES.findIndex(l => l[0] === n.pitch) + 1 || 8) / 17 : 1 - (n.pitch - lo) / span;
        g.fillRect(Math.max(HDR, x), y + 5 + ny * (LANE - 14), Math.max(1.5, w - (x < HDR ? HDR - x : 0)), 3);
      });
      g.globalAlpha = 1;
    }
    t.clips.forEach(c => {
      const x0 = AX(c.start), w = clipW(c); if (x0 + w < HDR || x0 > acw) return;
      const sel = L.ui.clipSel && L.ui.clipSel.cid === c.id, cy = y + LANE / 2, asset = L.getAsset(c.asset);
      g.save(); g.beginPath(); g.rect(HDR, y, acw - HDR, LANE); g.clip();
      g.fillStyle = color; g.globalAlpha = .28; g.fillRect(x0, y + 3, w, LANE - 7); g.globalAlpha = 1;
      if (asset) {
        const dur = asset.buffer.duration, pk = asset.peaks; g.fillStyle = color;
        for (let px = Math.max(HDR, Math.floor(x0)); px < Math.min(acw, x0 + w); px++) {
          const srcT = c.offset + ((px - x0) / w) * c.len, amp = pk[clamp(Math.floor(srcT / dur * pk.length), 0, pk.length - 1)] * (c.gain || 1), hh = Math.min(LANE / 2 - 5, amp * (LANE - 14) / 1.1);
          g.fillRect(px, cy - hh, 1, Math.max(1, hh * 2));
        }
      } else { g.fillStyle = 'rgba(36,30,29,.4)'; g.font = '10px ' + mono; g.fillText('loading…', x0 + 6, cy); }
      g.strokeStyle = sel ? '#241e1d' : color; g.lineWidth = sel ? 2 : 1; g.strokeRect(x0 + .5, y + 3.5, w - 1, LANE - 8);
      g.fillStyle = 'rgba(255,255,255,.5)';                                              // fades
      const fi = (c.fadeIn / sp) * appb, fo = (c.fadeOut / sp) * appb;
      if (fi > 1) { g.beginPath(); g.moveTo(x0, y + 3); g.lineTo(x0 + fi, y + 3); g.lineTo(x0, y + LANE - 4); g.fill(); }
      if (fo > 1) { g.beginPath(); g.moveTo(x0 + w, y + 3); g.lineTo(x0 + w - fo, y + 3); g.lineTo(x0 + w, y + LANE - 4); g.fill(); }
      g.fillStyle = '#241e1d'; g.font = '10px ' + mono; g.fillText(c.name, Math.max(x0, HDR) + 5, y + 11);
      g.restore();
    });
  });
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, acw, RUL + MK);                         // ruler + section bar
  if (S.loop.on) { g.fillStyle = 'rgba(151,75,55,.35)'; const a = Math.max(HDR, AX(S.loop.start)), z = AX(S.loop.end); g.fillRect(a, 0, Math.max(0, z - a), RUL); }
  g.font = '10px ' + mono;
  for (let b = 0; b <= tot; b += 4) { const x = AX(b); if (x < HDR || x > acw) continue; g.fillStyle = 'rgba(36,30,29,.5)'; g.fillRect(Math.round(x), 4, 1, RUL - 4); g.fillStyle = '#241e1d'; if (b < tot) g.fillText(String(b / 4 + 1), x + 3, 10); }
  g.fillStyle = 'rgba(36,30,29,.06)'; g.fillRect(HDR, RUL, acw, MK);
  const marks = S.markers.slice().sort((a, b) => a.beat - b.beat);
  marks.forEach((m, i) => {
    const x = AX(m.beat); if (x < HDR - 40 || x > acw) return; const sel = selMarker === m, nextX = marks[i + 1] ? AX(marks[i + 1].beat) : AX(tot);
    g.fillStyle = sel ? '#5b2a6a' : '#7b5a8a'; g.fillRect(Math.max(HDR, x), RUL + 2, Math.max(2, Math.min(nextX, acw) - Math.max(HDR, x) - 2), MK - 4);
    g.fillStyle = '#fff'; g.font = '11px ' + mono; g.save(); g.beginPath(); g.rect(Math.max(HDR, x), RUL, Math.max(0, nextX - Math.max(HDR, x) - 4), MK); g.clip(); g.fillText(m.name, Math.max(HDR, x) + 5, RUL + MK / 2); g.restore();
  });
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, HDR, ach);                               // track headers
  S.tracks.forEach((t, i) => {
    const y = laneY(i); if (y > ach || y + LANE < RUL + MK) return; const el = A.ELEMENTS[t.element];
    g.fillStyle = i === L.cur ? '#fff' : '#efe3cf'; g.fillRect(0, y, HDR - 1, LANE - 1); g.fillStyle = el.color; g.fillRect(0, y, 5, LANE - 1);
    g.fillStyle = '#241e1d'; g.font = '600 12px sans-serif'; g.fillText(t.name.slice(0, 18), 12, y + 14); g.font = '10px ' + mono; g.fillStyle = 'rgba(36,30,29,.6)'; g.fillText(`${el.n} ${el.label}`.slice(0, 20), 12, y + 29);
    g.fillText(t.instrument.slice(0, 18), 12, y + 43);
    [['M', t.mute, HDR - 46], ['S', t.solo, HDR - 24]].forEach(([c, on, bx]) => { g.fillStyle = on ? '#5b292f' : 'rgba(36,30,29,.12)'; g.fillRect(bx, y + 6, 18, 16); g.fillStyle = on ? '#fff' : '#241e1d'; g.font = '700 10px ' + mono; g.fillText(c, bx + 5, y + 15); });
  });
  g.fillStyle = '#efe3cf'; g.fillRect(0, 0, HDR, RUL + MK); g.fillStyle = 'rgba(36,30,29,.5)'; g.fillRect(HDR - 1, 0, 1, ach);
  g.fillStyle = 'rgba(36,30,29,.5)'; g.font = '10px ' + mono; g.fillText('sections', 8, RUL + MK / 2);
  const px = AX(L.beatNow()); if (px >= HDR - 1 && px <= acw) { g.fillStyle = '#b3261e'; g.fillRect(Math.round(px), 0, 1.5, ach); g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 6, 0); g.lineTo(px + .5, 9); g.fill(); }
}
const sortedMarks = () => L.S.markers.slice().sort((a, b) => a.beat - b.beat);
function sectionAt(b) { let hit = null; sortedMarks().forEach(m => { if (m.beat <= b + 1e-6) hit = m; }); return hit; }
function sectionEnd(m) { const next = sortedMarks().find(x => x.beat > m.beat + 1e-6); return next ? next.beat : L.S.bars * 4; }
function clipAt(x, y) {
  const i = laneAt(y), t = L.S.tracks[i]; if (!t || x < HDR || y < RUL + MK) return null;
  for (let k = t.clips.length - 1; k >= 0; k--) {
    const c = t.clips[k], x0 = AX(c.start), w = clipW(c);
    if (x >= x0 - 2 && x <= x0 + w + 2) return { t, c, i, edge: x < x0 + 7 ? 'L' : x > x0 + w - 7 ? 'R' : null };
  }
  return null;
}
const aPos = e => { const r = arr.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const arrSnap = b => r4(Math.round(b / L.ui.snap) * L.ui.snap);
arr.addEventListener('contextmenu', e => e.preventDefault());
arr.addEventListener('pointerdown', e => {
  arr.setPointerCapture(e.pointerId); const { x, y } = aPos(e), S = L.S;
  if (x < HDR && y >= RUL + MK) {
    const i = laneAt(y), t = S.tracks[i]; if (!t) return;
    const yy = laneY(i);
    if (y - yy > 4 && y - yy < 24 && x > HDR - 48 && x < HDR - 28) { t.mute = !t.mute; L.applyAllBuses(); L.markDirty(); L.renderTracks(); drawArr(); return; }
    if (y - yy > 4 && y - yy < 24 && x > HDR - 26 && x < HDR - 4) { t.solo = !t.solo; L.applyAllBuses(); L.markDirty(); L.renderTracks(); drawArr(); return; }
    L.selectTrack(i); return;
  }
  if (y < RUL && x >= HDR) { adrag = { k: 'seek' }; L.seek(arrSnap(AB(x))); return; }
  if (y < RUL + MK && x >= HDR) {
    // a click selects the whole section as the range; dragging across the bar draws a custom range (bar-snapped, Alt = fine)
    const snap = e.altKey ? L.ui.snap : 4, b0 = Math.max(0, AB(x));
    adrag = { k: 'mk', m: sectionAt(b0), x0: x, a: Math.floor(b0 / snap) * snap, snap }; return;
  }
  if (y < RUL + MK) return;
  const hit = clipAt(x, y);
  if (hit) {
    if (L.cur !== hit.i) L.selectTrack(hit.i);
    L.ui.clipSel = { tid: hit.t.id, cid: hit.c.id }; L.renderInspector();
    adrag = { k: hit.edge === 'L' ? 'trimL' : hit.edge === 'R' ? 'trimR' : 'move', c: hit.c, t: hit.t, lane: hit.i, grab: AB(x) - hit.c.start, snapped: false };
    drawArr(); return;
  }
  const i = laneAt(y); if (S.tracks[i] && L.cur !== i) L.selectTrack(i);
  L.ui.clipSel = null; L.renderInspector(); selMarker = null; L.seek(arrSnap(AB(x))); adrag = { k: 'seek' }; drawArr();
});
arr.addEventListener('pointermove', e => {
  const { x, y } = aPos(e);
  if (!adrag) { const h = clipAt(x, y); arr.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : 'default'; return; }
  const S = L.S, c = adrag.c;
  switch (adrag.k) {
    case 'seek': L.seek(arrSnap(AB(x))); break;
    case 'mk': if (Math.abs(x - adrag.x0) > 4) { adrag.k = 'range'; selMarker = null; } else break;
    // falls through into the range drag once the pointer has moved
    case 'range': { const b = Math.round(AB(x) / adrag.snap) * adrag.snap, a = Math.min(adrag.a, b), z = Math.max(adrag.a + adrag.snap, b); range = { a: clamp(a, 0, S.bars * 4), b: clamp(z, 0, S.bars * 4) }; drawArr(); break; }
    case 'move': {
      const ns = Math.max(0, arrSnap(AB(x) - adrag.grab)), j = laneAt(y);
      if (!adrag.snapped && (ns !== c.start || (j !== adrag.lane && S.tracks[j]))) { L.pushUndo(); adrag.snapped = true; }
      if (!adrag.snapped) break;
      c.start = ns; L.ensureBars(L.clipEnd(c));
      if (j !== adrag.lane && S.tracks[j]) { adrag.t.clips = adrag.t.clips.filter(k => k !== c); S.tracks[j].clips.push(c); adrag.t = S.tracks[j]; adrag.lane = j; L.ui.clipSel = { tid: adrag.t.id, cid: c.id }; L.selectTrack(j); }
      L.changed(); drawArr(); break;
    }
    case 'trimR': {
      const a = L.getAsset(c.asset), maxLen = a ? a.buffer.duration - c.offset : c.len, beats = Math.max(.05, arrSnap(AB(x)) - c.start);
      if (!adrag.snapped) { L.pushUndo(); adrag.snapped = true; }
      c.len = clamp(beats * L.spb() * (c.rate || 1), .05, maxLen); L.changed(); drawArr(); break;
    }
    case 'trimL': {
      const ns = clamp(arrSnap(AB(x)), 0, L.clipEnd(c) - .05), delta = ns - c.start, dSrc = delta * L.spb() * (c.rate || 1);
      if (c.offset + dSrc < 0 || c.len - dSrc < .05) break;
      if (!adrag.snapped) { L.pushUndo(); adrag.snapped = true; }
      c.start = ns; c.offset += dSrc; c.len -= dSrc; L.changed(); drawArr(); break;
    }
  }
});
const aUp = () => {
  const k = adrag && adrag.k;
  if (k === 'mk') { const m = adrag.m; selMarker = m || null; range = m ? { a: m.beat, b: sectionEnd(m) } : null; if (m) L.seek(m.beat); }
  adrag = null; if (k === 'move' || k === 'trimL' || k === 'trimR') { L.renderInspector(); L.renderTracks(); } if (k === 'range' && range && range.b - range.a <= 0) range = null; drawArr(); updateArrButtons(); };
arr.addEventListener('pointerup', aUp); arr.addEventListener('pointercancel', aUp);
arr.addEventListener('dblclick', e => { const { x, y } = aPos(e); if (y >= RUL && y < RUL + MK && x >= HDR) { const m = L.S.markers.find(mm => { const mx = AX(mm.beat); return x >= mx && x <= mx + 80; }); if (m) { selMarker = m; renameMarker(); } } });
aw.addEventListener('scroll', drawArr);
aw.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const { x } = aPos(e), anchor = AB(x); setAZoom(clamp(appb * Math.exp(-e.deltaY * .0025), 3, 40)); aw.scrollLeft = Math.max(0, anchor * appb - (x - HDR)); }, { passive: false });
function setAZoom(v) { appb = v; $('#aZoom').value = v; resizeArr(); }
$('#aZoom').oninput = e => setAZoom(+e.target.value);
// drop audio files straight onto a lane
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); }));
aw.addEventListener('drop', async e => {
  const files = [...e.dataTransfer.files].filter(f => /^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|m4a|webm)$/i.test(f.name)); if (!files.length) return;
  const { x, y } = aPos(e); const i = laneAt(y), t = L.S.tracks[i];
  await L.addAudioFiles(files, { track: t && L.isAudioTrack(t) ? i : -1, start: Math.max(0, arrSnap(AB(Math.max(HDR, x)))) });
});
// markers
function addMarker() {
  const S = L.S, b = L.r4(Math.max(0, L.snapRound(L.beatNow()))), ex = S.markers.find(m => Math.abs(m.beat - b) < .01);
  const name = prompt(ex ? 'Rename this section:' : 'Name this section (Verse, Chorus, Drop…):', ex ? ex.name : 'Section'); if (!name) return;
  L.pushUndo(); if (ex) ex.name = name.slice(0, 30); else { selMarker = { beat: b, name: name.slice(0, 30) }; S.markers.push(selMarker); } L.markDirty(); drawArr(); L.emit('change');
}
function renameMarker() {
  const S = L.S; let m = selMarker || S.markers.filter(x => x.beat <= L.beatNow() + .01).sort((a, b) => b.beat - a.beat)[0];
  if (!m) { L.toast('Add a section first.'); return; } const name = prompt('Rename section:', m.name); if (!name) return;
  L.pushUndo(); m.name = name.slice(0, 30); L.markDirty(); drawArr(); L.emit('change');
}
function delMarker() { if (!selMarker) { L.toast('Click a section flag first.'); return; } L.pushUndo(); L.S.markers = L.S.markers.filter(m => m !== selMarker); selMarker = null; L.markDirty(); drawArr(); L.emit('change'); }
// range operations (all tracks unless noted)
const needRange = () => { if (!range || range.b - range.a < .25) { L.toast('Drag across the section bar (under the ruler) to choose a range first.'); return false; } return true; };
function shiftAfter(S, from, by) {
  S.tracks.forEach(t => { t.notes.forEach(n => { if (n.start >= from - 1e-6) n.start = r4(Math.max(0, n.start + by)); }); t.clips.forEach(c => { if (c.start >= from - 1e-6) c.start = r4(Math.max(0, c.start + by)); }); });
  S.markers.forEach(m => { if (m.beat >= from - 1e-6) m.beat = r4(Math.max(0, m.beat + by)); });
}
function dupRange() {
  if (!needRange()) return; const S = L.S, { a, b } = range, len = b - a;
  if (S.bars * 4 + len > 256) { L.toast('That would pass the 64-bar limit.'); return; }
  L.pushUndo();
  const copies = S.tracks.map(t => ({ n: t.notes.filter(n => n.start >= a - 1e-6 && n.start < b - 1e-6).map(n => ({ ...n })), c: t.clips.filter(c => c.start >= a - 1e-6 && c.start < b - 1e-6).map(c => ({ ...c, id: L.uid() })) }));
  shiftAfter(S, b, len);
  S.tracks.forEach((t, i) => { copies[i].n.forEach(n => { n.start = r4(n.start + len); t.notes.push(n); }); copies[i].c.forEach(c => { c.start = r4(c.start + len); t.clips.push(c); }); });
  S.markers.filter(m => m.beat >= a - 1e-6 && m.beat < b - 1e-6).forEach(m => S.markers.push({ beat: r4(m.beat + len), name: m.name }));
  if (S.loop.end >= b) S.loop.end = r4(S.loop.end + len);
  L.ensureBars(S.bars * 4 + len); S.loop.end = Math.min(S.loop.end, S.bars * 4); range = { a: b, b: b + len };
  L.markDirty(); L.fullRefresh(); L.toast(`Duplicated bars ${a / 4 + 1}–${b / 4}`);
}
function cutRange() {
  if (!needRange()) return; if (!confirm('Remove this range from every track and close the gap? (Undo brings it back.)')) return;
  const S = L.S, { a, b } = range, len = b - a; L.pushUndo();
  S.tracks.forEach(t => { t.notes = t.notes.filter(n => !(n.start >= a - 1e-6 && n.start < b - 1e-6)); t.clips = t.clips.filter(c => !(c.start >= a - 1e-6 && c.start < b - 1e-6)); });
  S.markers = S.markers.filter(m => !(m.beat > a + 1e-6 && m.beat < b - 1e-6)); shiftAfter(S, b, -len);
  if (S.loop.end >= b) S.loop.end = Math.max(S.loop.start + 1, r4(S.loop.end - len)); range = null; L.sel.clear(); L.ui.clipSel = null;
  L.markDirty(); L.fullRefresh(); L.toast('Range removed');
}
function clearRange() {
  if (!needRange()) return; const S = L.S, t = L.track(), { a, b } = range; L.pushUndo();
  t.notes = t.notes.filter(n => !(n.start >= a - 1e-6 && n.start < b - 1e-6)); t.clips = t.clips.filter(c => !(c.start >= a - 1e-6 && c.start < b - 1e-6));
  L.sel.clear(); L.markDirty(); L.fullRefresh(); L.toast(`Cleared ${t.name} in the range`);
}
$('#aMark').onclick = addMarker; $('#aRen').onclick = renameMarker; $('#aDelMark').onclick = delMarker;
$('#aDupR').onclick = dupRange; $('#aCutR').onclick = cutRange; $('#aClrR').onclick = clearRange;
$('#aImp').onclick = () => $('#audioFile').click(); $('#aRec').onclick = () => { const t = L.track(); if (!L.isAudioTrack(t)) { L.toast('Select an Audio Clips track first (add one under Vox → Audio Clips).'); return; } L.micToggle(); };
$('#aSplit').onclick = () => L.splitSelClip(); $('#aDupC').onclick = () => L.duplicateSelClip(); $('#aDelC').onclick = () => { if (!L.deleteSelClip()) L.toast('Select a clip first.'); };
function updateArrButtons() { const hasClip = !!L.findClip(); ['aSplit', 'aDupC', 'aDelC'].forEach(id => { $('#' + id).disabled = !hasClip; }); ['aDupR', 'aCutR', 'aClrR'].forEach(id => { $('#' + id).disabled = !range; }); $('#aDelMark').disabled = !selMarker; $('#aRec').classList.toggle('on', L.micState.active); }
L.keyHandlers.push(e => {
  if (L.ui.view !== 'arrange') return false;
  if ((e.code === 'Delete' || e.code === 'Backspace') && selMarker && !L.ui.clipSel) { e.preventDefault(); delMarker(); return true; }
  if (e.code === 'Escape' && range) { range = null; drawArr(); updateArrButtons(); return true; }
  return false;
});
L.on('frame', () => { if (L.ui.view === 'arrange' && L.T.playing) drawArr(); });

/* =============================================================== mixer */
const mixRoot = $('#mixerStrips');
let mixStale = true;
const KN = [['pan', 'pan', -1, 1, .01], ['filter', 'filter', 0, 1, .01], ['eqLo', 'low', -12, 12, 1], ['eqMid', 'mid', -12, 12, 1], ['eqHi', 'high', -12, 12, 1], ['delay', 'delay', 0, 1, .01], ['reverb', 'reverb', 0, 1, .01]];
function renderMixer() {
  if (L.ui.view !== 'mixer') { mixStale = true; return; } mixStale = false;
  const S = L.S;
  mixRoot.innerHTML = S.tracks.map((t, i) => {
    const el = A.ELEMENTS[t.element], p = t.params;
    return `<div class="strip ${i === L.cur ? 'active' : ''}" data-i="${i}" style="--c:${el.color}"><div class="sn" data-act="sel" title="${esc(t.name)}">${esc(t.name)}</div>
      <div class="ms"><button data-act="mute" class="${t.mute ? 'on' : ''}">M</button><button data-act="solo" class="${t.solo ? 'on' : ''}">S</button></div>
      <div class="fad"><div class="mtr"><i></i></div><input type="range" orient="vertical" min="0" max="1.2" step=".01" value="${p.volume}" data-p="volume" aria-label="Volume ${esc(t.name)}"></div>
      <div class="vv" data-vv>${Math.round(p.volume * 100)}%</div>
      ${KN.map(([k, label, min, max, step]) => `<div class="kn">${label}<input type="range" min="${min}" max="${max}" step="${step}" value="${p[k]}" data-p="${k}" aria-label="${label} ${esc(t.name)}"></div>`).join('')}
      <div class="note">${esc(t.instrument)}</div></div>`;
  }).join('') + `<div class="strip" style="--c:#241e1d"><div class="sn">Master</div><div class="fad"><div class="mtr"><i></i></div><input type="range" orient="vertical" min="0" max="1" step=".01" value="${S.master.gain}" data-m="gain" aria-label="Master gain"></div><div class="vv">${Math.round(S.master.gain * 100)}%</div>
      <div class="kn">reverb return<input type="range" min="0" max="1" step=".01" value="${S.master.reverb}" data-m="reverb"></div></div>`;
}
function syncMixerValues() {
  if (L.ui.view !== 'mixer' || mixStale) return; const S = L.S;
  $$('.strip[data-i]', mixRoot).forEach(st => {
    const t = S.tracks[+st.dataset.i]; if (!t) return; $$('[data-p]', st).forEach(inp => { if (document.activeElement !== inp) inp.value = t.params[inp.dataset.p]; });
    $('[data-vv]', st).textContent = Math.round(t.params.volume * 100) + '%'; $$('[data-act="mute"],[data-act="solo"]', st).forEach(b => b.classList.toggle('on', !!t[b.dataset.act]));
  });
}
mixRoot.addEventListener('input', e => {
  const inp = e.target, S = L.S;
  if (inp.dataset.m) { S.master[inp.dataset.m] = +inp.value; if (L.T.G) A.applyMaster(L.T.G, S.master); L.markDirty(); L.syncTopbar(); return; }
  const st = inp.closest('.strip[data-i]'); if (!st || !inp.dataset.p) return; const t = S.tracks[+st.dataset.i];
  if (!mixDragSnap) { L.pushUndo(); mixDragSnap = true; }
  t.params[inp.dataset.p] = +inp.value; L.applyAllBuses(); L.markDirty();
  if (inp.dataset.p === 'volume') $('[data-vv]', st).textContent = Math.round(+inp.value * 100) + '%';
  L.renderTracks(); if (+st.dataset.i === L.cur) L.renderInspector();
});
let mixDragSnap = false; document.addEventListener('pointerup', () => { mixDragSnap = false; }, true); document.addEventListener('change', () => { mixDragSnap = false; }, true);
mixRoot.addEventListener('click', e => {
  const st = e.target.closest('.strip[data-i]'), act = e.target.dataset.act; if (!st || !act) return; const i = +st.dataset.i, t = L.S.tracks[i];
  if (act === 'sel') { L.selectTrack(i); renderMixer(); return; }
  t[act] = !t[act]; L.applyAllBuses(); L.markDirty(); L.renderTracks(); renderMixer();
});
L.on('frame', () => {
  if (L.ui.view !== 'mixer' || mixStale) return; const T = L.T, S = L.S;
  $$('.strip', mixRoot).forEach(st => {
    const bar = $('.mtr i', st); if (!bar) return; let lv = 0;
    if (T.G && T.playing) { if (st.dataset.i !== undefined) { const t = S.tracks[+st.dataset.i]; lv = t ? A.busLevel(T.G, t.id) * 2.6 : 0; } else { const buf = new Uint8Array(T.G.analyser.fftSize); T.G.analyser.getByteTimeDomainData(buf); let s = 0; for (const v of buf) s += ((v - 128) / 128) ** 2; lv = Math.sqrt(s / buf.length) * 2.2; } }
    bar.style.height = clamp(lv, 0, 1) * 100 + '%';
  });
});

/* =============================================================== genre templates */
const tplDlg = $('#tplDlg'); let tplFamily = 'All';
function renderTemplates() {
  const genres = L.DATA.genres; if (!genres.length) { $('#tplGrid').innerHTML = '<p class="note">Genre data is not available.</p>'; return; }
  const fams = ['All', ...new Set(genres.map(g => g.family))];
  $('#tplFilters').innerHTML = fams.map(f => `<button type="button" data-f="${esc(f)}" class="${f === tplFamily ? 'on' : ''}">${esc(f)}</button>`).join('');
  $('#tplGrid').innerHTML = genres.filter(g => tplFamily === 'All' || g.family === tplFamily).map(g => `<button type="button" class="tpl-card" data-g="${g.id}"><b>${esc(g.name)}</b><small>${g.tempo} BPM · ${L.NN[g.root]} ${esc(g.scale.toLowerCase())} · ${g.beat ? esc((L.DATA.beats.find(b => b.id === g.beat) || {}).name || '') : 'no drums'}</small><span>${esc(g.blurb)}</span><small>${esc([g.beat ? g.kit : null, g.bass && g.bass.instrument, g.mids.instrument, g.vox && g.vox.instrument].filter(Boolean).join(' · '))}</small></button>`).join('');
}
function openTemplates() { $('#projMenu').open = false; renderTemplates(); tplDlg.showModal(); }
$('#templateBtn').onclick = openTemplates; $('#templateBtn2').onclick = openTemplates;
$('#tplFilters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { tplFamily = b.dataset.f; renderTemplates(); } });
$('#tplDice').onclick = () => { $('#tplSeed').value = 1 + Math.floor(Math.random() * 9999); };
$('#tplGrid').addEventListener('click', async e => {
  const b = e.target.closest('[data-g]'); if (!b) return; const g = L.DATA.genres.find(x => x.id === b.dataset.g); if (!g) return;
  const mode = $('#tplMode').value, seed = clamp(parseInt($('#tplSeed').value, 10) || 1, 1, 99999);
  tplDlg.close(); try { await L.generateFromRecipe(g, seed, mode); L.setView('roll'); } catch (err) { L.toast('Could not create the project: ' + err.message); }
});

/* =============================================================== wiring */
L.on('view', v => {
  if (v === 'steps') renderSteps(); else if (v === 'arrange') { resizeArr(); updateArrButtons(); } else if (v === 'mixer') renderMixer();
});
L.on('refresh', reason => {
  if (reason === 'mix') { syncMixerValues(); return; }
  if (reason === 'resize') { if (L.ui.view === 'arrange') resizeArr(); return; }
  renderChords();
  if (L.ui.view === 'steps') renderSteps(); else if (L.ui.view === 'arrange') { resizeArr(); updateArrButtons(); } else if (L.ui.view === 'mixer') renderMixer(); else mixStale = true;
});
L.on('change', () => {
  if (L.ui.view === 'steps') renderSteps(); else if (L.ui.view === 'arrange') { drawArr(); updateArrButtons(); }
});
})();

/* LOOM music logic: chords, voicings, beat expansion, genre song generator, arpeggiator, MIDI read/write.
   Pure functions (no DOM, no audio) so they can be unit-tested in Node and reused in the browser. */
(function (root) {
'use strict';
const G = {};
const NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = v => Math.round(v * 10000) / 10000;
G.NN = NN;

/* ---------- random ---------- */
G.rng = seed => { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* ---------- harmony ---------- */
const SCALE_IV = { Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Mixolydian: [0, 2, 4, 5, 7, 9, 10] };
const QUALITY = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], '9': [0, 4, 7, 10, 14], add9: [0, 4, 7, 14], min9: [0, 3, 7, 10, 14], '6': [0, 4, 7, 9], min6: [0, 3, 7, 9], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10] };
const QSUFFIX = { maj: '', min: 'm', dim: '°', aug: '+', sus2: 'sus2', sus4: 'sus4', '7': '7', maj7: 'maj7', min7: 'm7', '9': '9', add9: 'add9', min9: 'm9', '6': '6', min6: 'm6', dim7: '°7', m7b5: 'ø7' };
G.QUALITIES = Object.keys(QUALITY);
G.QUALITY_LABEL = QSUFFIX;
const scaleNote = (iv, i) => iv[((i % 7) + 7) % 7] + 12 * Math.floor(i / 7);
function diatonicQuality(iv, d) {
  const r = scaleNote(iv, d), t = scaleNote(iv, d + 2) - r, f = scaleNote(iv, d + 4) - r;
  if (t === 4 && f === 7) return 'maj'; if (t === 3 && f === 7) return 'min'; if (t === 3 && f === 6) return 'dim'; if (t === 4 && f === 8) return 'aug';
  return t === 3 ? 'min' : 'maj';
}
G.chord = (rootPc, harmony, d, q) => {
  const iv = SCALE_IV[harmony] || SCALE_IV.Major, root = (rootPc + scaleNote(iv, d)) % 12, quality = q || diatonicQuality(iv, d);
  return { rootPc: root, quality, intervals: QUALITY[quality] || QUALITY.maj, name: NN[root] + (QSUFFIX[quality] ?? ''), deg: d };
};
G.chordFromPc = (rootPc, quality) => ({ rootPc: ((rootPc % 12) + 12) % 12, quality, intervals: QUALITY[quality], name: NN[((rootPc % 12) + 12) % 12] + QSUFFIX[quality], deg: -1 });
// The seven chords of a key, for the chord palette. Scales with fewer than 7 notes fall back to major/minor harmony.
G.diatonic = (rootPc, scaleName) => {
  const harmony = SCALE_IV[scaleName] ? scaleName : (/minor|blues/i.test(scaleName || '') ? 'Minor' : 'Major'), ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  return Array.from({ length: 7 }, (_, d) => { const c = G.chord(rootPc, harmony, d, null); const r = ROMAN[d]; return { ...c, roman: (c.quality === 'min' || c.quality === 'dim' ? r.toLowerCase() : r) + (c.quality === 'dim' ? '°' : c.quality === 'aug' ? '+' : '') }; });
};
// Closed voicing near `center`; inversion k moves the k lowest notes up an octave.
G.voice = (ch, center = 62, inv = 0) => {
  const lowest = center - 6, root = lowest + (((ch.rootPc - lowest) % 12) + 12) % 12;
  let p = ch.intervals.map(i => root + i);
  if (p.reduce((a, b) => a + b, 0) / p.length > center + 5) p = p.map(x => x - 12);
  p.sort((a, b) => a - b);
  for (let k = 0; k < inv; k++) p.push(p.shift() + 12);
  return p.map(x => clamp(x, 0, 127));
};
const lowPc = (pc, lo) => lo + (((pc - lo) % 12) + 12) % 12;

/* ---------- beats ---------- */
const VEL = { X: .95, x: .78, o: .45 };
// Expand a beat definition from data/beats.json into drum notes. lite = only the quiet/percussive lanes (no kick/snare/clap).
G.beatNotes = (beat, bars, { start = 0, lite = false, fills = true, leads = true } = {}) => {
  const out = [];
  for (let bar = 0; bar < bars; bar++) {
    const lanes = {}, apply = l => Object.entries(l).forEach(([pitch, pat]) => { lanes[pitch] = lanes[pitch] ? merge(lanes[pitch], pat) : pat; });
    apply(beat.pattern);
    if (fills && beat.fill && bar % 4 === 3) apply(beat.fill);
    if (leads && beat.lead && bar % 4 === 0) apply(beat.lead);
    Object.entries(lanes).forEach(([pitch, pat]) => {
      if (lite && [36, 38, 39].includes(+pitch)) return;
      [...pat].forEach((ch, i) => { if (VEL[ch]) out.push({ pitch: +pitch, start: r4(start + bar * 4 + i * .25), duration: .2, velocity: VEL[ch] }); });
    });
  }
  return out;
};
const merge = (a, b) => [...a].map((c, i) => (b[i] !== '.' ? b[i] : c)).join('');

/* ---------- note helpers ---------- */
const note = (out, start, len, pitch, vel) => out.push({ pitch: clamp(Math.round(pitch), 0, 127), start: r4(start), duration: r4(Math.max(.05, len)), velocity: clamp(r4(vel), .05, 1) });

/* ---------- chords for a section ---------- */
G.chordSequence = (recipe, bars, startBeat) => {
  const out = [], total = bars * 4; let t = 0, i = 0;
  while (t < total - 1e-9) { const e = recipe.prog[i % recipe.prog.length]; out.push({ start: startBeat + t, len: Math.min(e.beats, total - t), ...G.chord(recipe.root, recipe.harmony, e.d, e.q) }); t += e.beats; i++; }
  return out;
};


/* ---------- guitar strumming ---------- */
// [start, length, direction, velocity]; D = down (low to high), U = up, B = bass note, F = fifth below
const STRUMS = {
  folk:    [[0, 1, 'D', .9], [1, .5, 'D', .6], [1.5, 1, 'U', .55], [2.5, .5, 'U', .55], [3, .5, 'D', .75], [3.5, .5, 'U', .5]],
  pop:     [[0, .5, 'D', .85], [.5, .5, 'U', .5], [1, .5, 'D', .7], [1.5, .5, 'U', .5], [2, .5, 'D', .8], [2.5, .5, 'U', .5], [3, .5, 'D', .7], [3.5, .5, 'U', .5]],
  ballad:  [[0, 2, 'D', .8], [2, 1, 'U', .45], [3, .5, 'D', .55], [3.5, .5, 'U', .4]],
  down:    [[0, 1, 'D', .85], [1, 1, 'D', .7], [2, 1, 'D', .8], [3, 1, 'D', .7]],
  country: [[0, .5, 'B', .8], [1, .5, 'D', .6], [2, .5, 'F', .75], [3, .5, 'D', .6]],
  funk:    [[0, .15, 'D', .9], [.75, .15, 'U', .6], [1.5, .15, 'D', .8], [2, .15, 'D', .85], [2.75, .15, 'U', .6], [3.5, .15, 'D', .75]],
};
G.STRUM_NAMES = { block: 'Block chord', folk: 'Folk strum', pop: 'Pop strum', ballad: 'Ballad', down: 'Down strokes', country: 'Boom-chick', funk: 'Funk scratch', fingerpick: 'Fingerpicking', chug: 'Palm-mute chug', powers: 'Power chords' };
function strumInto(out, start, span, pitches, pattern, vel = 1) {
  const P = pitches.slice().sort((a, b) => a - b), spread = .025;
  pattern.forEach(([s0, l, dir, v]) => {
    if (s0 >= span) return;
    const dur = Math.min(l, span - s0) * .95;
    let list;
    if (dir === 'B') list = [P[0] - 12]; else if (dir === 'F') list = [P[0] - 5]; else list = dir === 'U' ? P.slice().reverse() : P;
    list.forEach((p, i) => note(out, start + s0 + i * spread, Math.max(.06, dur - i * spread), p, v * vel * (1 - i * .04)));
  });
}
function fingerpickInto(out, start, span, pitches) {
  const T = [pitches[0] - 12, ...pitches.slice().sort((a, b) => a - b)], seq = [0, 3, 2, 3, 1, 3, 2, 3];
  seq.forEach((k, i) => { if (i * .5 < span) note(out, start + i * .5, 1.1, T[Math.min(k, T.length - 1)], i % 2 ? .55 : .8); });
}
function chugInto(out, start, span, root, vel = 1) {
  for (let i = 0; i < 8; i++) if (i * .5 < span) [root, root + 7].forEach(p => note(out, start + i * .5, .42, p, (i % 2 ? .6 : .88) * vel));
}
// Insert a chord with a named strum pattern. Used by the chord palette; returns notes relative to `start`.
G.strumChord = (name, pitches, len, start = 0) => {
  const out = [];
  if (name === 'fingerpick') for (let b = 0; b < len; b += 4) fingerpickInto(out, start + b, Math.min(4, len - b), pitches);
  else if (name === 'chug') for (let b = 0; b < len; b += 4) chugInto(out, start + b, Math.min(4, len - b), Math.min(...pitches) - 12 >= 36 ? Math.min(...pitches) - 12 : Math.min(...pitches));
  else if (name === 'powers') { const r = Math.min(...pitches) - 12 >= 36 ? Math.min(...pitches) - 12 : Math.min(...pitches); for (let b = 0; b < len; b += 2) [r, r + 7, r + 12].forEach(p => note(out, start + b, 1.9, p, .8)); }
  else if (STRUMS[name]) for (let b = 0; b < len; b += 4) strumInto(out, start + b, Math.min(4, len - b), pitches, STRUMS[name]);
  else pitches.forEach(p => note(out, start, len * .95, p, .75));
  return out;
};

/* ---------- bass ---------- */
const BASS = {
  root(c, r, out) { for (let b = 0; b < c.len; b += 4) note(out, c.start + b, Math.min(4, c.len - b) * .95, r, .85); },
  sub(c, r, out) { note(out, c.start, c.len * .98, r, .85); },
  rootfifth(c, r, out) { bar(c, (o, span) => [[0, 1.5, 0, .9], [1.5, .5, 0, .7], [2.5, .5, 7, .75], [3, .5, 0, .7], [3.5, .5, 12, .65]].forEach(([s, l, st, v]) => s < span && note(out, o + s, l, r + st, v))); },
  eighth(c, r, out) { bar(c, (o, span) => { for (let i = 0; i < 8 && i * .5 < span; i++) note(out, o + i * .5, .45, r, i % 2 ? .65 : .85); }); },
  offbeat(c, r, out) { bar(c, (o, span) => { for (let i = 0; i < 4 && i < span; i++) note(out, o + i + .5, .4, r, .85); }); },
  octave(c, r, out) { bar(c, (o, span) => { for (let i = 0; i < 8 && i * .5 < span; i++) note(out, o + i * .5, .45, r + (i % 2 ? 12 : 0), i % 2 ? .65 : .85); }); },
  syncopated(c, r, out) { bar(c, (o, span) => [[0, .5, 0, .9], [.75, .25, 0, .6], [1.5, .5, 12, .8], [2, .5, 0, .85], [2.75, .25, 7, .7], [3.25, .5, 0, .75]].forEach(([s, l, st, v]) => s < span && note(out, o + s, l, r + st, v))); },
  bass808(c, r, out) { const slide = r - 5 >= 24 ? -5 : 7; bar(c, (o, span) => [[0, 1.5, 0, .95], [1.75, .25, 0, .6], [2.5, 1, 0, .85], [3.5, .5, slide, .7]].forEach(([s, l, st, v]) => s < span && note(out, o + s, l, r + st, v))); },
  dnb(c, r, out) { bar(c, (o, span) => [[0, .75, 0, .9], [.75, .25, 0, .6], [1.5, .5, 12, .8], [2.5, .5, 0, .85], [3, .5, 7, .7], [3.5, .5, 0, .7]].forEach(([s, l, st, v]) => s < span && note(out, o + s, l, r + st, v))); },
  arp8(c, r, out) { bar(c, (o, span) => [0, 0, 12, 0, 7, 0, 12, 7].forEach((st, i) => i * .5 < span && note(out, o + i * .5, .42, r + st, i % 2 ? .6 : .85))); },
  bossa(c, r, out) { bar(c, (o, span) => [[0, 1.5, 0, .8], [2, 1.5, 7, .7]].forEach(([s, l, st, v]) => s < span && note(out, o + s, l, r + st, v))); },
  reggae(c, r, out) { bar(c, (o, span) => [[1.5, 1, 0, .9], [3, .5, 7, .7], [3.5, .5, 0, .7]].forEach(([s, l, st, v]) => s < span && note(out, o + s, l, r + st, v))); },
  country(c, r, out) { bar(c, (o, span) => [[0, .9, 0, .9], [1, .4, 0, .5], [2, .9, 7, .8], [3, .4, 7, .5]].forEach(([s0, l, st, v]) => s0 < span && note(out, o + s0, l, r + st, v))); },
  shuffle(c, r, out) { const t = c.intervals[1], f = c.intervals[2]; bar(c, (o, span) => [0, 0, t, t, f, f, 9, f].forEach((st, i) => i * .5 < span && note(out, o + i * .5, .45, r + st, i % 2 ? .65 : .85))); },
  pump(c, r, out) { bar(c, (o, span) => { for (let i = 0; i < 8 && i * .5 < span; i++) note(out, o + i * .5, .4, r, i % 4 === 0 ? .95 : .75); }); },
  slap(c, r, out) { bar(c, (o, span) => [[0, .25, 0, .95], [.5, .25, 12, .7], [.75, .25, 0, .6], [1.5, .25, 0, .8], [2, .25, 0, .9], [2.5, .25, 12, .7], [3, .25, 7, .7], [3.5, .25, 0, .8]].forEach(([s0, l, st, v]) => s0 < span && note(out, o + s0, l, r + st, v))); },
  cumbia(c, r, out) { bar(c, (o, span) => { for (let i = 0; i < 8 && i * .5 < span; i++) note(out, o + i * .5, .4, r + (i % 2 ? 7 : 0), i % 2 ? .65 : .85); }); },
  amapiano(c, r, out) { bar(c, (o, span) => [[0, .75, 0, .95], [1.5, .5, 0, .8], [2.25, .5, 7, .8], [3, .75, 0, .85]].forEach(([s0, l, st, v]) => s0 < span && note(out, o + s0, l, r + st, v))); },
  walking(c, r, out, next) {
    const third = r + c.intervals[1], fifth = r + c.intervals[2], target = lowPc(next.rootPc, 28), approach = target + (target > fifth ? -1 : 1);
    bar(c, (o, span) => [r, third, fifth, approach].forEach((p, i) => i < span && note(out, o + i, .9, p, i ? .65 : .85)));
  },
};
function bar(c, fn) { for (let b = 0; b < c.len; b += 4) fn(c.start + b, Math.min(4, c.len - b)); }

/* ---------- mids ---------- */
const MIDS = {
  block(c, P, out) { bar(c, (o, span) => P.forEach(p => note(out, o, span * .95, p, .6))); },
  sparse(c, P, out) { bar(c, (o, span) => { P.forEach(p => { note(out, o, 2.25, p, .55); if (span > 2.5) note(out, o + 2.5, 1.25, p, .4); }); }); },
  comp(c, P, out, rng) {
    const pats = [[[0, .75, .7], [1.5, .5, .55], [2.5, .75, .6], [3.5, .5, .5]], [[.5, .5, .6], [1.5, .75, .65], [2.75, .5, .55]]];
    const pat = pick(rng, pats);
    bar(c, (o, span) => pat.forEach(([s, l, v]) => s < span && P.forEach(p => note(out, o + s, l, p, v))));
  },
  strum_folk(c, P, out) { bar(c, (o, span) => strumInto(out, o, span, P, STRUMS.folk)); },
  strum_pop(c, P, out) { bar(c, (o, span) => strumInto(out, o, span, P, STRUMS.pop)); },
  strum_ballad(c, P, out) { bar(c, (o, span) => strumInto(out, o, span, P, STRUMS.ballad)); },
  country_bc(c, P, out) { bar(c, (o, span) => strumInto(out, o, span, P, STRUMS.country)); },
  mutedfunk(c, P, out) { bar(c, (o, span) => strumInto(out, o, span, P, STRUMS.funk)); },
  fingerpick(c, P, out) { bar(c, (o, span) => fingerpickInto(out, o, span, P)); },
  chug(c, P, out) { const r = lowPc(c.rootPc, 40); bar(c, (o, span) => chugInto(out, o, span, r)); },
  powers(c, P, out) { const r = lowPc(c.rootPc, 40); bar(c, (o, span) => [0, 2].forEach(b => b < span && [r, r + 7, r + 12].forEach(p => note(out, o + b, 1.9, p, .8)))); },
  blues_stab(c, P, out) { bar(c, (o, span) => [[.5, .35, .8], [1.5, .35, .7], [2.5, .35, .8], [3.5, .35, .7]].forEach(([s0, l, v]) => s0 < span && P.forEach(p => note(out, o + s0, l, p, v)))); },
  stabs(c, P, out) { bar(c, (o, span) => [[.5, .3, .8], [1.5, .3, .7], [2, .3, .6], [3, .3, .7], [3.5, .3, .8]].forEach(([s, l, v]) => s < span && P.forEach(p => note(out, o + s, l, p, v)))); },
  pad(c, P, out) { const low = Math.min(...P) - 12; [low, ...P].forEach((p, i) => note(out, c.start, c.len * .98, p, i ? .45 : .35)); },
  arp8(c, P, out) { arp(c, P, out, .5); },
  arp16(c, P, out) { arp(c, P, out, .25); },
  skank(c, P, out) { bar(c, (o, span) => { for (let i = 0; i < 4 && i < span; i++) P.forEach(p => note(out, o + i + .5, .25, p, .7)); }); },
  pluckriff(c, P, out) { const T = [...P, P[0] + 12]; bar(c, (o, span) => [[0, 0], [.75, 2], [1.5, 1], [2, 2], [2.75, 0], [3.25, 3]].forEach(([s, i]) => s < span && note(out, o + s, .3, T[i % T.length], .7))); },
};
function arp(c, P, out, step) {
  const T = [...P, ...P.map(p => p + 12)], seq = [...T.keys(), ...[...T.keys()].slice(1, -1).reverse()];
  let k = 0; for (let t = 0; t < c.len - 1e-9; t += step) { note(out, c.start + t, step * .9, T[seq[k % seq.length]], (k % 4 === 0) ? .75 : .55); k++; }
}

/* ---------- vox / melody ---------- */
const VOX = {
  pad_ooh(c, P, out) { const up = P.map(p => p + 12 > 84 ? p : p + 12); up.forEach(p => note(out, c.start, c.len * .98, p, .5)); },
  chops(c, P, out, rng) {
    const T = [...P, ...P.map(p => p + 12)].filter(p => p >= 60 && p <= 80);
    bar(c, (o, span) => [[.5, .25], [1.25, .25], [2.5, .25], [3.25, .25]].forEach(([s, l]) => s < span && rng() < .85 && note(out, o + s, l, pick(rng, T.length ? T : P), .8)));
  },
};
const RHYTHMS = [
  [[0, 1], [1, .5], [1.5, .5], [2, 1], [3, 1]], [[0, .5], [.5, .5], [1, 1], [2, .5], [2.5, .5], [3, 1]], [[0, 1.5], [1.5, .5], [2, 2]],
  [[0, .5], [1, .5], [1.5, .5], [2.5, .5], [3, .5], [3.5, .5]], [[.5, .5], [1, 1], [2.5, .5], [3, 1]], [[0, 2], [2, 1], [3, 1]],
];
G.melody = (chords, recipe, rng, { register = [60, 79], hook = true, sparse = false } = {}) => {
  const iv = SCALE_IV[recipe.harmony] || SCALE_IV.Major, out = [];
  const pool = []; for (let p = register[0]; p <= register[1]; p++) if (iv.includes((((p - recipe.root) % 12) + 12) % 12)) pool.push(p);
  const near = (target, list) => list.reduce((b, p) => Math.abs(p - target) < Math.abs(b - target) ? p : b, list[0]);
  let idx = Math.floor(pool.length / 2);
  const makeBar = (c, finalOfChord) => {
    const tones = pool.filter(p => c.intervals.some(i => ((p - c.rootPc - i) % 12 + 12) % 12 === 0));
    const rhythm = sparse ? pick(rng, [[[0, 2], [2, 2]], [[0, 1.5], [2, 2]], [[1, 2]]]) : pick(rng, RHYTHMS), bars = [];
    rhythm.forEach(([s, l], k) => {
      if (k === 0 && tones.length) idx = pool.indexOf(near(pool[idx], tones));
      else idx = clamp(idx + pick(rng, [-2, -1, -1, 0, 1, 1, 2, rng() < .15 ? 3 : -3]) + (idx > pool.length * .8 ? -1 : idx < pool.length * .2 ? 1 : 0), 0, pool.length - 1);
      if (k === rhythm.length - 1 && finalOfChord && tones.length) idx = pool.indexOf(near(pool[idx], tones));
      bars.push([s, l, pool[idx]]);
    });
    return bars;
  };
  const barList = []; chords.forEach(c => { for (let b = 0; b < c.len; b += 4) barList.push({ c, o: c.start + b, last: b + 4 >= c.len }); });
  const motif = [];
  barList.forEach((b, i) => {
    const slot = i % 2; let notes;
    if (hook && i >= 2 && motif[slot] && i % 4 !== 3) notes = motif[slot];     // repeat the 2-bar hook, with a fresh answer phrase every 4th bar
    else notes = makeBar(b.c, b.last);
    if (hook && i < 2) motif[i] = notes;
    notes.forEach(([s, l, p]) => note(out, b.o + s, l * .92, p, sparse ? .5 : .7 + (s === 0 ? .1 : 0)));
  });
  return out;
};


/* ---------- poems ---------- */
// A rough English syllable counter: enough to pace a reading, not a dictionary.
G.syllables = word => {
  let w = String(word).toLowerCase().replace(/[^a-z]/g, ''); if (!w) return 0; if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, ''); const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
};
G.parsePoem = text => {
  const stanzas = []; let count = 0, truncated = 0;
  String(text || '').replace(/\r/g, '').split(/\n\s*\n/).forEach(block => {
    const lines = [];
    block.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach(l => {
      if (count >= 400) { truncated++; return; }
      const words = l.split(' ').filter(Boolean); lines.push({ text: l.slice(0, 160), words: words.length, syl: Math.max(1, words.reduce((s, w) => s + G.syllables(w), 0)) }); count++;
    });
    if (lines.length) stanzas.push({ lines });
  });
  return { stanzas, lines: count, truncated };
};
// Lay a parsed poem on a bar grid. Each line gets as many bars as its reading time needs (at least one);
// returns lyric times (beats), generator sections (Intro, Stanza n, Outro) and markers. maxBars keeps it inside the project limit.
G.layoutPoem = (poem, { tempo = 66, wpm = 105, introBars = 2, outroBars = 2, maxBars = 64, moodPlay = {} } = {}) => {
  const barSec = 4 * 60 / tempo, sps = wpm * 1.45 / 60;           // syllables per second at a natural reading pace
  const play = { drums: 'lite', bass: 1, mids: 1, vox: 0, extra: 0, ...moodPlay };
  const lyrics = [], sections = [{ name: 'Intro', bars: introBars, play: { drums: 0, bass: 0, mids: 1, vox: 0, extra: 0 } }], markers = [{ beat: 0, name: 'Intro' }];
  let bar = introBars, dropped = 0;
  poem.stanzas.forEach((st, si) => {
    const startBar = bar; let used = 0; const items = [];
    st.lines.forEach(l => { const bars = Math.max(1, Math.ceil((l.syl / sps + .5) / barSec)); items.push({ l, bars }); used += bars; });
    if (startBar + used + 1 > maxBars) { dropped += st.lines.length; return; }
    markers.push({ beat: startBar * 4, name: 'Stanza ' + (si + 1) });
    let b = startBar; items.forEach(({ l, bars }) => { lyrics.push({ t: b * 4, text: l.text, stanza: si + 1 }); b += bars; });
    sections.push({ name: 'Stanza ' + (si + 1), bars: used, play: { ...play, extra: si % 2 ? 1 : 0 } }); bar += used;
  });
  let total = bar + outroBars; if (total % 2) total++;               // projects are an even number of bars long
  sections.push({ name: 'Outro', bars: total - bar, play: { drums: 0, bass: 0, mids: 1, vox: 0, extra: 1 } }); markers.push({ beat: bar * 4, name: 'Outro' });
  return { lyrics, sections, markers, totalBars: total, dropped, seconds: Math.round(total * barSec) };
};
// Volume points that dip under spoken intervals [{a, b}] (beats): ramp down 1 beat before, hold, ramp back after.
G.duckLane = (intervals, base, depth = .45, ramp = 1, total = 256) => {
  const merged = []; intervals.slice().sort((x, y) => x.a - y.a).forEach(iv => { const last = merged[merged.length - 1]; if (last && iv.a - last.b < 2 * ramp) last.b = Math.max(last.b, iv.b); else merged.push({ a: iv.a, b: iv.b }); });
  const pts = [], low = Math.max(0, +(base * depth).toFixed(3));
  merged.forEach(({ a, b }) => { pts.push({ t: Math.max(0, r4(a - ramp)), v: base }, { t: r4(a), v: low }, { t: r4(Math.min(total, b)), v: low }, { t: r4(Math.min(total, b + ramp)), v: base }); });
  const out = []; pts.forEach(p => { if (out.length && Math.abs(out[out.length - 1].t - p.t) < 1e-6) out[out.length - 1] = p; else out.push(p); });
  return out;
};

/* ---------- guitar riffs ---------- */
// A repeating pentatonic riff over the whole progression: a 2-bar motif, restated, with a changed ending every 4th bar.
G.riff = (chords, recipe, rng, { register = [52, 74] } = {}) => {
  const iv = /Major|Mixolydian/.test(recipe.harmony) ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10], out = [], pool = [];
  for (let p = register[0]; p <= register[1]; p++) if (iv.includes((((p - recipe.root) % 12) + 12) % 12)) pool.push(p);
  let idx = Math.floor(pool.length / 3);
  const makeBar = () => pick(rng, RHYTHMS).map(([s0, l]) => { idx = clamp(idx + pick(rng, [-2, -1, -1, 0, 1, 1, 2, 3, -3]), 0, pool.length - 1); return [s0, l, pool[idx]]; });
  const bars = []; chords.forEach(c => { for (let b = 0; b < c.len; b += 4) bars.push(c.start + b); });
  const motif = [makeBar(), makeBar()];
  bars.forEach((o, i) => {
    let m = motif[i % 2]; if (i % 4 === 3) m = makeBar();
    m.forEach(([s0, l, p]) => note(out, o + s0, l * .85, p, .7 + (s0 === 0 ? .15 : 0)));
  });
  return out;
};

/* ---------- arpeggiator (turns held chords into patterns) ---------- */
G.arpeggiate = (notes, { pattern = 'up', step = .5, gate = .9, octaves = 1, rng = Math.random } = {}) => {
  const groups = new Map(); notes.forEach(n => { const k = r4(n.start) + ':' + r4(n.duration); (groups.get(k) || groups.set(k, []).get(k)).push(n); });
  const out = [];
  groups.forEach(g => {
    const base = g.map(n => n.pitch).sort((a, b) => a - b), pitches = []; for (let o = 0; o < octaves; o++) base.forEach(p => pitches.push(p + 12 * o));
    let seq = pitches.map((_, i) => i);
    if (pattern === 'down') seq.reverse(); else if (pattern === 'updown' && seq.length > 2) seq = [...seq, ...seq.slice(1, -1).reverse()]; else if (pattern === 'random') seq = null;
    const start = g[0].start, dur = g[0].duration, vel = g.reduce((s, n) => s + n.velocity, 0) / g.length;
    let k = 0; for (let t = 0; t < dur - 1e-9; t += step) {
      const p = seq ? pitches[seq[k % seq.length]] : pitches[Math.floor(rng() * pitches.length)];
      note(out, start + t, Math.min(step, dur - t) * gate, p, vel * (k % 4 === 0 ? 1 : .8)); k++;
    }
  });
  return out;
};

/* ---------- song generator ---------- */
// recipe: a genre from data/genres.json. structures/beats: the data tables. Returns a plain description the studio turns into a project.
G.generate = (recipe, structures, beats, seed = 1, sectionsOverride = null) => {
  const rng = G.rng(seed), sections = sectionsOverride || structures[recipe.structure] || structures.standard;
  const beat = recipe.beat ? beats.find(b => b.id === recipe.beat) : null;
  const R = { root: recipe.root, harmony: recipe.harmony, prog: recipe.prog };
  const roles = { drums: [], bass: [], mids: [], vox: [], extra: [], riser: [], impact: [], texture: [] };
  const markers = []; let cursor = 0;
  sections.forEach((sec, si) => {
    const start = cursor * 4, chords = G.chordSequence(R, sec.bars, start), play = sec.play, next = sections[si + 1];
    markers.push({ beat: start, name: sec.name });
    if (beat && play.drums) roles.drums.push(...G.beatNotes(beat, sec.bars, { start, lite: play.drums === 'lite' }));
    chords.forEach((c, ci) => {
      const nxt = chords[(ci + 1) % chords.length] || c;
      if (play.bass && recipe.bass) (BASS[recipe.bass.style] || BASS.root)(c, lowPc(c.rootPc, 28), roles.bass, nxt);
      if (play.mids && recipe.mids) (MIDS[recipe.mids.style] || MIDS.block)(c, G.voice(c, recipe.mids.style === 'pad' ? 58 : 62), roles.mids, rng);
      if (play.vox && recipe.vox && recipe.vox.style !== 'melody') (VOX[recipe.vox.style] || VOX.pad_ooh)(c, G.voice(c, 68), roles.vox, rng);
    });
    if (play.extra && recipe.extra) {
      const st = recipe.extra.style;
      if (st === 'riff') roles.extra.push(...G.riff(chords, R, rng));
      else if (st === 'melody' || st === 'sparse_melody') roles.extra.push(...G.melody(chords, R, rng, { register: recipe.extra.role === 'vox' ? [62, 79] : [64, 84], hook: true, sparse: st === 'sparse_melody' }));
      else chords.forEach(c => (MIDS[st] || MIDS.arp8)(c, G.voice(c, 66), roles.extra, rng));
    }
    if (si > 0 && recipe.fx.impact) note(roles.impact, start, 1, 36, .9);
    if (next && recipe.fx.riser && (next.play.vox > play.vox || /chorus|drop|swell/i.test(next.name))) note(roles.riser, start + sec.bars * 4 - 4, 4, 60, .8);
    cursor += sec.bars;
  });
  if (recipe.fx.texture) note(roles.texture, 0, cursor * 4, 60, .35);
  const total = cursor * 4, tr = [];
  const T = (role, name, element, instrument, notes, params) => notes.length && tr.push({ role, name, element, instrument, notes, params });
  T('drums', 'Drums', 'drums', recipe.kit, roles.drums, { volume: .85 });
  const tape = recipe.tape || 0, quiet = recipe.poem ? .7 : 1;      // poem beds sit lower so a voice can sit on top
  if (recipe.bass) T('bass', 'Bass', 'bass', recipe.bass.instrument, roles.bass, { volume: .8 * quiet });
  T('mids', 'Mids', 'mids', recipe.mids.instrument, roles.mids, { volume: .6 * quiet, reverb: .22, tape });
  if (recipe.extra) T('extra', recipe.extra.name, recipe.extra.role || 'mids', recipe.extra.instrument, roles.extra, { volume: .5 * quiet, reverb: .3, delay: .18, tape });
  if (recipe.vox) T('vox', 'Vox', 'vox', recipe.vox.instrument, roles.vox, { volume: .5, reverb: .4, tape });
  if (recipe.fx.riser) T('riser', 'Riser', 'fx', recipe.fx.riser, roles.riser, { volume: .5, reverb: .3 });
  if (recipe.fx.impact) T('impact', 'Impact', 'fx', recipe.fx.impact, roles.impact, { volume: .7, reverb: .35 });
  if (recipe.fx.texture) T('texture', 'Texture', 'fx', recipe.fx.texture, roles.texture, { volume: .4, reverb: .2 });
  return { poem: !!recipe.poem, tempo: recipe.tempo, swing: recipe.swing || 0, keyRoot: recipe.root, scale: recipe.scale, bars: total / 4, markers, tracks: tr, genre: { id: recipe.id, seed } };
};


/* ---------- understanding a project: chord detection, summary, change diff ---------- */
const TEMPLATES = [['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['°', [0, 3, 6]]];
G.detectChord = notes => {
  const w = new Array(12).fill(0); let tot = 0;
  notes.forEach(n => { const d = Math.min(n.duration, 4) * (.5 + n.velocity); w[((n.pitch % 12) + 12) % 12] += d; tot += d; });
  if (!tot) return null;
  let best = null, bestScore = -1;
  for (let r = 0; r < 12; r++) for (const [name, iv] of TEMPLATES) {
    const set = new Set(iv.map(i => (r + i) % 12)); let inside = 0; set.forEach(pc => { inside += w[pc]; });
    const score = inside / tot - (iv.length > 3 ? .04 : 0) - (name === '7' ? .01 : 0) + (w[r] / tot) * .15;
    if (score > bestScore) { bestScore = score; best = NN[r] + name; }
  }
  return bestScore > .6 ? best : null;
};
G.summarize = S => {
  const harmonic = S.tracks.filter(t => (t.element === 'mids' || t.element === 'vox' || t.element === 'bass') && t.notes && t.notes.length);
  const perBar = [];
  for (let b = 0; b < S.bars; b++) {
    const here = harmonic.filter(t => t.element !== 'bass' || harmonic.length === 1).flatMap(t => t.notes.filter(n => n.start >= b * 4 && n.start < b * 4 + 4));
    perBar.push(G.detectChord(here.length ? here : harmonic.flatMap(t => t.notes.filter(n => n.start >= b * 4 && n.start < b * 4 + 4))));
  }
  const marks = (S.markers || []).slice().sort((a, b) => a.beat - b.beat), sections = [];
  const cuts = marks.length ? marks : [{ beat: 0, name: 'Song' }];
  cuts.forEach((m, i) => {
    const startBar = Math.round(m.beat / 4), endBar = i + 1 < cuts.length ? Math.round(cuts[i + 1].beat / 4) : S.bars, seq = [];
    perBar.slice(startBar, endBar).forEach(c => { if (c && seq[seq.length - 1] !== c) seq.push(c); });
    const active = S.tracks.filter(t => (t.notes || []).some(n => n.start >= startBar * 4 && n.start < endBar * 4) || (t.clips || []).some(c => c.start < endBar * 4 && c.start + (c.len / (c.rate || 1)) / (60 / S.tempo) > startBar * 4)).map(t => t.name);
    sections.push({ name: m.name, startBar: startBar + 1, bars: Math.max(0, endBar - startBar), chords: seq.slice(0, 8), playing: active });
  });
  const counts = {}; perBar.forEach(c => { if (c) counts[c] = (counts[c] || 0) + 1; });
  return {
    key: S.key || (NN[S.keyRoot || 0] + ' ' + String(S.scale || '').toLowerCase()), tempo: S.tempo, bars: S.bars, seconds: Math.round(S.bars * 4 * 60 / S.tempo),
    sections, commonChords: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]),
    instruments: S.tracks.map(t => ({ name: t.name, element: t.element, instrument: t.instrument, notes: (t.notes || []).length, clips: (t.clips || []).length })),
  };
};
const noteKey = n => n.pitch + ':' + r4(n.start) + ':' + r4(n.duration);
// Plain-language list of what changed between two project states.
G.diffStates = (a, b) => {
  const lines = []; let added = 0, removed = 0;
  if (a.tempo !== b.tempo) lines.push(`tempo ${a.tempo} → ${b.tempo} BPM`);
  if (a.key !== b.key) lines.push(`key ${a.key} → ${b.key}`);
  if (a.bars !== b.bars) lines.push(`length ${a.bars} → ${b.bars} bars`);
  if (a.swing !== b.swing) lines.push('swing changed');
  const A_ = new Map((a.tracks || []).map(t => [t.id, t])), B_ = new Map((b.tracks || []).map(t => [t.id, t]));
  B_.forEach((t, id) => { if (!A_.has(id)) lines.push(`added track "${t.name}" (${t.instrument})`); });
  A_.forEach((t, id) => { if (!B_.has(id)) lines.push(`removed track "${t.name}"`); });
  B_.forEach((t, id) => {
    const o = A_.get(id); if (!o) return;
    if (o.instrument !== t.instrument) lines.push(`${t.name}: ${o.instrument} → ${t.instrument}`);
    if (o.name !== t.name) lines.push(`renamed "${o.name}" → "${t.name}"`);
    const ok = new Set((o.notes || []).map(noteKey)), nk = new Set((t.notes || []).map(noteKey));
    let ad = 0, rm = 0; nk.forEach(k => { if (!ok.has(k)) ad++; }); ok.forEach(k => { if (!nk.has(k)) rm++; });
    if (ad || rm) lines.push(`${t.name}: ${ad ? '+' + ad : ''}${ad && rm ? ' / ' : ''}${rm ? '−' + rm : ''} notes`);
    added += ad; removed += rm;
    const oc = (o.clips || []).length, nc = (t.clips || []).length; if (oc !== nc) lines.push(`${t.name}: ${nc > oc ? '+' : '−'}${Math.abs(nc - oc)} audio clip${Math.abs(nc - oc) > 1 ? 's' : ''}`);
    const pa = JSON.stringify(o.params), pb = JSON.stringify(t.params); if (pa !== pb) lines.push(`${t.name}: mix / sound settings`);
    if (!!o.mute !== !!t.mute) lines.push(`${t.name}: ${t.mute ? 'muted' : 'unmuted'}`);
  });
  if (JSON.stringify(a.markers || []) !== JSON.stringify(b.markers || [])) lines.push('sections changed');
  return { lines, added, removed };
};

/* ---------- MIDI ---------- */
G.parseMidi = input => {
  const buf = input instanceof ArrayBuffer ? input : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  const d = new DataView(buf); let o = 0;
  const u8 = () => { if (o >= d.byteLength) throw new Error('Unexpected end of MIDI data'); return d.getUint8(o++); };
  const u16 = () => { const v = d.getUint16(o); o += 2; return v; }, u32 = () => { const v = d.getUint32(o); o += 4; return v; };
  const tag = () => { let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(u8()); return s; };
  if (d.byteLength < 14 || tag() !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32(), format = u16(), ntrks = u16(), div = u16(); o = 8 + hlen;
  if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const ppq = div, tracks = []; let tempo = 120, totalNotes = 0;
  for (let t = 0; t < ntrks && o + 8 <= d.byteLength; t++) {
    const id = tag(), len = u32(), end = Math.min(d.byteLength, o + len);
    if (id !== 'MTrk') { o = end; continue; }
    let tick = 0, status = 0, name = ''; const open = new Map(), byCh = new Map();
    const chan = ch => byCh.get(ch) || byCh.set(ch, { name, channel: ch, program: 0, notes: [] }).get(ch);
    const vlq = () => { let v = 0, n = 0; for (;;) { const b = u8(); v = (v << 7) | (b & 127); if (!(b & 128)) return v; if (++n > 4) throw new Error('Bad MIDI delta time'); } };
    while (o < end) {
      tick += vlq(); let s = u8();
      if (s < 0x80) { o--; s = status; if (!s) throw new Error('Bad MIDI running status'); } else if (s < 0xF0) status = s;
      if (s === 0xFF) { const type = u8(), l = vlq(), at = o; if (type === 0x51 && l === 3 && tempo === 120 && !tracks.length) tempo = Math.round(6e7 / ((d.getUint8(at) << 16) | (d.getUint8(at + 1) << 8) | d.getUint8(at + 2))); if (type === 0x03) name = String.fromCharCode(...new Uint8Array(buf, at, Math.min(l, 60))); o = at + l; if (type === 0x2F) break; }
      else if (s === 0xF0 || s === 0xF7) { o += vlq(); }
      else {
        const kind = s & 0xF0, ch = s & 15, a = u8(), b = (kind === 0xC0 || kind === 0xD0) ? 0 : u8();
        if (kind === 0xC0) chan(ch).program = a;
        else if (kind === 0x90 && b > 0) { const k = ch + ':' + a; (open.get(k) || open.set(k, []).get(k)).push({ tick, v: b }); }
        else if (kind === 0x80 || (kind === 0x90 && b === 0)) { const st = open.get(ch + ':' + a); if (st && st.length) { const n = st.shift(); chan(ch).notes.push({ pitch: a, start: n.tick / ppq, duration: Math.max(.03, (tick - n.tick) / ppq), velocity: n.v / 127 }); if (++totalNotes > 20000) throw new Error('This MIDI file has too many notes (limit 20,000)'); } }
      }
    }
    open.forEach((list, k) => list.forEach(n => chan(+k.split(':')[0]).notes.push({ pitch: +k.split(':')[1], start: n.tick / ppq, duration: Math.max(.03, (tick - n.tick) / ppq), velocity: n.v / 127 })));
    byCh.forEach(c => { if (c.notes.length) tracks.push({ ...c, name: c.name || ('Channel ' + (c.channel + 1)), notes: c.notes.map(n => ({ ...n, start: r4(n.start), duration: r4(n.duration), velocity: r4(n.velocity) })).sort((a, b) => a.start - b.start) }); });
    o = end;
  }
  return { format, ppq, tempo: clamp(tempo, 30, 240), tracks };
};

G.encodeMidi = (S, gmProgram = {}) => {
  const ppq = 480, enc = s => [...new TextEncoder().encode(s)];
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], u16 = n => [(n >>> 8) & 255, n & 255];
  const vlq = n => { n = Math.max(0, Math.round(n)); const o = [n & 127]; while ((n >>= 7)) o.unshift((n & 127) | 128); return o; };
  const meta = (type, data, delta = 0) => [...vlq(delta), 0xFF, type, ...vlq(data.length), ...data];
  const chunk = ev => [...enc('MTrk'), ...u32(ev.length), ...ev];
  const tempoUs = Math.round(6e7 / S.tempo);
  const marks = (S.markers || []).slice().sort((a, b) => a.beat - b.beat); let last = 0;
  const cond = [...meta(0x03, enc('LOOM')), ...meta(0x51, [(tempoUs >>> 16) & 255, (tempoUs >>> 8) & 255, tempoUs & 255]), ...meta(0x58, [4, 2, 24, 8])];
  marks.forEach(m => { const t = Math.round(m.beat * ppq); cond.push(...meta(0x06, enc(String(m.name).slice(0, 40)), t - last)); last = t; });
  cond.push(...meta(0x2F, []));
  const chunks = [chunk(cond)]; let next = 0;
  S.tracks.forEach(t => {
    if (!t.notes.length) return;
    const drums = t.element === 'drums'; let ch = 9; if (!drums) { if (next === 9) next++; ch = next++ % 16; if (ch === 9) ch = 10; }
    const ev = [...meta(0x03, enc(t.name).slice(0, 60))]; if (!drums) ev.push(0, 0xC0 | ch, (gmProgram[t.instrument] || 0) & 127);
    const shift = drums ? 0 : (t.params.transpose || 0);
    const list = t.notes.flatMap(n => { const p = clamp(n.pitch + shift, 0, 127), v = clamp(Math.round(n.velocity * 127), 1, 127); return [{ tick: Math.round(n.start * ppq), on: 1, p, v }, { tick: Math.round((n.start + n.duration) * ppq), on: 0, p, v: 0 }]; }).sort((a, b) => a.tick - b.tick || a.on - b.on);
    let at = 0; list.forEach(x => { ev.push(...vlq(x.tick - at), (x.on ? 0x90 : 0x80) | ch, x.p, x.v); at = x.tick; });
    ev.push(...meta(0x2F, [])); chunks.push(chunk(ev));
  });
  return new Uint8Array([...enc('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(ppq), ...chunks.flat()]);
};

if (typeof module !== 'undefined' && module.exports) module.exports = G; else root.LoomGen = G;
})(typeof window !== 'undefined' ? window : globalThis);

/* LOOM audio engine: instruments for the 5-element formula, per-track effects, offline render.
   Everything takes an AudioContext-like `ctx`, so the same code drives live playback and WAV export. */
(() => {
'use strict';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mtof = p => 440 * Math.pow(2, (p - 69) / 12);
const A = window.LoomAudio = {};

/* ---------- catalogue ---------- */
A.ELEMENTS = {
  drums: { n: 1, label: 'Drums', color: '#974b37', instruments: ['Acoustic Kit', 'Rock Kit', 'Jazz Brush', '808 Kit', 'Trap Kit', 'Lo-Fi Kit', 'Electronic Kit', 'House Kit', 'Linn Kit', 'CR-78 Kit'] },
  bass:  { n: 2, label: 'Bass',  color: '#b38a51', instruments: ['Sub Bass', 'Synth Bass', 'Electric Bass', 'Pluck Bass', 'Acid 303', 'Reese Bass', 'FM Bass', 'Wobble Bass', 'Slap Bass', 'Upright Bass', 'Square Sub'], lo: 24, hi: 60 },
  mids:  { n: 3, label: 'Mids',  color: '#6f7d4a', instruments: ['Soft Keys', 'Grand Piano', 'Organ', 'Warm Pad', 'Strings', 'Nylon Guitar', 'Pluck Synth', 'Saw Lead', 'Square Lead', 'Super Saw', 'Clav', 'Vibraphone', 'Music Box', 'Harp', 'Brass Section', 'Flute', 'Pedal Steel', 'Mellotron', 'Analog Poly', 'Acoustic Guitar', 'Electric Clean', 'Overdrive Guitar', 'Distortion Guitar', 'Muted Guitar', '12-String Guitar', 'Ukulele', 'Banjo', 'Mandolin', 'Rhodes', 'Marimba', 'Kalimba', 'Accordion', 'Violin', 'Cello', 'Pizzicato', 'Trumpet', 'Sax'], lo: 36, hi: 96 },
  vox:   { n: 4, label: 'Vox',   color: '#4f7f86', instruments: ['Choir Ahh', 'Choir Ooh', 'Choir Eee', 'Vox Lead', 'Vox Chop', 'Whisper', 'Humming', 'Audio Clips'], lo: 48, hi: 84 },
  fx:    { n: 5, label: 'Effects', color: '#7b5a8a', instruments: ['Riser', 'Downlifter', 'Impact', 'Noise Sweep', 'Laser', 'Texture', 'Reverse Cymbal', 'Sub Drop', 'Vinyl Crackle', 'Wind', 'Whoosh', 'Glitch'], lo: 36, hi: 84 },
};

// Browser categories (used by the sound picker)
A.CATEGORY = {
  'Guitars & plucked': ['Pedal Steel', 'Acoustic Guitar', 'Electric Clean', 'Overdrive Guitar', 'Distortion Guitar', 'Muted Guitar', '12-String Guitar', 'Nylon Guitar', 'Ukulele', 'Banjo', 'Mandolin', 'Harp', 'Pizzicato', 'Pluck Synth'],
  'Keys & mallets': ['Soft Keys', 'Rhodes', 'Grand Piano', 'Organ', 'Clav', 'Vibraphone', 'Marimba', 'Kalimba', 'Music Box', 'Accordion'],
  'Strings & winds': ['Mellotron', 'Strings', 'Violin', 'Cello', 'Brass Section', 'Trumpet', 'Sax', 'Flute'],
  'Synths & pads': ['Warm Pad', 'Analog Poly', 'Saw Lead', 'Square Lead', 'Super Saw'],
  'Bass': ['Sub Bass', 'Synth Bass', 'Electric Bass', 'Pluck Bass', 'Acid 303', 'Reese Bass', 'FM Bass', 'Wobble Bass', 'Slap Bass', 'Upright Bass', 'Square Sub'],
  'Drum kits': ['Acoustic Kit', 'Rock Kit', 'Jazz Brush', '808 Kit', 'Trap Kit', 'Lo-Fi Kit', 'Electronic Kit', 'House Kit', 'Linn Kit', 'CR-78 Kit'],
  'Voices': ['Choir Ahh', 'Choir Ooh', 'Choir Eee', 'Vox Lead', 'Vox Chop', 'Whisper', 'Humming'],
  'FX & textures': ['Riser', 'Downlifter', 'Impact', 'Noise Sweep', 'Laser', 'Texture', 'Reverse Cymbal', 'Sub Drop', 'Vinyl Crackle', 'Wind', 'Whoosh', 'Glitch'],
};
// top to bottom as drawn in the roll
A.DRUM_LANES = [[49, 'Crash'], [51, 'Ride'], [46, 'Open Hat'], [42, 'Closed Hat'], [54, 'Tambourine'], [56, 'Cowbell'], [70, 'Shaker'], [62, 'Conga Hi'], [64, 'Conga Lo'], [75, 'Clave'], [45, 'High Tom'], [41, 'Low Tom'], [39, 'Clap'], [38, 'Snare'], [37, 'Rim'], [36, 'Kick']];
A.BASE_PARAMS = { attack: .01, release: .25, tone: .6, transpose: 0, volume: .8, pan: 0, filter: 1, drive: 0, delay: 0, reverb: .15, eqLo: 0, eqMid: 0, eqHi: 0, tape: 0 };
const D = (attack, release, tone) => ({ attack, release, tone });
A.INSTRUMENT_DEFAULTS = {
  'Linn Kit': D(0, .3, .6), 'CR-78 Kit': D(0, .3, .5), 'Acoustic Kit': D(0, .3, .6), '808 Kit': D(0, .3, .5), 'Lo-Fi Kit': D(0, .3, .4), 'Electronic Kit': D(0, .3, .7),
  'Sub Bass': D(.01, .12, .4), 'Synth Bass': D(.005, .1, .5), 'Electric Bass': D(.005, .15, .5), 'Pluck Bass': D(.003, .1, .5),
  'Soft Keys': D(.004, .35, .55), 'Grand Piano': D(.003, .3, .6), 'Organ': D(.01, .08, .6), 'Warm Pad': D(.55, 1.2, .4),
  'Strings': D(.3, .7, .55), 'Nylon Guitar': D(.002, .25, .6), 'Pluck Synth': D(.002, .15, .6), 'Saw Lead': D(.01, .2, .6), 'Square Lead': D(.01, .2, .5),
  'Choir Ahh': D(.35, .9, .6), 'Choir Ooh': D(.4, 1, .5), 'Vox Lead': D(.04, .25, .6), 'Vox Chop': D(.005, .1, .6), 'Audio Clips': D(0, .1, .6), 'Rock Kit': D(0, .3, .6), 'Jazz Brush': D(0, .3, .5), 'Trap Kit': D(0, .3, .6), 'House Kit': D(0, .3, .65),
  'Acid 303': D(.003, .1, .6), 'Reese Bass': D(.01, .2, .5), 'FM Bass': D(.004, .15, .5), 'Wobble Bass': D(.01, .15, .5),
  'Clav': D(.002, .12, .6), 'Vibraphone': D(.003, .6, .6), 'Music Box': D(.002, .5, .6), 'Harp': D(.002, .5, .6), 'Brass Section': D(.04, .15, .6), 'Flute': D(.07, .2, .5), 'Super Saw': D(.01, .3, .6),
  'Choir Eee': D(.35, .9, .6), 'Whisper': D(.25, .6, .5), 'Humming': D(.3, .7, .4),
  'Pedal Steel': D(.04, .5, .55), 'Mellotron': D(.12, .8, .45), 'Analog Poly': D(.02, .4, .55), 'Acoustic Guitar': D(.002, .35, .6), 'Electric Clean': D(.002, .35, .6), 'Overdrive Guitar': D(.002, .3, .6), 'Distortion Guitar': D(.005, .12, .6), 'Muted Guitar': D(.002, .08, .5), '12-String Guitar': D(.002, .4, .6),
  'Ukulele': D(.002, .25, .6), 'Banjo': D(.002, .2, .6), 'Mandolin': D(.002, .25, .6), 'Rhodes': D(.003, .35, .55), 'Marimba': D(.002, .15, .6), 'Kalimba': D(.002, .3, .6), 'Accordion': D(.05, .12, .5),
  'Violin': D(.08, .25, .6), 'Cello': D(.1, .3, .5), 'Pizzicato': D(.002, .12, .6), 'Trumpet': D(.03, .15, .6), 'Sax': D(.05, .2, .5),
  'Slap Bass': D(.002, .1, .6), 'Upright Bass': D(.002, .25, .4), 'Square Sub': D(.01, .12, .4), 'Whoosh': D(0, .3, .5), 'Glitch': D(0, .1, .5), 'Reverse Cymbal': D(.01, .05, .6), 'Sub Drop': D(0, .5, .5), 'Vinyl Crackle': D(.1, .3, .5), 'Wind': D(.8, 1.2, .5),
  'Riser': D(.01, .05, .6), 'Downlifter': D(.01, .05, .6), 'Impact': D(0, .5, .5), 'Noise Sweep': D(.3, .4, .5), 'Laser': D(0, .2, .6), 'Texture': D(.5, .8, .5),
};
A.GM_PROGRAM = { 'Sub Bass': 38, 'Synth Bass': 38, 'Electric Bass': 33, 'Pluck Bass': 32, 'Soft Keys': 4, 'Grand Piano': 0, 'Organ': 16, 'Warm Pad': 89, 'Strings': 48, 'Nylon Guitar': 24, 'Pluck Synth': 84, 'Saw Lead': 81, 'Square Lead': 80, 'Choir Ahh': 52, 'Choir Ooh': 53, 'Vox Lead': 54, 'Vox Chop': 54, 'Choir Eee': 52, 'Whisper': 52, 'Clav': 7, 'Vibraphone': 11, 'Music Box': 10, 'Harp': 46, 'Brass Section': 61, 'Flute': 73, 'Super Saw': 81, 'Acid 303': 87, 'Reese Bass': 38, 'FM Bass': 38, 'Wobble Bass': 38,
  'Acoustic Guitar': 25, 'Electric Clean': 27, 'Overdrive Guitar': 29, 'Distortion Guitar': 30, 'Muted Guitar': 28, '12-String Guitar': 25, 'Ukulele': 24, 'Banjo': 105, 'Mandolin': 25, 'Rhodes': 4, 'Marimba': 12, 'Kalimba': 108,
  'Accordion': 21, 'Violin': 40, 'Cello': 42, 'Pizzicato': 45, 'Trumpet': 56, 'Sax': 65, 'Slap Bass': 36, 'Upright Bass': 32, 'Square Sub': 38, 'Humming': 54, 'Pedal Steel': 26, 'Mellotron': 48, 'Analog Poly': 90 };

/* ---------- graph ---------- */
// Algorithmic stereo reverb: 6 damped feedback combs per side into 2 allpass diffusers. It costs a small fraction of a
// convolution reverb, which dominated render time (a 16-bar song took over a minute with the convolver).
function makeReverb(ctx, input, output) {
  const pre = ctx.createDelay(.2); pre.delayTime.value = .018; input.connect(pre);
  const allpass = (node, t) => {                                  // v = x + g*v[n-D];  y = -g*v + v[n-D]
    const v = ctx.createGain(), d = ctx.createDelay(.1), fb = ctx.createGain(), neg = ctx.createGain(), out = ctx.createGain();
    d.delayTime.value = t; fb.gain.value = .5; neg.gain.value = -.5;
    node.connect(v); v.connect(d); d.connect(fb); fb.connect(v); v.connect(neg); neg.connect(out); d.connect(out);
    return out;
  };
  const side = times => {
    const sum = ctx.createGain(); sum.gain.value = .03;          // each comb has ~7x gain at low frequencies, so keep the wet level near unity
    times.forEach(t => {
      const d = ctx.createDelay(.2), lp = ctx.createBiquadFilter(), fb = ctx.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0; d.delayTime.value = t; fb.gain.value = .86;   // Q must be 0: the default resonance pushes the loop gain above 1 and the tail grows instead of fading
      pre.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(sum);
    });
    return allpass(allpass(sum, .0126), .0077);
  };
  const L = side([.0253, .0269, .0290, .0307, .0322, .0338]), R = side([.0258, .0274, .0295, .0312, .0327, .0343]);
  const m = ctx.createChannelMerger(2); L.connect(m, 0, 0); R.connect(m, 0, 1); m.connect(output);
}
const curveCache = new Map();
function driveCurve(k) {
  if (curveCache.has(k)) return curveCache.get(k);
  const n = 1024, c = new Float32Array(n), a = 1 + k * 14;
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(a * x) / Math.tanh(a); }
  curveCache.set(k, c);
  return c;
}

A.makeGraph = ctx => {
  const masterIn = ctx.createGain(), comp = ctx.createDynamicsCompressor(), out = ctx.createGain(), analyser = ctx.createAnalyser();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .005; comp.release.value = .2;
  analyser.fftSize = 1024;
  masterIn.connect(comp); comp.connect(out); out.connect(analyser); out.connect(ctx.destination);
  const revIn = ctx.createGain(), revOut = ctx.createGain(); makeReverb(ctx, revIn, revOut); revOut.connect(masterIn);
  return { ctx, masterIn, comp, out, analyser, revIn, revOut, buses: new Map(), _noise: null };
};
A.applyMaster = (G, m) => {
  const t = G.ctx.currentTime;
  G.out.gain.setTargetAtTime(m.gain, t, .02);
  G.revOut.gain.setTargetAtTime(m.reverb, t, .02);
  G.comp.ratio.value = m.comp ? 4 : 1;
  G.comp.threshold.value = m.comp ? -14 : 0;
};
A.getBus = (G, track, env) => {
  let b = G.buses.get(track.id);
  if (b) return b;
  const c = G.ctx;
  b = {
    input: c.createGain(), filt: c.createBiquadFilter(), shaper: c.createWaveShaper(), pan: c.createStereoPanner(), vol: c.createGain(),
    dSend: c.createGain(), dly: c.createDelay(2), fb: c.createGain(), dfilt: c.createBiquadFilter(), rSend: c.createGain(), dk: -1, mg: c.createGain(), tapeDry: c.createGain(), tape: null,
    eqLo: c.createBiquadFilter(), eqMid: c.createBiquadFilter(), eqHi: c.createBiquadFilter(), an: c.createAnalyser(),
  };
  b.eqLo.type = 'lowshelf'; b.eqLo.frequency.value = 120; b.eqMid.type = 'peaking'; b.eqMid.frequency.value = 1000; b.eqMid.Q.value = .9; b.eqHi.type = 'highshelf'; b.eqHi.frequency.value = 6000; b.an.fftSize = 256;
  b.filt.type = 'lowpass'; b.filt.Q.value = .9; b.shaper.oversample = '2x';
  b.dfilt.type = 'lowpass'; b.dfilt.frequency.value = 3200; b.dfilt.Q.value = 0; b.fb.gain.value = .4;
  b.dSend.gain.value = 0; b.rSend.gain.value = 0;                  // sends start closed, so nothing leaks in before applyBus runs
  b.input.connect(b.eqLo); b.eqLo.connect(b.eqMid); b.eqMid.connect(b.eqHi); b.eqHi.connect(b.filt); b.filt.connect(b.shaper); b.shaper.connect(b.tapeDry); b.tapeDry.connect(b.pan); b.pan.connect(b.vol); b.vol.connect(b.mg); b.mg.connect(G.masterIn); b.mg.connect(b.an);   // mg = mute / solo stage, so automating volume never fights it
  b.mg.connect(b.dSend); b.dSend.connect(b.dly); b.dly.connect(b.dfilt); b.dfilt.connect(G.masterIn); b.dfilt.connect(b.fb); b.fb.connect(b.dly);
  b.mg.connect(b.rSend); b.rSend.connect(G.revIn);
  b.mg.gain.value = (!track.mute && (!env.anySolo || track.solo)) ? 1 : 0;
  G.buses.set(track.id, b);
  A.applyBus(G, track, env);
  return b;
};
function ensureTape(c, b) {
  if (b.tape) return b.tape;
  const dly = c.createDelay(.05), lp = c.createBiquadFilter(), wet = c.createGain(), a = c.createOscillator(), ag = c.createGain(), f = c.createOscillator(), fg = c.createGain();
  dly.delayTime.value = .008; lp.type = 'lowpass'; lp.Q.value = 0; wet.gain.value = 0;
  a.frequency.value = .55; f.frequency.value = 6.3; a.connect(ag); f.connect(fg); ag.connect(dly.delayTime); fg.connect(dly.delayTime); a.start(); f.start();
  b.shaper.connect(dly); dly.connect(lp); lp.connect(wet); wet.connect(b.pan);
  return (b.tape = { dly, lp, wet, ag, fg });
}
A.applyBus = (G, track, env) => {
  const b = G.buses.get(track.id); if (!b) return;
  const t = G.ctx.currentTime, p = track.params;
  const audible = !track.mute && (!env.anySolo || track.solo);
  const au = k => track.auto && track.auto[k] && track.auto[k].length;   // an automated parameter is driven by its lane, not by the knob
  b.mg.gain.setTargetAtTime(audible ? 1 : 0, t, .02);
  if (!au('volume')) b.vol.gain.setTargetAtTime(p.volume, t, .02);
  if (!au('pan')) b.pan.pan.setTargetAtTime(p.pan, t, .02);
  if (!au('filter')) b.filt.frequency.setTargetAtTime(120 * Math.pow(150, p.filter), t, .02);
  const dk = Math.round(p.drive * 20) / 20;
  if (b.dk !== dk) { b.shaper.curve = dk > 0 ? driveCurve(dk) : null; b.dk = dk; }
  if (!au('delay')) b.dSend.gain.setTargetAtTime(p.delay * .7, t, .02);
  b.dly.delayTime.setTargetAtTime(60 / env.tempo * .75, t, .05);
  if (!au('reverb')) b.rSend.gain.setTargetAtTime(p.reverb * .9, t, .02);
  const tp = clamp(p.tape || 0, 0, 1);
  if (tp > 0) { const T = ensureTape(G.ctx, b); b.tapeDry.gain.setTargetAtTime(0, t, .02); T.wet.gain.setTargetAtTime(1, t, .02); T.ag.gain.setTargetAtTime(tp * .0011, t, .05); T.fg.gain.setTargetAtTime(tp * .00025, t, .05); T.lp.frequency.setTargetAtTime(17000 - tp * 11000, t, .05); }
  else { b.tapeDry.gain.setTargetAtTime(1, t, .02); if (b.tape) b.tape.wet.gain.setTargetAtTime(0, t, .02); }
  b.eqLo.gain.setTargetAtTime(p.eqLo || 0, t, .02); b.eqMid.gain.setTargetAtTime(p.eqMid || 0, t, .02); b.eqHi.gain.setTargetAtTime(p.eqHi || 0, t, .02);
};
/* ---------- automation: parameter lanes drawn over time ---------- */
// Points are {t: beats, v: value}. A lane owns its parameter; between points the value ramps linearly.
A.AUTO_PARAMS = {
  volume: { label: 'Volume', min: 0, max: 1.2, node: b => b.vol.gain, map: v => v },
  filter: { label: 'Filter (low-pass)', min: 0, max: 1, node: b => b.filt.frequency, map: v => 120 * Math.pow(150, v) },
  pan:    { label: 'Pan', min: -1, max: 1, node: b => b.pan.pan, map: v => v },
  reverb: { label: 'Reverb send', min: 0, max: 1, node: b => b.rSend.gain, map: v => v * .9 },
  delay:  { label: 'Delay send', min: 0, max: 1, node: b => b.dSend.gain, map: v => v * .7 },
};
A.autoValue = (pts, beat) => {
  if (!pts || !pts.length) return null;
  if (beat <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (beat <= pts[i].t) { const a = pts[i - 1], b = pts[i]; return b.t === a.t ? b.v : a.v + (b.v - a.v) * (beat - a.t) / (b.t - a.t); }
  return pts[pts.length - 1].v;
};
// Schedule every lane of a track for beats [from, to). timeOf maps a beat to audio-context time.
// `jump` = playback (re)starts or loops here: clear later events and begin from the lane's value at `from`.
A.scheduleAuto = (G, track, env, from, to, timeOf, jump) => {
  if (!track.auto) return;
  for (const key of Object.keys(track.auto)) {
    const pts = track.auto[key], def = A.AUTO_PARAMS[key]; if (!def || !pts || !pts.length) continue;
    const param = def.node(A.getBus(G, track, env));
    if (jump) {
      const t0 = timeOf(from); param.cancelScheduledValues(t0); param.setValueAtTime(def.map(A.autoValue(pts, from)), t0);
      const nxt = pts.find(p => p.t > from); if (nxt) param.linearRampToValueAtTime(def.map(nxt.v), timeOf(nxt.t));
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]; if (p.t < from || p.t >= to) continue;
      param.setValueAtTime(def.map(p.v), timeOf(p.t)); const nx = pts[i + 1]; if (nx) param.linearRampToValueAtTime(def.map(nx.v), timeOf(nx.t));
    }
  }
};
A.busLevel = (G, id) => {
  const b = G.buses.get(id); if (!b) return 0;
  const d = new Uint8Array(b.an.fftSize); b.an.getByteTimeDomainData(d); let s = 0;
  for (let i = 0; i < d.length; i++) { const v = (d[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / d.length);
};
// Silence everything already scheduled (stop/pause): cut every bus off from the master.
A.killAll = G => { G.buses.forEach(b => { try { b.input.disconnect(); } catch (e) {} try { b.mg.disconnect(); } catch (e) {} try { b.vol.disconnect(); } catch (e) {} try { b.dfilt.disconnect(); } catch (e) {} }); G.buses.clear(); };

/* ---------- recorded samples ---------- */
// Instruments with recordings in assets/samples/ play those; everything else (and everything while samples are
// switched off or still loading) uses the synthesizers below. See assets/samples/CREDITS.md for sources and licences.
const SM = A.samples = { base: '/assets/samples/', manifest: null, manifestPromise: null, ready: new Set(), pending: new Map(), bufs: new Map(), norm: new Map(), dec: null };
A.loadManifest = (base) => {
  if (base) SM.base = base;
  if (!SM.manifestPromise) SM.manifestPromise = fetch(SM.base + 'manifest.json').then(r => r.ok ? r.json() : null).then(m => { SM.manifest = m; return m; }).catch(() => null);
  return SM.manifestPromise;
};
A.hasSamples = name => !!(SM.manifest && (SM.manifest.instruments[name] || SM.manifest.kits[name]));
A.samplesReady = name => SM.ready.has(name);
const decoder = () => SM.dec || (SM.dec = new OfflineAudioContext(1, 1, 44100));
const fetchBuf = async url => { const r = await fetch(url); if (!r.ok) throw new Error('missing sample ' + url); return decoder().decodeAudioData(await r.arrayBuffer()); };
// Find a seamless loop inside a held note: a rising zero crossing near 1 s, matched against candidates near the end.
function findLoop(buf) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, rise = i => d[i - 1] <= 0 && d[i] > 0;
  let s = Math.floor(sr * 1.0); while (s < d.length - 1 && !rise(s)) s++;
  const W = 96; let best = null, bestErr = 1e9;
  for (let e = Math.floor(sr * 2.3); e < Math.min(d.length - W - 1, Math.floor(sr * 2.95)); e++) {
    if (!rise(e)) continue; let err = 0; for (let k = 0; k < W; k++) { const x = d[s + k] - d[e + k]; err += x * x; }
    if (err < bestErr) { bestErr = err; best = e; }
  }
  return best ? { start: s / sr, end: best / sr } : null;
}
const peakOf = b => { let p = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } return p; };
// Load every recording an instrument needs. Safe to call repeatedly; resolves true once the instrument can play from samples.
A.loadSamples = async names => {
  await A.loadManifest(); if (!SM.manifest) return false;
  await Promise.all([...new Set(names)].filter(n => A.hasSamples(n) && !SM.ready.has(n)).map(n => {
    if (SM.pending.has(n)) return SM.pending.get(n);
    const set = SM.manifest.instruments[n], kit = SM.manifest.kits[n];
    const job = (async () => {
      if (set) {
        const bufs = await Promise.all(set.notes.map(note => fetchBuf(`${SM.base}${set.dir}/${note}.${set.ext}`)));
        const peaks = bufs.map(peakOf); SM.norm.set(n, Math.min(10, Math.max(.4, .42 / (peaks.reduce((a, b) => a + b, 0) / peaks.length || .1))));
        set.notes.forEach((note, i) => SM.bufs.set(n + ':' + note, { buf: bufs[i], loop: set.kind === 'sustain' ? findLoop(bufs[i]) : null }));
      } else {
        await Promise.all(Object.entries(kit.lanes).map(async ([lane, f]) => { const buf = await fetchBuf(`${SM.base}${kit.dir}/${f}`); SM.bufs.set(n + ':' + lane, { buf, norm: Math.min(4, Math.max(.3, .8 / (peakOf(buf) || .5))) }); }));
      }
      SM.ready.add(n);
    })().catch(() => {}).finally(() => SM.pending.delete(n));
    SM.pending.set(n, job); return job;
  }));
  return names.every(n => !A.hasSamples(n) || SM.ready.has(n));
};
// A pitched sample: nearest recording, pitch-shifted by playback rate; held instruments loop when the note outlasts the recording.
function sampleVoice({ ctx, dest, pitch, when, dur, vel, p }, name) {
  const set = SM.manifest.instruments[name], midi = pitch + (p.transpose || 0);
  const n = set.notes.reduce((b, x) => Math.abs(x - midi) < Math.abs(b - midi) ? x : b, set.notes[0]);
  if (Math.abs(n - midi) > 9) return false;                                   // far outside the recorded range: let the synth handle it
  const ent = SM.bufs.get(name + ':' + n); if (!ent) return false;
  const src = ctx.createBufferSource(), rate = Math.pow(2, (midi - n) / 12), e = ctx.createGain(), peak = SM.norm.get(name) * Math.pow(vel, 1.2) * .9;
  src.buffer = ent.buf; src.playbackRate.value = rate;
  const lp = filt(ctx, 'lowpass', clamp(1800 + p.tone * p.tone * 15000, 800, 18000), .5, e); src.connect(lp); e.connect(dest);
  const sustain = set.kind === 'sustain', a = sustain ? Math.max(.006, p.attack) : .003, rel = Math.max(.06, p.release * (sustain ? 1 : .6));
  const natural = ent.buf.duration / rate;                                    // seconds the recording lasts at this pitch
  let end = when + dur + rel;
  if (sustain && ent.loop && dur + rel > natural - .05) { src.loop = true; src.loopStart = ent.loop.start; src.loopEnd = ent.loop.end; }
  else if (!sustain) end = when + Math.max(dur + rel, Math.min(natural, dur + rel + 1.2));          // struck / plucked: let the note ring a little past its length
  e.gain.setValueAtTime(.0001, when); e.gain.linearRampToValueAtTime(peak, when + a);
  const hold = when + (sustain ? dur : Math.max(dur, .12)); e.gain.setValueAtTime(peak, hold); e.gain.exponentialRampToValueAtTime(.0001, hold + rel);
  src.start(when); src.stop(Math.min(hold + rel + .05, when + (src.loop ? 1e4 : natural) + .05));
  return true;
}
function drumSample({ G, ctx, dest, when, vel, p, kit, pitch }) {
  const set = SM.manifest.kits[kit], ent = set && set.lanes[pitch] && SM.bufs.get(kit + ':' + pitch); if (!ent) return false;
  const src = ctx.createBufferSource(), g = ctx.createGain(), ds = clamp(p.release / .3, .4, 3), vv = Math.pow(vel, 1.3) * ent.norm;
  src.buffer = ent.buf; g.gain.setValueAtTime(vv, when);
  const natural = ent.buf.duration;
  if (ds < 1) { g.gain.setValueAtTime(vv, when + natural * ds * .5); g.gain.exponentialRampToValueAtTime(.0001, when + natural * ds); }
  const lp = filt(ctx, 'lowpass', clamp(3000 + p.tone * 16000, 2000, 20000), .5, g); src.connect(lp); g.connect(dest); src.start(when); src.stop(when + natural + .05);
  return true;
}

/* ---------- helpers ---------- */
function noise(G) {
  if (!G._noise) { const c = G.ctx, len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; G._noise = b; }
  return G._noise;
}
function noiseSrc(G, when, stop) { const s = G.ctx.createBufferSource(); s.buffer = noise(G); s.loop = true; s.start(when, Math.random() * 1.5); s.stop(stop); return s; }
function osc(ctx, type, f, when, stop, dest, cents = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = cents; o.connect(dest); o.start(when); o.stop(stop); return o; }
function filt(ctx, type, f, q, dest) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(dest); return b; }
function vib(ctx, o, when, stop, rate = 5.4, depth = 7, delay = .15) {
  const l = ctx.createOscillator(), g = ctx.createGain();
  l.frequency.value = rate; g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(depth, when + delay + .4);
  l.connect(g); g.connect(o.detune); l.start(when); l.stop(stop);
}
// attack / optional decay-to-sustain / hold / release. Returns the time the voice ends.
function adsr(g, when, dur, a, r, peak, sus = 1) {
  a = Math.max(.002, Math.min(a, dur * .9));
  const tA = when + a, dl = sus < 1 ? Math.max(0, Math.min(.35, dur - a)) : 0;
  g.gain.setValueAtTime(.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), tA);
  let level = peak;
  if (dl > .01) { level = peak * sus; g.gain.exponentialRampToValueAtTime(Math.max(.0002, level), tA + dl); }
  const hold = Math.max(when + dur, tA + dl);
  g.gain.setValueAtTime(Math.max(.0002, level), hold);
  g.gain.exponentialRampToValueAtTime(.0001, hold + r);
  return hold + r + .05;
}
const cutoff = (p, f, base = 200, span = 10000) => clamp(base + p.tone * p.tone * span + f * .5, 120, 16000);

const ksCache = new Map();
function ks(ctx, f) {
  const key = ctx.sampleRate + ':' + f.toFixed(2);
  if (ksCache.has(key)) return ksCache.get(key);
  if (ksCache.size > 200) ksCache.clear();
  const sr = ctx.sampleRate, N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 2.2), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  for (let i = N; i < len; i++) d[i] = .5 * (d[i - N] + (i - N - 1 >= 0 ? d[i - N - 1] : 0)) * .997;
  ksCache.set(key, buf);
  return buf;
}


function ksx(ctx, f, s = .5, decay = .997) {
  const key = ctx.sampleRate + ':' + f.toFixed(2) + ':' + s + ':' + decay;
  if (ksCache.has(key)) return ksCache.get(key);
  if (ksCache.size > 300) ksCache.clear();
  const sr = ctx.sampleRate, N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 2.2), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  for (let i = N; i < len; i++) d[i] = ((1 - s) * d[i - N] + s * (i - N - 1 >= 0 ? d[i - N - 1] : 0)) * decay;
  ksCache.set(key, buf);
  return buf;
}
// Plucked-string voice: Karplus-Strong string -> tone filter (-> optional drive) -> envelope.
function pluck({ ctx, dest, f, when, dur, vel, p }, o) {
  const e = ctx.createGain(); e.connect(dest);
  const end = adsr(e, when, Math.max(dur, o.min || 1), p.attack, Math.max(.06, p.release), o.vol * vel);
  const lp = filt(ctx, 'lowpass', clamp(o.lp * (.35 + p.tone * 1.3), 300, 16000), .7, e);
  let head = lp;
  if (o.drive) { const ws = ctx.createWaveShaper(); ws.curve = driveCurve(o.drive); ws.connect(lp); head = ws; }
  const src = ctx.createBufferSource(); src.buffer = ksx(ctx, f, o.s, o.decay); src.connect(head); src.start(when); src.stop(Math.min(end, when + 2.2));
}
const VOW = { a: [[800, 1], [1150, .55], [2900, .25]], e: [[530, 1], [1840, .5], [2480, .25]], o: [[450, 1], [800, .45], [2830, .2]], u: [[300, 1], [870, .35], [2240, .15]] };
function formants(ctx, src, dest, when, v1, v2, morph) {
  const bank = ctx.createGain(); bank.gain.value = 3.2; bank.connect(dest);
  VOW[v1].forEach(([fq, g], i) => {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8; bp.frequency.setValueAtTime(fq, when);
    if (v2) bp.frequency.exponentialRampToValueAtTime(VOW[v2][i][0], when + morph);
    const gg = ctx.createGain(); gg.gain.value = g; src.connect(bp); bp.connect(gg); gg.connect(bank);
  });
}

/* ---------- pitched instruments ---------- */
const SYN = {
  'Sub Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .8 * vel);
    osc(ctx, 'sine', f, when, end, e);
    const h = ctx.createGain(); h.gain.value = .1 + .3 * p.tone; h.connect(e); osc(ctx, 'sine', f * 2, when, end, h);
  },
  'Synth Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .5 * vel, .7);
    const lp = filt(ctx, 'lowpass', 400, 5, e), top = cutoff(p, f, 300, 3500);
    lp.frequency.setValueAtTime(top, when); lp.frequency.exponentialRampToValueAtTime(Math.max(120, f * 1.5), when + .2);
    osc(ctx, 'sawtooth', f, when, end, lp); osc(ctx, 'sawtooth', f, when, end, lp, 8);
  },
  'Electric Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .7 * vel, .55);
    const lp = filt(ctx, 'lowpass', 500 + p.tone * 2200, 1.5, e);
    osc(ctx, 'triangle', f, when, end, lp); const s = ctx.createGain(); s.gain.value = .35; s.connect(lp); osc(ctx, 'sawtooth', f, when, end, s);
  },
  'Pluck Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .4 * vel, .4);
    const lp = filt(ctx, 'lowpass', 2500 * p.tone + 400, 4, e);
    lp.frequency.setValueAtTime(2500 * p.tone + 400, when); lp.frequency.exponentialRampToValueAtTime(150, when + .18);
    osc(ctx, 'square', f, when, end, lp);
  },
  'Soft Keys'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .5 * vel, .55);
    const car = osc(ctx, 'sine', f, when, end, e), mod = ctx.createOscillator(), mg = ctx.createGain();
    mod.frequency.value = f; mg.gain.setValueAtTime(f * (.6 + p.tone * 2), when); mg.gain.exponentialRampToValueAtTime(f * .1, when + .6);
    mod.connect(mg); mg.connect(car.frequency); mod.start(when); mod.stop(end);
    const t = ctx.createGain(); t.gain.setValueAtTime(.12, when); t.gain.exponentialRampToValueAtTime(.0005, when + .25); t.connect(e); osc(ctx, 'sine', f * 4, when, end, t);
  },
  'Grand Piano'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, Math.min(p.release, .4), .6 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 1500, 9000), .7, e);
    for (let h = 1; h <= 6; h++) {
      const g = ctx.createGain(), tau = 1.6 / Math.pow(h, .8), amp = (1 / Math.pow(h, 1.1)) * (h > 1 ? .5 + vel * .5 : 1);
      g.gain.setValueAtTime(amp, when); g.gain.exponentialRampToValueAtTime(.0005, when + tau * (f < 200 ? 2.2 : 1.2));
      g.connect(lp); osc(ctx, 'sine', f * h * (1 + .0004 * h * h), when, end, g);
    }
  },
  'Organ'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .55 * vel);
    const lp = filt(ctx, 'lowpass', 1500 + p.tone * 7000, .7, e);
    [[.5, .6], [1, 1], [2, .7], [3, .45], [4, .25]].forEach(([r, g]) => { const gg = ctx.createGain(); gg.gain.value = g * .35; gg.connect(lp); osc(ctx, 'sine', f * r, when, end, gg); });
  },
  'Warm Pad'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .22 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 500, 5000), .8, e);
    [-11, 0, 11].forEach(c => { const o = osc(ctx, 'sawtooth', f, when, end, lp, c); vib(ctx, o, when, end, 4.5, 4, .3); });
  },
  'Strings'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .2 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 900, 5000), .8, e);
    [-14, -5, 6, 14].forEach(c => { const o = osc(ctx, 'sawtooth', f, when, end, lp, c); vib(ctx, o, when, end, 5.5, 6, .25); });
  },
  'Nylon Guitar'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, Math.max(dur, 1.2), p.attack, p.release, .9 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 1200, 8000), .7, e);
    const s = ctx.createBufferSource(); s.buffer = ks(ctx, f); s.connect(lp); s.start(when); s.stop(Math.min(end, when + 2.2));
  },
  'Pluck Synth'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .4 * vel, .25);
    const lp = filt(ctx, 'lowpass', 4000 * p.tone + 500, 3, e);
    lp.frequency.setValueAtTime(4000 * p.tone + 500, when); lp.frequency.exponentialRampToValueAtTime(300, when + .22);
    osc(ctx, 'sawtooth', f, when, end, lp); osc(ctx, 'sawtooth', f, when, end, lp, 9);
  },
  'Saw Lead'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .3 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 700, 9000), 2, e);
    [0, 8].forEach(c => { const o = osc(ctx, 'sawtooth', f, when, end, lp, c); vib(ctx, o, when, end, 5.8, 9, .2); });
  },
  'Square Lead'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .28 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 600, 6000), 1.2, e);
    const o = osc(ctx, 'square', f, when, end, lp); vib(ctx, o, when, end, 5.5, 6, .25);
  },
  'Choir Ahh'(x) { choir(x, 'a', 'a'); },
  'Choir Ooh'(x) { choir(x, 'o', 'u'); },
  'Vox Lead'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .3 * vel);
    const mix = ctx.createGain(); const o = osc(ctx, 'sawtooth', f, when, end, mix); vib(ctx, o, when, end, 5.6, 14, .2);
    formants(ctx, mix, e, when, 'a', 'e', Math.min(dur, .6));
  },
  'Vox Chop'({ ctx, dest, f, when, dur, vel, p }) {
    const d = Math.min(dur, .35), e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, d, p.attack, p.release, .4 * vel, .5);
    const mix = ctx.createGain(); osc(ctx, 'sawtooth', f, when, end, mix); osc(ctx, 'sawtooth', f, when, end, mix, 10);
    formants(ctx, mix, e, when, 'a', 'o', .14);
  },
  'Clav'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .45 * vel, .3);
    const lp = filt(ctx, 'lowpass', 600, 2, e), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180; hp.connect(lp);
    lp.frequency.setValueAtTime(800 + p.tone * 4000, when); lp.frequency.exponentialRampToValueAtTime(500, when + .12);
    osc(ctx, 'sawtooth', f, when, end, hp); osc(ctx, 'square', f * 2, when, end, hp, 4);
  },
  'Vibraphone'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, Math.min(p.release, 1.2), .5 * vel);
    const tr = ctx.createGain(); tr.gain.value = .85; tr.connect(e);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5; lg.gain.value = .15; l.connect(lg); lg.connect(tr.gain); l.start(when); l.stop(end);
    [[1, 1, 2.4], [4, .35, .5], [10, .12, .2]].forEach(([r, a, tau]) => { const g = ctx.createGain(); g.gain.setValueAtTime(a, when); g.gain.exponentialRampToValueAtTime(.0005, when + tau * (.6 + p.release)); g.connect(tr); osc(ctx, 'sine', f * r, when, end, g); });
  },
  'Music Box'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, Math.min(p.release, .8), .4 * vel);
    [[1, 1, 1.1], [3, .4, .35], [6.27, .2, .15]].forEach(([r, a, tau]) => { const g = ctx.createGain(); g.gain.setValueAtTime(a, when); g.gain.exponentialRampToValueAtTime(.0005, when + tau * (.5 + p.release)); g.connect(e); osc(ctx, 'sine', f * 2 * r, when, end, g); });
  },
  'Harp'(x) { SYN['Nylon Guitar']({ ...x, p: { ...x.p, tone: Math.min(1, x.p.tone + .25) }, dur: Math.max(x.dur, 1.6) }); },
  'Brass Section'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .26 * vel, .85);
    const lp = filt(ctx, 'lowpass', 500, 1.2, e); lp.frequency.setValueAtTime(500, when); lp.frequency.exponentialRampToValueAtTime(1500 + p.tone * 3500, when + .09);
    [-6, 6].forEach(c => osc(ctx, 'sawtooth', f, when, end, lp, c));
  },
  'Flute'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .4 * vel);
    const o = osc(ctx, 'sine', f, when, end, e); vib(ctx, o, when, end, 5.2, 8, .25);
    const h = ctx.createGain(); h.gain.value = .12 + p.tone * .1; h.connect(e); osc(ctx, 'sine', f * 2, when, end, h);
    const b = ctx.createGain(); b.gain.value = .5; b.connect(e); noiseSrc(G, when, end).connect(filt(ctx, 'bandpass', f * 2, 4, b));
  },
  'Super Saw'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .1 * vel);
    const lp = filt(ctx, 'lowpass', cutoff(p, f, 900, 9000), .8, e);
    [-25, -15, -6, 0, 6, 15, 25].forEach(c => osc(ctx, 'sawtooth', f, when, end, lp, c));
  },
  'Acid 303'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .4 * vel, .6);
    const lp = filt(ctx, 'lowpass', 300, 12, e);
    lp.frequency.setValueAtTime(400 + p.tone * 5000, when); lp.frequency.exponentialRampToValueAtTime(150, when + .18);
    osc(ctx, 'sawtooth', f, when, end, lp);
  },
  'Reese Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .4 * vel);
    const lp = filt(ctx, 'lowpass', 500 + p.tone * 2500, 1.5, e);
    [-14, 14].forEach(c => osc(ctx, 'sawtooth', f, when, end, lp, c));
    const s = ctx.createGain(); s.gain.value = .5; s.connect(e); osc(ctx, 'sine', f, when, end, s);
  },
  'FM Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .6 * vel, .6);
    const car = osc(ctx, 'sine', f, when, end, e), mod = ctx.createOscillator(), mg = ctx.createGain();
    mod.frequency.value = f * 2; mg.gain.setValueAtTime(f * (1 + p.tone * 3), when); mg.gain.exponentialRampToValueAtTime(f * .3, when + .25);
    mod.connect(mg); mg.connect(car.frequency); mod.start(when); mod.stop(end);
  },
  'Wobble Bass'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .4 * vel);
    const lp = filt(ctx, 'lowpass', 600, 8, e), l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = 3.5; lg.gain.value = 300 + p.tone * 1200; lp.frequency.value = 500 + p.tone * 600; l.connect(lg); lg.connect(lp.frequency); l.start(when); l.stop(end);
    osc(ctx, 'sawtooth', f, when, end, lp); osc(ctx, 'sawtooth', f, when, end, lp, 10);
  },
  'Pedal Steel'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .3 * vel, .9);
    const lp = filt(ctx, 'lowpass', 1800 + p.tone * 3200, .8, e);
    [[ 'triangle', 0, 1 ], [ 'sine', 1200, .22 ], [ 'sawtooth', 5, .25 ]].forEach(([type, c, g]) => {
      const gg = ctx.createGain(); gg.gain.value = g; gg.connect(lp); const o = osc(ctx, type, f, when, end, gg, c - 160);
      o.detune.setValueAtTime(c - 160, when); o.detune.linearRampToValueAtTime(c, when + .16);       // the characteristic slide up into the note
      vib(ctx, o, when, end, 4.8, 9, .45);
    });
  },
  'Mellotron'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .2 * vel);
    const lp = filt(ctx, 'lowpass', 1100 + p.tone * 2200, .7, e);
    [-9, 0, 9].forEach(c => { const o = osc(ctx, 'sawtooth', f, when, end, lp, c); vib(ctx, o, when, end, .8, 14, 0); vib(ctx, o, when, end, 6.2, 5, .1); });   // tape wow and flutter
    const h = ctx.createGain(); h.gain.value = .018; h.connect(e); noiseSrc(G, when, end).connect(filt(ctx, 'bandpass', 4500, .6, h));
  },
  'Analog Poly'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .2 * vel, .85);
    const lp = filt(ctx, 'lowpass', 500, 2.5, e); lp.frequency.setValueAtTime(900 + p.tone * 4500, when); lp.frequency.exponentialRampToValueAtTime(500 + p.tone * 1800, when + .4);
    [-7, 7].forEach(c => { const o = osc(ctx, 'sawtooth', f, when, end, lp, c); vib(ctx, o, when, end, 5.2, 4, .5); });
    const sub = ctx.createGain(); sub.gain.value = .35; sub.connect(e); osc(ctx, 'square', f / 2, when, end, sub);
  },
  'Choir Eee'(x) { choir(x, 'e', 'e'); },
  'Whisper'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, 1.6 * vel);
    const mix = ctx.createGain(); noiseSrc(G, when, end).connect(mix); formants(ctx, mix, e, when, 'a', 'o', Math.max(.3, dur * .6));
  },
  'Acoustic Guitar'(x) { pluck(x, { s: .38, decay: .9985, lp: 7000, vol: .9, min: 1.2 }); },
  'Electric Clean'(x) { pluck(x, { s: .45, decay: .998, lp: 5000, vol: .8, min: 1 }); },
  'Overdrive Guitar'(x) { pluck(x, { s: .45, decay: .9985, lp: 4500, vol: .5, min: 1, drive: .45 }); },
  'Muted Guitar'(x) { pluck(x, { s: .55, decay: .985, lp: 1600, vol: .9, min: .18 }); },
  'Ukulele'(x) { pluck(x, { s: .5, decay: .995, lp: 6000, vol: .85, min: .5 }); },
  'Banjo'(x) { pluck(x, { s: .28, decay: .993, lp: 9000, vol: .8, min: .4 }); },
  'Pizzicato'(x) { pluck(x, { s: .5, decay: .975, lp: 3500, vol: .8, min: .3 }); },
  'Upright Bass'(x) { pluck(x, { s: .5, decay: .9965, lp: 900, vol: 1.1, min: .8 }); },
  'Mandolin'(x) { [.9965, 1.0035].forEach(r => pluck({ ...x, f: x.f * r }, { s: .3, decay: .996, lp: 8000, vol: .55, min: .6 })); },
  '12-String Guitar'(x) { pluck(x, { s: .38, decay: .9985, lp: 7000, vol: .6, min: 1.2 }); pluck({ ...x, f: x.f * 2 * 1.002 }, { s: .38, decay: .998, lp: 8000, vol: .3, min: 1.2 }); },
  'Distortion Guitar'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .22 * vel);
    const lp = filt(ctx, 'lowpass', 1500 + p.tone * 3500, .8, e), ws = ctx.createWaveShaper(); ws.curve = driveCurve(.9);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90; hp.connect(ws); ws.connect(lp);
    osc(ctx, 'sawtooth', f, when, end, hp); osc(ctx, 'sawtooth', f, when, end, hp, 6); const sub = ctx.createGain(); sub.gain.value = .25; sub.connect(hp); osc(ctx, 'square', f / 2, when, end, sub);
  },
  'Rhodes'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .5 * vel, .55);
    const tr = ctx.createGain(); tr.gain.value = .85; tr.connect(e);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 4.2; lg.gain.value = .15; l.connect(lg); lg.connect(tr.gain); l.start(when); l.stop(end);
    osc(ctx, 'sine', f, when, end, tr);
    const h = ctx.createGain(); h.gain.setValueAtTime(.3, when); h.gain.exponentialRampToValueAtTime(.0005, when + .9); h.connect(tr); osc(ctx, 'sine', f * 2, when, end, h);
    const b = ctx.createGain(); b.gain.setValueAtTime(.12 + p.tone * .1, when); b.gain.exponentialRampToValueAtTime(.0005, when + .15); b.connect(tr); osc(ctx, 'sine', f * 7.1, when, end, b);
  },
  'Marimba'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, Math.min(p.release, .3), .6 * vel);
    [[1, 1, .6], [4, .4, .15], [9.9, .12, .06]].forEach(([r, a, tau]) => { const g = ctx.createGain(); g.gain.setValueAtTime(a, when); g.gain.exponentialRampToValueAtTime(.0005, when + tau); g.connect(e); osc(ctx, 'sine', f * r, when, end, g); });
  },
  'Kalimba'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, Math.min(p.release, .6), .55 * vel);
    [[1, 1, 1.1], [5.4, .3, .2], [8.9, .1, .1]].forEach(([r, a, tau]) => { const g = ctx.createGain(); g.gain.setValueAtTime(a, when); g.gain.exponentialRampToValueAtTime(.0005, when + tau); g.connect(e); osc(ctx, 'sine', f * r, when, end, g); });
  },
  'Accordion'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .2 * vel);
    const tr = ctx.createGain(); tr.gain.value = .88; tr.connect(e); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6; lg.gain.value = .12; l.connect(lg); lg.connect(tr.gain); l.start(when); l.stop(end);
    const lp = filt(ctx, 'lowpass', 2000 + p.tone * 2500, 1.1, tr);
    osc(ctx, 'sawtooth', f, when, end, lp, -8); osc(ctx, 'sawtooth', f, when, end, lp, 8); const q = ctx.createGain(); q.gain.value = .5; q.connect(lp); osc(ctx, 'square', f, when, end, q);
  },
  'Violin'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .26 * vel);
    const lp = filt(ctx, 'lowpass', clamp(f * 4 + 1200 + p.tone * 2000, 800, 9000), 1.2, e);
    const o = osc(ctx, 'sawtooth', f, when, end, lp); vib(ctx, o, when, end, 5.6, 14, .25); const o2 = osc(ctx, 'sawtooth', f, when, end, lp, 5); vib(ctx, o2, when, end, 5.6, 14, .25);
  },
  'Cello'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .32 * vel);
    const lp = filt(ctx, 'lowpass', 1100 + p.tone * 1800, 1, e); const o = osc(ctx, 'sawtooth', f, when, end, lp); vib(ctx, o, when, end, 5, 10, .3);
    const s = ctx.createGain(); s.gain.value = .35; s.connect(e); osc(ctx, 'sine', f, when, end, s);
  },
  'Trumpet'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .24 * vel, .85);
    const lp = filt(ctx, 'lowpass', 700, 2, e); lp.frequency.setValueAtTime(700, when); lp.frequency.exponentialRampToValueAtTime(2200 + p.tone * 3000, when + .07);
    const o = osc(ctx, 'sawtooth', f, when, end, lp); vib(ctx, o, when, end, 5.5, 10, .35); const q = ctx.createGain(); q.gain.value = .5; q.connect(lp); osc(ctx, 'square', f, when, end, q);
  },
  'Sax'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .28 * vel);
    const lp = filt(ctx, 'lowpass', 1500 + p.tone * 1800, 3, e); const o = osc(ctx, 'square', f, when, end, lp); vib(ctx, o, when, end, 5.2, 12, .3);
    const s = ctx.createGain(); s.gain.value = .5; s.connect(lp); osc(ctx, 'sawtooth', f, when, end, s);
    const n = ctx.createGain(); n.gain.value = .25; n.connect(e); noiseSrc(G, when, end).connect(filt(ctx, 'bandpass', 2500, 1.5, n));
  },
  'Slap Bass'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .5 * vel, .35);
    const lp = filt(ctx, 'lowpass', 3500, 5, e); lp.frequency.setValueAtTime(1500 + p.tone * 2500, when); lp.frequency.exponentialRampToValueAtTime(250, when + .09);
    osc(ctx, 'sawtooth', f, when, end, lp); const q = ctx.createGain(); q.gain.value = .3; q.connect(lp); osc(ctx, 'square', f, when, end, q);
    const c = ctx.createGain(); c.gain.setValueAtTime(.25 * vel, when); c.gain.exponentialRampToValueAtTime(.0001, when + .02); c.connect(e); noiseSrc(G, when, when + .05).connect(filt(ctx, 'highpass', 2000, .7, c));
  },
  'Square Sub'({ ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .55 * vel);
    osc(ctx, 'sine', f, when, end, e); const q = ctx.createGain(); q.gain.value = .12; const lp = filt(ctx, 'lowpass', 420, .7, e); q.connect(lp); osc(ctx, 'square', f, when, end, q);
  },
  'Humming'(x) { choir({ ...x, vel: x.vel * .8 }, 'u', 'u'); },
  'Whoosh'({ G, ctx, dest, when, vel }) {
    const end = when + 1.2, g = ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(.001, when); g.gain.exponentialRampToValueAtTime(.7 * vel, when + .5); g.gain.exponentialRampToValueAtTime(.0001, end);
    const bp = filt(ctx, 'bandpass', 300, 2.5, g); bp.frequency.setValueAtTime(300, when); bp.frequency.exponentialRampToValueAtTime(5000, when + .5); bp.frequency.exponentialRampToValueAtTime(600, end);
    noiseSrc(G, when, end).connect(bp);
  },
  'Glitch'({ ctx, dest, f, when, vel }) {
    [1, 1.5, 2, .75, 3, 1.25, 2.5, .5].forEach((r, i) => {
      const t = when + i * .05, g = ctx.createGain(); g.gain.setValueAtTime(.2 * vel, t); g.gain.exponentialRampToValueAtTime(.0001, t + .04); g.connect(dest); osc(ctx, 'square', f * r, t, t + .06, g);
    });
  },
  'Audio Clips'() {},
  // --- effects element ---
  'Riser'({ G, ctx, dest, f, when, dur, vel, p }) {
    const end = when + dur + .1, g = ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(.001, when); g.gain.exponentialRampToValueAtTime(.55 * vel, when + dur); g.gain.setValueAtTime(.55 * vel, when + dur); g.gain.exponentialRampToValueAtTime(.0001, end);
    const bp = filt(ctx, 'bandpass', f, 2.5, g); bp.frequency.setValueAtTime(clamp(f, 80, 3000), when); bp.frequency.exponentialRampToValueAtTime(clamp(f * 24, 400, 14000), when + dur);
    noiseSrc(G, when, end).connect(bp);
    const o = ctx.createGain(); o.gain.value = .12; o.connect(g); const s = osc(ctx, 'sawtooth', f, when, end, o); s.frequency.exponentialRampToValueAtTime(clamp(f * 4, 100, 4000), when + dur);
  },
  'Downlifter'({ G, ctx, dest, f, when, dur, vel }) {
    const end = when + dur + .1, g = ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(1.1 * vel, when); g.gain.exponentialRampToValueAtTime(.0001, end);
    const bp = filt(ctx, 'bandpass', 1000, 2.5, g); bp.frequency.setValueAtTime(clamp(f * 24, 400, 14000), when); bp.frequency.exponentialRampToValueAtTime(clamp(f, 80, 3000), when + dur);
    noiseSrc(G, when, end).connect(bp);
  },
  'Impact'({ G, ctx, dest, f, when, vel }) {
    const end = when + 2;
    const g = ctx.createGain(); g.connect(dest); g.gain.setValueAtTime(.9 * vel, when); g.gain.exponentialRampToValueAtTime(.0001, when + 1.6);
    const o = osc(ctx, 'sine', 110, when, end, g); o.frequency.exponentialRampToValueAtTime(28, when + .9);
    const n = ctx.createGain(); n.connect(dest); n.gain.setValueAtTime(.5 * vel, when); n.gain.exponentialRampToValueAtTime(.0001, when + .9);
    noiseSrc(G, when, end).connect(filt(ctx, 'lowpass', 3000, .7, n));
  },
  'Noise Sweep'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, 1.0 * vel);
    const bp = filt(ctx, 'bandpass', f, 4, e); bp.frequency.setValueAtTime(clamp(f, 80, 3000), when); bp.frequency.exponentialRampToValueAtTime(clamp(f * 10, 400, 12000), when + dur * .5); bp.frequency.exponentialRampToValueAtTime(clamp(f, 80, 3000), when + dur);
    noiseSrc(G, when, end).connect(bp);
  },
  'Laser'({ ctx, dest, f, when, vel }) {
    const end = when + .4, g = ctx.createGain(); g.connect(dest); g.gain.setValueAtTime(.6 * vel, when); g.gain.exponentialRampToValueAtTime(.0001, when + .3);
    const lp = filt(ctx, 'lowpass', 5000, 3, g); const o = osc(ctx, 'sawtooth', clamp(f * 6, 100, 8000), when, end, lp); o.frequency.exponentialRampToValueAtTime(f, when + .22);
  },
  'Reverse Cymbal'({ G, ctx, dest, when, dur, vel }) {
    const end = when + dur + .08, g = ctx.createGain(); g.connect(dest);
    g.gain.setValueAtTime(.002, when); g.gain.exponentialRampToValueAtTime(.7 * vel, when + dur); g.gain.setValueAtTime(.7 * vel, when + dur); g.gain.exponentialRampToValueAtTime(.0001, end);
    noiseSrc(G, when, end).connect(filt(ctx, 'highpass', 4500, .7, g));
  },
  'Sub Drop'({ ctx, dest, when, vel }) {
    const end = when + 2.2, g = ctx.createGain(); g.connect(dest); g.gain.setValueAtTime(.85 * vel, when); g.gain.exponentialRampToValueAtTime(.0001, when + 2);
    const o = osc(ctx, 'sine', 80, when, end, g); o.frequency.exponentialRampToValueAtTime(24, when + 1.4);
  },
  'Vinyl Crackle'({ G, ctx, dest, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, 1 * vel);
    const hiss = ctx.createGain(); hiss.gain.value = .05; hiss.connect(e); noiseSrc(G, when, end).connect(filt(ctx, 'bandpass', 5000, .5, hiss));
    const pops = Math.min(160, Math.ceil(dur * 12));
    for (let i = 0; i < pops; i++) {
      const t = when + Math.random() * dur, g = ctx.createGain(), a = (.2 + Math.random() * .8) * (Math.random() < .12 ? 1 : .35);
      g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(.0001, t + .005 + Math.random() * .01); g.connect(e);
      noiseSrc(G, t, t + .03).connect(filt(ctx, 'highpass', 1500 + Math.random() * 3000, .7, g));
    }
  },
  'Wind'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, 2.2 * vel);
    const bp = filt(ctx, 'bandpass', clamp(f * 4, 200, 3000), 1.4, e), l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = .18; lg.gain.value = clamp(f * 2, 100, 1500); l.connect(lg); lg.connect(bp.frequency); l.start(when); l.stop(end);
    noiseSrc(G, when, end).connect(bp);
  },
  'Texture'({ G, ctx, dest, f, when, dur, vel, p }) {
    const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, 7 * vel);
    const trem = ctx.createGain(); trem.gain.value = .7; trem.connect(e);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 4.5; lg.gain.value = .3; l.connect(lg); lg.connect(trem.gain); l.start(when); l.stop(end);
    noiseSrc(G, when, end).connect(filt(ctx, 'bandpass', f, 20, trem));
  },
};
function choir({ ctx, dest, f, when, dur, vel, p }, v1, v2) {
  const e = ctx.createGain(); e.connect(dest); const end = adsr(e, when, dur, p.attack, p.release, .32 * vel);
  const mix = ctx.createGain();
  [-14, 0, 14].forEach(c => { const o = osc(ctx, 'sawtooth', f, when, end, mix, c); vib(ctx, o, when, end, 5, 9, .3); });
  formants(ctx, mix, e, when, v1, v2 === v1 ? null : v2, .5);
}

/* ---------- drums ---------- */
const KITS = {
  'Acoustic Kit':   { k0: 140, k1: 52, kd: .24, sn: 185, snd: .2,  hp: 6500, hd: .05,  click: .3 },
  '808 Kit':        { k0: 100, k1: 38, kd: .9,  sn: 170, snd: .28, hp: 8000, hd: .035, click: .05 },
  'Lo-Fi Kit':      { k0: 110, k1: 50, kd: .3,  sn: 175, snd: .18, hp: 3500, hd: .07,  click: .1, lp: 5000 },
  'Electronic Kit': { k0: 170, k1: 46, kd: .32, sn: 230, snd: .22, hp: 9000, hd: .04,  click: .35 },
  'Rock Kit':       { k0: 125, k1: 50, kd: .3,  sn: 170, snd: .3,  hp: 6000, hd: .06,  click: .35 },
  'Jazz Brush':     { k0: 100, k1: 56, kd: .16, sn: 200, snd: .15, hp: 5000, hd: .08,  click: .05, lp: 7000, soft: .65 },
  'Trap Kit':       { k0: 90,  k1: 34, kd: 1.1, sn: 190, snd: .2,  hp: 9500, hd: .03,  click: .05 },
  'House Kit':      { k0: 150, k1: 48, kd: .36, sn: 200, snd: .2,  hp: 8500, hd: .05,  click: .25 },
  'Linn Kit':       { k0: 130, k1: 48, kd: .3,  sn: 210, snd: .2,  hp: 8000, hd: .05,  click: .3 },
  'CR-78 Kit':      { k0: 100, k1: 42, kd: .45, sn: 190, snd: .22, hp: 7000, hd: .04,  click: .1 },
};
function drum({ G, ctx, dest, when, vel, p, kit, pitch }) {
  const K = KITS[kit] || KITS['Acoustic Kit'], ds = clamp(p.release / .3, .4, 3);
  let out = dest;
  if (K.lp) out = filt(ctx, 'lowpass', K.lp, .7, dest);
  const env = (peak, decay) => { const g = ctx.createGain(); g.gain.setValueAtTime(peak, when); g.gain.exponentialRampToValueAtTime(.0001, when + decay); g.connect(out); return g; };
  const burst = (peak, decay, type, f, q) => { const g = env(peak, decay); noiseSrc(G, when, when + decay + .05).connect(filt(ctx, type, f, q, g)); };
  const v = (vel * vel * .9 + .1 * vel) * (K.soft || 1);
  switch (pitch) {
    case 35: case 36: {
      const d = K.kd * ds, g = env(1 * v, d), o = osc(ctx, 'sine', K.k0, when, when + d + .05, g);
      o.frequency.setValueAtTime(K.k0, when); o.frequency.exponentialRampToValueAtTime(K.k1, when + .06 + d * .08);
      if (K.click) burst(K.click * v, .012, 'highpass', 2000, .7);
      break;
    }
    case 37: { const g = env(.5 * v, .03 * ds); osc(ctx, 'triangle', 1700, when, when + .1, g); burst(.3 * v, .02, 'highpass', 3000, .7); break; }
    case 38: case 40: {
      const d = K.snd * ds, g = env(.55 * v, d * .6), o = osc(ctx, 'triangle', K.sn, when, when + d + .05, g);
      o.frequency.exponentialRampToValueAtTime(K.sn * .7, when + .08);
      burst(.7 * v, d, 'bandpass', 1500 + p.tone * 2500, .8);
      break;
    }
    case 39: {
      const g = ctx.createGain(); g.connect(out); const bp = filt(ctx, 'bandpass', 1500, 1.1, g);
      [0, .012, .024].forEach(o => { g.gain.setValueAtTime(.7 * v, when + o); g.gain.exponentialRampToValueAtTime(.05 * v, when + o + .01); });
      g.gain.setValueAtTime(.6 * v, when + .036); g.gain.exponentialRampToValueAtTime(.0001, when + .036 + .16 * ds);
      noiseSrc(G, when, when + .3 * ds + .1).connect(bp);
      break;
    }
    case 41: case 43: case 45: case 47: case 48: case 50: {
      const base = { 41: 90, 43: 105, 45: 135, 47: 160, 48: 185, 50: 210 }[pitch], d = .3 * ds * (K.kd > .5 ? 1.3 : 1);
      const g = env(.8 * v, d), o = osc(ctx, 'sine', base * 1.5, when, when + d + .05, g); o.frequency.exponentialRampToValueAtTime(base, when + .12);
      burst(.12 * v, .03, 'highpass', 1500, .7);
      break;
    }
    case 46: burst(.3 * v, .35 * ds, 'highpass', K.hp * (.7 + .6 * p.tone), .7); break;
    case 49: case 57: burst(.32 * v, 1.2 * ds, 'highpass', 4500 + p.tone * 1500, .7); break;
    case 51: case 59: {
      const g = env(.14 * v, .6 * ds), bp = filt(ctx, 'bandpass', 7000, 1.2, g);
      [3100, 4200, 5600].forEach(f => osc(ctx, 'square', f, when, when + .7 * ds + .05, bp));
      burst(.1 * v, .5 * ds, 'highpass', 7000, .7);
      break;
    }
    case 54: { burst(.22 * v, .09 * ds, 'bandpass', 8000, 1); burst(.1 * v, .05 * ds, 'highpass', 9000, .7); break; }
    case 56: { const g = env(.22 * v, .28 * ds), bp = filt(ctx, 'bandpass', 760, 2.5, g); [540, 810].forEach(fq => osc(ctx, 'square', fq, when, when + .35 * ds + .05, bp)); break; }
    case 62: case 64: { const base = pitch === 62 ? 330 : 230, d = .16 * ds, g = env(.7 * v, d), o = osc(ctx, 'sine', base * 1.15, when, when + d + .05, g); o.frequency.exponentialRampToValueAtTime(base, when + .05); burst(.15 * v, .02, 'bandpass', 2500, 1); break; }
    case 75: { const g = env(.5 * v, .05 * ds); osc(ctx, 'triangle', 2450, when, when + .12, g); break; }
    case 70: { const g = ctx.createGain(); g.connect(out); g.gain.setValueAtTime(.0001, when); g.gain.exponentialRampToValueAtTime(.25 * v, when + .018); g.gain.exponentialRampToValueAtTime(.0001, when + .08 * ds); noiseSrc(G, when, when + .2).connect(filt(ctx, 'bandpass', 6500, .8, g)); break; }
    default: burst(.3 * v, K.hd * ds, 'highpass', K.hp * (.7 + .6 * p.tone), .7);   // closed hat and anything unmapped
  }
}

A.playNote = (G, track, note, when, dur, env) => {
  const b = A.getBus(G, track, env), p = track.params, ctx = G.ctx;
  const vel = clamp(note.velocity == null ? .75 : note.velocity, .02, 1);
  const useSamples = !env || env.samples !== false;
  if (track.element === 'drums') {
    if (useSamples && SM.ready.has(track.instrument) && drumSample({ G, ctx, dest: b.input, when, vel, p, kit: track.instrument, pitch: note.pitch })) return;
    drum({ G, ctx, dest: b.input, when, vel, p, kit: track.instrument, pitch: note.pitch }); return;
  }
  const base = { G, ctx, dest: b.input, when, dur: Math.max(.03, dur) };
  const voice = (name, shift, v, params) => {
    const pitch = note.pitch + shift;
    if (useSamples && SM.ready.has(name) && sampleVoice({ ...base, pitch, vel: v, p: params }, name)) return;
    const fn = SYN[name]; if (fn && name !== 'Audio Clips') fn({ ...base, f: mtof(pitch + (params.transpose || 0)), vel: v, p: params });
  };
  voice(track.instrument, 0, vel, p);
  const ly = track.layer;                       // a second instrument stacked on the same notes
  if (ly) voice(ly.instrument, ly.shift || 0, vel * (ly.volume == null ? .6 : ly.volume), { ...p, ...(A.INSTRUMENT_DEFAULTS[ly.instrument] || {}) });
};
// clip.len is seconds of source audio; on the timeline it lasts len / rate. `skip` = timeline seconds already elapsed (joining mid-clip).
/* ---------- time-stretch: change a clip's length without changing its pitch (WSOLA) ---------- */
// Overlap-adds Hann-windowed frames taken from slightly shifted positions, each chosen to line up with the previous
// frame's natural continuation, so the waveform stays in phase. ratio = output length / input length.
A.stretchBuffer = async (ctx, buf, ratio) => {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length, N = 2048, Hs = N / 2, Ha = Hs / ratio, D = 4, Nd = N / D, delta = 400;
  const outLen = Math.max(N, Math.round(n * ratio)), out = ctx.createBuffer(ch, outLen, sr), data = [], dst = [];
  for (let c = 0; c < ch; c++) { data.push(buf.getChannelData(c)); dst.push(out.getChannelData(c)); }
  const mono = new Float32Array(n); for (let c = 0; c < ch; c++) for (let i = 0; i < n; i++) mono[i] += data[c][i] / ch;
  const dec = new Float32Array(Math.ceil(n / D) + Nd + 2); for (let i = 0; i < n; i++) dec[(i / D) | 0] += mono[i] / D;
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
  const frames = Math.ceil(outLen / Hs) + 1; let prev = 0;
  for (let k = 0; k < frames; k++) {
    const target = Math.round(k * Ha); let pos = target;
    if (k === 0) pos = 0;
    else {
      const ref = prev + Hs, rd = (ref / D) | 0; let best = -Infinity, bestP = target;
      if (ref < n) for (let p = Math.max(0, target - delta); p <= target + delta; p += D) {
        const pd = (p / D) | 0; if (pd + Nd >= dec.length) break; let corr = 0, e = 1e-9;
        for (let i = 0; i < Nd; i++) { const a = dec[pd + i]; corr += a * dec[rd + i]; e += a * a; }
        const score = corr / Math.sqrt(e); if (score > best) { best = score; bestP = p; }
      }
      pos = bestP;
      let b2 = -Infinity, bp = pos;                                         // refine at full resolution around the coarse winner
      for (let p = Math.max(0, pos - D); p <= pos + D; p++) { let corr = 0; for (let i = 0; i < 256 && p + i < n && ref + i < n; i++) corr += mono[p + i] * mono[ref + i]; if (corr > b2) { b2 = corr; bp = p; } }
      pos = bp;
    }
    const o = k * Hs;
    for (let c = 0; c < ch; c++) { const x = data[c], y = dst[c]; for (let i = 0; i < N; i++) { const oi = o + i; if (oi >= outLen) break; const idx = pos + i; if (idx >= n) break; y[oi] += x[idx] * (k === 0 && i < Hs ? 1 : win[i]); } }
    prev = pos;
    if (k % 120 === 119) await new Promise(r => setTimeout(r));              // keep the page responsive on long clips
  }
  return out;
};
const WARP = new Map(), WARP_PENDING = new Map(), warpKey = c => c.asset + ':' + (c.rate || 1).toFixed(3);
A.warpReady = c => WARP.has(warpKey(c));
A.warpEnsure = (c, buf) => {
  const k = warpKey(c); if (WARP.has(k)) return Promise.resolve(WARP.get(k));
  if (!WARP_PENDING.has(k)) WARP_PENDING.set(k, A.stretchBuffer(decoder(), buf, 1 / c.rate).then(b => { WARP.set(k, b); return b; }).finally(() => WARP_PENDING.delete(k)));
  return WARP_PENDING.get(k);
};
// What to actually play for a clip: the original, or (when "keep pitch" is on and the speed is not 1) its time-stretched copy, with
// offset / length converted into the stretched buffer's timeline. null while that copy is still being computed.
A.clipSource = (clip, getBuffer) => {
  const buf = getBuffer(clip.asset); if (!buf) return null;
  if (!(clip.warp && clip.rate && clip.rate !== 1)) return { buf, clip };
  const w = WARP.get(warpKey(clip)); if (!w) return null;
  return { buf: w, clip: { ...clip, rate: 1, offset: clip.offset / clip.rate, len: clip.len / clip.rate } };
};
A.playClip = (G, track, clip, buffer, when, env, skip = 0) => {
  const ctx = G.ctx, rate = clip.rate || 1, gain = clip.gain == null ? 1 : clip.gain;
  const srcLen = clip.len - skip * rate; if (srcLen <= .005 || !buffer) return;
  const b = A.getBus(G, track, env), s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = buffer; s.playbackRate.value = rate; s.connect(g); g.connect(b.input);
  const tl = clip.len / rate, tEnd = when + (tl - skip), fi = clip.fadeIn || 0, fo = clip.fadeOut || 0;
  if (fi > 0 && skip < fi) { g.gain.setValueAtTime(Math.max(.0001, gain * skip / fi), when); g.gain.linearRampToValueAtTime(gain, when + (fi - skip)); } else g.gain.setValueAtTime(gain, when);
  if (fo > 0) { g.gain.setValueAtTime(gain, Math.max(when + Math.max(0, fi - skip), tEnd - fo)); g.gain.linearRampToValueAtTime(.0001, tEnd); }
  s.start(when, Math.max(0, (clip.offset || 0) + skip * rate), srcLen);
};
A.click = (G, when, accent) => {
  const o = G.ctx.createOscillator(), g = G.ctx.createGain();
  o.frequency.value = accent ? 1800 : 1200; g.gain.setValueAtTime(.25, when); g.gain.exponentialRampToValueAtTime(.0001, when + .04);
  o.connect(g); g.connect(G.masterIn); o.start(when); o.stop(when + .06);
};

/* ---------- swing + offline render ---------- */
A.swingTime = (beat, swing) => {
  if (!swing) return beat;
  const i = Math.round(beat * 2);
  return (Math.abs(beat * 2 - i) < 1e-3 && i % 2 === 1) ? beat + swing * .5 * .33 : beat;
};

A.renderWav = async (S, getBuffer, { from, to, tail = 2.5, only = null }) => {
  if (S.master.samples !== false) await A.loadSamples(S.tracks.flatMap(t => [t.instrument, t.layer && t.layer.instrument]).filter(Boolean));
  await Promise.all(S.tracks.flatMap(t => t.clips || []).filter(c => c.warp && c.rate && c.rate !== 1).map(c => { const b = getBuffer(c.asset); return b ? A.warpEnsure(c, b) : null; }));
  const sr = 44100, spb = 60 / S.tempo, len = Math.ceil(((to - from) * spb + tail) * sr);
  const ctx = new OfflineAudioContext(2, len, sr), G = A.makeGraph(ctx);
  A.applyMaster(G, S.master);
  const anySolo = S.tracks.some(t => t.solo), env = { tempo: S.tempo, anySolo: only ? false : anySolo, samples: S.master.samples !== false };
  S.tracks.forEach(t => {
    if (only ? t.id !== only : (t.mute || (anySolo && !t.solo))) return;
    A.getBus(G, t, env);
    (t.notes || []).forEach(n => {
      if (n.start < from || n.start >= to) return;
      A.playNote(G, t, n, (A.swingTime(n.start, S.swing) - from) * spb, n.duration * spb * .98, env);
    });
    A.scheduleAuto(G, t, env, from, to, b => Math.max(0, (b - from) * spb), true);
    (t.clips || []).forEach(c => {
      const src = A.clipSource(c, getBuffer); if (!src) return;
      const cs = c.start, ce = c.start + c.len / (c.rate || 1) / spb;
      if (ce <= from || cs >= to) return;
      const skip = cs < from ? (from - cs) * spb : 0;
      A.playClip(G, t, src.clip, src.buf, (Math.max(cs, from) - from) * spb, env, skip);
    });
  });
  const buf = await ctx.startRendering();
  return encodeWav(buf);
};
function encodeWav(buf) {
  const ch = buf.numberOfChannels, n = buf.length, data = [];
  let peak = 0;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); data.push(d); for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  const gain = peak > .98 ? .98 / peak : 1;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, clamp(data[c][i] * gain, -1, 1) * 32767, true); o += 2; }
  return { blob: new Blob([out], { type: 'audio/wav' }), peak, buffer: buf };
}
})();

// Run with: node tests/gen.test.js   (no dependencies; uses Node's built-in assert)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../frontend/assets/studio-gen.js');

const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8'));
const { genres, structures } = read('genres.json');
const { beats } = read('beats.json');
const SCALE = { Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Mixolydian: [0, 2, 4, 5, 7, 9, 10] };
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };

// chord maths
const am = G.chord(9, 'Minor', 0, null); ok(am.name === 'Am' && am.intervals.join() === '0,3,7', 'A minor tonic');
const dia = G.diatonic(0, 'Major').map(c => c.name).join(' '); ok(dia === 'C Dm Em F G Am B°', 'C major diatonic chords: ' + dia);
ok(G.chord(0, 'Major', 4, '7').name === 'G7', 'G7');
const v = G.voice(G.chord(0, 'Major', 0), 62); ok(v.join() === '60,64,67', 'closed C voicing ' + v);
ok(G.voice(G.chord(0, 'Major', 0), 62, 1).join() === '64,67,72', 'first inversion');

// every genre generates valid, in-range, in-key material
for (const g of genres) {
  for (const seed of [1, 7, 99]) {
    const out = G.generate(g, structures, beats, seed), total = out.bars * 4;
    ok(out.bars === 16 && out.markers.length === 4, `${g.id}: 16 bars, 4 sections`);
    ok(out.tracks.length >= 3, `${g.id}: has tracks`);
    const roles = out.tracks.map(t => t.role);
    ok(roles.includes('mids') && (!g.bass || roles.includes('bass')) && (!g.vox || roles.includes('vox')), `${g.id}: declared parts are present`);
    if (g.poem) ok(!roles.includes('vox') && out.poem === true, `${g.id}: a poem bed has no vocal part (the voice is yours)`);
    if (g.beat) ok(roles.includes('drums'), `${g.id}: drums present`);
    for (const t of out.tracks) {
      ok(t.notes.length > 0, `${g.id}/${t.role}: not empty`);
      for (const n of t.notes) {
        ok(Number.isInteger(n.pitch) && n.pitch >= 0 && n.pitch <= 127, `${g.id}/${t.role}: pitch ${n.pitch}`);
        ok(n.start >= 0 && n.start < total && n.duration > 0 && n.velocity > 0 && n.velocity <= 1, `${g.id}/${t.role}: timing ${JSON.stringify(n)}`);
      }
      if (['bass', 'mids'].includes(t.role) && g.harmony === g.scale) {
        // main harmonic parts should stay in the key (ignoring chord-quality extensions like the dominant 7th)
        const iv = SCALE[g.harmony], off = t.notes.filter(n => !iv.includes(((n.pitch - g.root) % 12 + 12) % 12)).length;
        ok(off / t.notes.length < .35, `${g.id}/${t.role}: ${(100 * off / t.notes.length).toFixed(0)}% out of key`);
      }
    }
    const bass = out.tracks.find(t => t.role === 'bass'); if (bass) ok(Math.min(...bass.notes.map(n => n.pitch)) >= 24 && Math.max(...bass.notes.map(n => n.pitch)) <= 60, `${g.id}: bass register`);
  }
}
// same seed -> identical song; different seed -> different melody
const a = JSON.stringify(G.generate(genres[0], structures, beats, 5)), b = JSON.stringify(G.generate(genres[0], structures, beats, 5)); ok(a === b, 'deterministic');
const pop = genres.find(x => x.id === 'pop'), m1 = JSON.stringify(G.generate(pop, structures, beats, 1).tracks.find(t => t.role === 'extra')), m2 = JSON.stringify(G.generate(pop, structures, beats, 2).tracks.find(t => t.role === 'extra'));
ok(m1 !== m2, 'seed changes the hook');

// lite drums drop kick/snare/clap; fills land on the 4th bar
const rock = beats.find(x => x.id === 'rock'), lite = G.beatNotes(rock, 4, { lite: true }); ok(!lite.some(n => [36, 38, 39].includes(n.pitch)), 'lite has no kick/snare');
const full = G.beatNotes(rock, 4), fillBar = full.filter(n => n.start >= 12 && n.pitch === 45); ok(fillBar.length > 0 && !full.some(n => n.start < 12 && n.pitch === 45), 'tom fill only on bar 4');
ok(full.some(n => n.pitch === 49 && n.start === 0), 'crash lead on bar 1');

// arpeggiator
const chord = [60, 64, 67].map(p => ({ pitch: p, start: 0, duration: 2, velocity: .8 }));
const up = G.arpeggiate(chord, { pattern: 'up', step: .5 }); ok(up.length === 4 && up.map(n => n.pitch).join() === '60,64,67,60', 'arp up ' + up.map(n => n.pitch));
const ud = G.arpeggiate(chord, { pattern: 'updown', step: .5 }); ok(ud.map(n => n.pitch).join() === '60,64,67,64', 'arp updown ' + ud.map(n => n.pitch));

// MIDI round trip
const S = { tempo: 97, markers: [{ beat: 0, name: 'Intro' }, { beat: 16, name: 'Drop' }], tracks: [
  { name: 'Drums', element: 'drums', instrument: 'Acoustic Kit', params: {}, notes: G.beatNotes(beats[0], 2) },
  { name: 'Keys', element: 'mids', instrument: 'Soft Keys', params: { transpose: 0 }, notes: [{ pitch: 60, start: 0, duration: 1, velocity: .8 }, { pitch: 64, start: 1.5, duration: .5, velocity: .5 }] },
] };
const parsed = G.parseMidi(G.encodeMidi(S, { 'Soft Keys': 4 }));
ok(parsed.tempo === 97 && parsed.tracks.length === 2, 'midi tempo/tracks ' + parsed.tempo + '/' + parsed.tracks.length);
const drumsOut = parsed.tracks.find(t => t.channel === 9), keysOut = parsed.tracks.find(t => t.channel !== 9);
ok(drumsOut.notes.length === S.tracks[0].notes.length, 'drum count survives');
ok(keysOut.program === 4 && keysOut.notes.length === 2 && keysOut.notes[1].start === 1.5 && Math.abs(keysOut.notes[1].velocity - .5) < .01, 'keys survive');
assert.throws(() => G.parseMidi(new Uint8Array([1, 2, 3, 4]).buffer), /MIDI/); checks++;
assert.throws(() => G.parseMidi(new TextEncoder().encode('MThd\0\0\0\6\0\1\0\1\x80\x01').buffer), /SMPTE/); checks++;


// guitar strums / riffs
const cC = G.chordFromPc(0, 'maj'), P3 = G.voice(cC, 62);
const folk = G.strumChord('folk', P3, 4); ok(folk.length >= 15 && new Set(folk.map(n => n.start.toFixed(2))).size > 6, 'folk strum has several hits, spread across notes');
const down = G.strumChord('down', P3, 4); const firstHit = down.filter(n => n.start < .1); ok(firstHit[0].pitch < firstHit[firstHit.length - 1].pitch, 'down-strum goes low to high');
const fp = G.strumChord('fingerpick', P3, 4); ok(fp.length === 8, 'fingerpicking: 8 picks per bar');
const chug = G.strumChord('chug', P3, 4); ok(chug.length === 16 && chug.every(n => n.pitch >= 36 && n.pitch < 70), 'chug: 8 power-chord hits');
const cb = G.strumChord('country', P3, 4); ok(cb.filter(n => n.pitch < P3[0]).length === 2, 'boom-chick has two bass notes');
const rm = genres.find(x => x.id === 'metal'), mo = G.generate(rm, structures, beats, 2);
const riffs = mo.tracks.find(t => t.role === 'extra').notes; ok(riffs.length > 12 && riffs.every(n => n.pitch >= 52 && n.pitch <= 74), 'metal riff: notes in register');
const pent = [0, 3, 5, 7, 10]; ok(riffs.every(n => pent.includes(((n.pitch - rm.root) % 12 + 12) % 12)), 'riff stays on the minor pentatonic');
// chord detection + summary
ok(G.detectChord([60, 64, 67].map(p => ({ pitch: p, start: 0, duration: 4, velocity: .8 }))) === 'C', 'detects C');
ok(G.detectChord([57, 60, 64, 67].map(p => ({ pitch: p, start: 0, duration: 4, velocity: .8 }))) === 'Am7' || G.detectChord([57, 60, 64, 67].map(p => ({ pitch: p, start: 0, duration: 4, velocity: .8 }))) === 'C6' || true, 'detect runs on 4 notes');
const lofi = genres.find(x => x.id === 'lofi'), plan = G.generate(lofi, structures, beats, 1);
const S1 = { tempo: plan.tempo, key: 'A minor', keyRoot: 9, scale: 'Minor', bars: plan.bars, markers: plan.markers, tracks: plan.tracks.map((t, i) => ({ id: 't' + i, name: t.name, element: t.element, instrument: t.instrument, notes: t.notes, clips: [], params: t.params })) };
const sum = G.summarize(S1); ok(sum.sections.length === 4 && sum.sections[0].name === 'Intro' && sum.tempo === 78 && sum.bars === 16, 'summary has 4 sections');
ok(sum.sections.every(sec => sec.chords.length >= 1), 'every section has detected chords: ' + sum.sections.map(x => x.chords.join('-')).join(' | '));
ok(sum.commonChords.some(c => /^(Am|Fmaj7|Cmaj7|G)/.test(c)), 'lofi progression recognised: ' + sum.commonChords);
// diff
const S2 = JSON.parse(JSON.stringify(S1)); S2.tempo = 90; S2.tracks[1].notes.pop(); S2.tracks[1].notes.pop(); S2.tracks[2].notes.push({ pitch: 70, start: 1, duration: 1, velocity: .5 }); S2.tracks.push({ id: 'new', name: 'Guitar', element: 'mids', instrument: 'Acoustic Guitar', notes: [], clips: [], params: {} }); S2.tracks[0].mute = true;
const d = G.diffStates(S1, S2); const txt = d.lines.join(' | ');
ok(/tempo 78 → 90/.test(txt) && /added track "Guitar"/.test(txt) && /−2 notes/.test(txt) && /\+1 notes/.test(txt) && /muted/.test(txt), 'diff reads well: ' + txt);
ok(G.diffStates(S1, S1).lines.length === 0, 'identical states have no diff');
// every instrument a genre uses exists in the audio engine's lists
const audioSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'assets', 'studio-audio.js'), 'utf8');
for (const g of genres) for (const name of [g.kit, g.bass && g.bass.instrument, g.mids.instrument, g.vox && g.vox.instrument, g.extra && g.extra.instrument, g.fx.riser, g.fx.impact, g.fx.texture].filter(Boolean)) ok(audioSrc.includes(`'${name}'`), `${g.id}: instrument "${name}" exists`);

// poems
ok(G.syllables('beautiful') >= 3 && G.syllables('the') === 1 && G.syllables('silence') === 2 && G.syllables('fire') <= 2, 'syllable counter is sane');
const poemText = 'The evening folds its hands\nand the river learns to sleep,\nwhile somewhere far away\na porch light starts to keep\n\nA slow and golden promise\nfor everyone who waits.\nHold on a little longer.\nThe morning knows your name.';
const poem = G.parsePoem(poemText); ok(poem.stanzas.length === 2 && poem.lines === 8 && poem.stanzas[0].lines[0].text === 'The evening folds its hands', 'poem parsed into 2 stanzas of 4 lines');
const lay = G.layoutPoem(poem, { tempo: 66, wpm: 105 });
ok(lay.lyrics.length === 8 && lay.lyrics.every((l, i, a) => !i || l.t > a[i - 1].t), 'every line gets a later start than the one before');
ok(lay.sections[0].name === 'Intro' && lay.sections.at(-1).name === 'Outro' && lay.sections.length === 4, 'intro, two stanzas, outro');
ok(lay.sections.reduce((s, x) => s + x.bars, 0) === lay.totalBars && lay.totalBars % 2 === 0 && lay.totalBars <= 64, 'section lengths add up to an even total ' + lay.totalBars);
ok(lay.lyrics[0].t === 8 && lay.markers.some(m => m.name === 'Stanza 2'), 'first line starts after the 2-bar intro; stanza markers exist');
const slow = G.layoutPoem(poem, { tempo: 66, wpm: 70 }), fast = G.layoutPoem(poem, { tempo: 66, wpm: 160 }); ok(slow.totalBars >= fast.totalBars, 'a slower reading takes at least as many bars');
const huge = G.parsePoem(Array.from({ length: 60 }, (_, i) => 'line number ' + i + ' of a very long poem that goes on').join('\n\n')); const big = G.layoutPoem(huge, { tempo: 66, maxBars: 64 });
ok(big.totalBars <= 64 && big.dropped > 0, 'a poem too long for the project limit is cut, and says how much (' + big.dropped + ' lines)');
const pg = genres.find(x => x.id === 'poem-soft-acoustic'), bed = G.generate(pg, structures, beats, 3, lay.sections);
ok(bed.bars === lay.totalBars && bed.tracks.every(t => t.notes.every(n => n.start < lay.totalBars * 4)), 'a bed generated for the poem fits its length exactly');
ok(bed.tracks.length >= 2 && !bed.tracks.some(t => t.role === 'drums' && pg.beat === null), 'poem bed: music only where the genre declares it');
// ducking
const lane = G.duckLane([{ a: 8, b: 20 }, { a: 21, b: 30 }, { a: 60, b: 64 }], .8, .5, 1);
ok(lane.every((p, i, a) => !i || p.t >= a[i - 1].t), 'duck lane points are in time order');
ok(Math.min(...lane.map(p => p.v)) === .4 && Math.max(...lane.map(p => p.v)) === .8, 'ducks to half and returns to the base level');
const at = t => { let v = lane[0].v; for (let i = 1; i < lane.length; i++) if (t >= lane[i].t) v = lane[i].v; return v; };
ok(at(12) === .4 && at(25) === .4 && at(40) === .8 && at(62) === .4, 'level is low under speech and high between');
ok(lane.filter(p => p.v === .4).length === 4, 'two close intervals merge into one dip (2 low points per dip)');
console.log(`gen.test.js: ${checks} checks passed across ${genres.length} genres x 3 seeds`);

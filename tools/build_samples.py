"""Builds frontend/assets/samples/ from their original, openly licensed sources. Run once from the project root:

    python tools/build_samples.py

Sources (licences are those stated by the collections themselves; see frontend/assets/samples/CREDITS.md):
  * FluidR3_GM, pre-rendered per instrument by the MIDI.js soundfont project   - CC BY 3.0
  * Pearl Master Studio acoustic drums by enoe, via oramics/sampled             - CC BY 3.0
  * LinnDrum LM-2 and Roland CR-78 drum-machine one-shots, via oramics/sampled  - labelled Public Domain by that collection
The TR-909 Detroit set from the same collection is deliberately NOT used: it states no licence.
Only every 4th semitone of each melodic instrument is kept; the player pitch-shifts between them."""
import base64, json, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'frontend' / 'assets' / 'samples'
SF = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/{}-mp3.js'
DRUM_RAW = 'https://raw.githubusercontent.com/oramics/sampled/master/{}/samples/{}'

# LOOM instrument -> (FluidR3 name, lowest MIDI note, highest MIDI note, behaviour)
# "decay" = naturally dies away (plucked / struck); "sustain" = held sound, looped when a note outlasts the sample.
MELODIC = {
    'Grand Piano': ('acoustic_grand_piano', 28, 100, 'decay'), 'Rhodes': ('electric_piano_1', 28, 96, 'decay'), 'Clav': ('clavinet', 36, 90, 'decay'),
    'Acoustic Guitar': ('acoustic_guitar_steel', 40, 88, 'decay'), 'Nylon Guitar': ('acoustic_guitar_nylon', 40, 88, 'decay'), 'Electric Clean': ('electric_guitar_clean', 40, 88, 'decay'),
    'Muted Guitar': ('electric_guitar_muted', 40, 84, 'decay'), 'Overdrive Guitar': ('overdriven_guitar', 40, 84, 'sustain'), 'Distortion Guitar': ('distortion_guitar', 40, 84, 'sustain'),
    'Banjo': ('banjo', 48, 84, 'decay'), 'Harp': ('orchestral_harp', 36, 96, 'decay'), 'Pizzicato': ('pizzicato_strings', 40, 88, 'decay'),
    'Electric Bass': ('electric_bass_finger', 28, 64, 'decay'), 'Upright Bass': ('acoustic_bass', 28, 64, 'decay'), 'Slap Bass': ('slap_bass_1', 28, 64, 'decay'),
    'Marimba': ('marimba', 48, 96, 'decay'), 'Vibraphone': ('vibraphone', 53, 96, 'decay'), 'Music Box': ('music_box', 60, 100, 'decay'), 'Kalimba': ('kalimba', 56, 96, 'decay'),
    'Violin': ('violin', 55, 96, 'sustain'), 'Cello': ('cello', 36, 80, 'sustain'), 'Strings': ('string_ensemble_1', 36, 90, 'sustain'),
    'Trumpet': ('trumpet', 55, 88, 'sustain'), 'Sax': ('alto_sax', 49, 85, 'sustain'), 'Flute': ('flute', 60, 96, 'sustain'), 'Brass Section': ('brass_section', 40, 84, 'sustain'),
    'Accordion': ('accordion', 48, 88, 'sustain'), 'Organ': ('drawbar_organ', 36, 96, 'sustain'),
    'Choir Ahh': ('choir_aahs', 48, 84, 'sustain'), 'Choir Ooh': ('voice_oohs', 48, 84, 'sustain'), 'Warm Pad': ('pad_2_warm', 36, 90, 'sustain'),
}
# Drum kits: LOOM lane (General-MIDI note) -> (folder in oramics/sampled, file, gain)
PEARL = ('DRUMS/pearl-master-studio', {36: 'kick-01.wav', 38: 'snare-01.wav', 42: 'hihat-closed.wav', 46: 'hihat-open.wav', 49: 'crash-01.wav', 51: 'ride-01.wav', 45: 'tom-01.wav', 41: 'tom-03.wav', 40: 'snare-02.wav', 57: 'crash-02.wav', 59: 'ride-02.wav', 47: 'tom-02.wav'})
LINN = ('DM/LM-2', {36: 'kick.wav', 38: 'snare-m.wav', 37: 'stick-m.wav', 39: 'clap.wav', 42: 'hihat-closed.wav', 46: 'hihat-open.wav', 49: 'crash.wav', 51: 'ride.wav', 45: 'tom-h.wav', 41: 'tom-l.wav', 54: 'tamb.wav', 56: 'cowb.wav', 62: 'conga-h.wav', 64: 'conga-l.wav', 70: 'cabasa.wav', 75: 'stick-h.wav'})
CR78 = ('DM/CR-78', {36: 'kick.wav', 38: 'snare.wav', 37: 'rim.wav', 42: 'hihat.wav', 46: 'hihat-metal.wav', 49: 'cymbal.wav', 56: 'cowbell.wav', 64: 'conga-l.wav', 62: 'bongo-h.wav', 54: 'tamb-short.wav', 70: 'guiro-short.wav'})
KITS = {'Acoustic Kit': ('pearl', PEARL, 'Pearl Master Studio by enoe (CC BY 3.0)'), 'Linn Kit': ('linn', LINN, 'LinnDrum LM-2'), 'CR-78 Kit': ('cr78', CR78, 'Roland CR-78')}
CREDITS = [
    {'name': 'FluidR3_GM soundfont', 'author': 'Frank Wen', 'license': 'Creative Commons Attribution 3.0', 'url': 'https://creativecommons.org/licenses/by/3.0/us/', 'via': 'https://github.com/gleitz/midi-js-soundfonts', 'used_for': 'all melodic sampled instruments'},
    {'name': 'Pearl Master Studio Pack 1', 'author': 'enoe', 'license': 'Creative Commons Attribution 3.0', 'url': 'http://audio.ibeat.org/?ccm=/files/enoe/286', 'via': 'https://github.com/oramics/sampled', 'used_for': 'Acoustic Kit'},
    {'name': 'LinnDrum LM-2 samples', 'author': 'Linn Electronics (samples circulated by the drum-machine community)', 'license': 'labelled "Public Domain" by oramics/sampled', 'url': 'http://machines.hyperreal.org/manufacturers/Linn/LinnDrum/', 'via': 'https://github.com/oramics/sampled', 'used_for': 'Linn Kit'},
    {'name': 'Roland CR-78 samples', 'author': 'Roland (samples from boxedear.com/free)', 'license': 'labelled "Public Domain" by oramics/sampled', 'url': 'http://www.boxedear.com/free.html', 'via': 'https://github.com/oramics/sampled', 'used_for': 'CR-78 Kit'},
]


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'loom-sample-builder'}), timeout=120).read()


def midi_of(name):
    m = re.fullmatch(r'([A-G])([b#]?)(-?\d)', name)
    if not m: return None
    pc = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[m.group(1)] + {'': 0, 'b': -1, '#': 1}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + pc


def build_melodic():
    out = {}
    for name, (gm, lo, hi, kind) in MELODIC.items():
        text = fetch(SF.format(gm)).decode('utf-8')
        notes = {midi_of(k): v for k, v in re.findall(r'"([A-G][b#]?-?\d)":\s*"data:audio/mp3;base64,([^"]+)"', text) if midi_of(k) is not None}
        want = [n for n in range(lo, hi + 1, 4) if n in notes] or sorted(notes)[:1]
        d = OUT / 'melodic' / gm; d.mkdir(parents=True, exist_ok=True)
        size = 0
        for n in want:
            data = base64.b64decode(notes[n]); (d / f'{n}.mp3').write_bytes(data); size += len(data)
        out[name] = {'dir': f'melodic/{gm}', 'notes': want, 'kind': kind, 'ext': 'mp3', 'source': 'FluidR3_GM'}
        print(f'{name:18s} {len(want):2d} samples {size / 1024:7.0f} KB')
    return out


def build_kits():
    out = {}
    for name, (folder, (path, lanes), label) in KITS.items():
        d = OUT / 'drums' / folder; d.mkdir(parents=True, exist_ok=True); size = 0
        for lane, f in lanes.items():
            data = fetch(DRUM_RAW.format(path, f)); (d / f).write_bytes(data); size += len(data)
        out[name] = {'dir': f'drums/{folder}', 'lanes': {str(k): v for k, v in lanes.items()}, 'source': label}
        print(f'{name:18s} {len(lanes):2d} samples {size / 1024:7.0f} KB')
    return out


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {'version': 1, 'instruments': build_melodic(), 'kits': build_kits(), 'credits': CREDITS}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=1), encoding='utf-8')
    lines = ['# Sample credits', '', 'LOOM can play some instruments from recorded samples instead of synthesising them. The audio files in this folder come from the openly licensed collections below. Attribution is required by the CC BY licences.', '']
    for c in CREDITS:
        lines += [f"- **{c['name']}** — {c['author']}. Licence: {c['license']} ({c['url']}). Obtained via {c['via']}. Used for: {c['used_for']}."]
    lines += ['', 'Only a sparse selection of notes is kept (every 4th semitone); the player pitch-shifts between them, so what you hear is a modified version of the originals.', '',
              'The TR-909 "Detroit" set in the same collection states no licence and is not included.', '', 'Regenerate with `python tools/build_samples.py`.']
    (OUT / 'CREDITS.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    total = sum(f.stat().st_size for f in OUT.rglob('*') if f.is_file())
    print(f'\nDone: {total / 1048576:.1f} MB in {OUT}')

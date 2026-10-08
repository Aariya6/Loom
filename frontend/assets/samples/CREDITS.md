# Sample credits

LOOM can play some instruments from recorded samples instead of synthesising them. The audio files in this folder come from the openly licensed collections below. Attribution is required by the CC BY licences.

- **FluidR3_GM soundfont** — Frank Wen. Licence: Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/us/). Pre-rendered by https://github.com/gleitz/midi-js-soundfonts. Used for: all melodic sampled instruments.
- **Pearl Master Studio Pack 1** — enoe. Licence: Creative Commons Attribution 3.0 (http://audio.ibeat.org/?ccm=/files/enoe/286). Obtained via https://github.com/oramics/sampled. Used for: the Acoustic Kit.
- **LinnDrum LM-2 samples** — Linn Electronics (samples circulated by the drum-machine community). Licence: labelled "Public Domain" by oramics/sampled (http://machines.hyperreal.org/manufacturers/Linn/LinnDrum/). Obtained via https://github.com/oramics/sampled. Used for: the Linn Kit.
- **Roland CR-78 samples** — Roland (samples from boxedear.com/free). Licence: labelled "Public Domain" by oramics/sampled (http://www.boxedear.com/free.html). Obtained via https://github.com/oramics/sampled. Used for: the CR-78 Kit.

Only a sparse selection of notes is kept (every 4th semitone); the player pitch-shifts between them, so what you hear is a modified version of the originals.

MP3 export uses the LAME encoder (via lamejs, LGPL-3.0); see `../vendor/README.md`.

The TR-909 "Detroit" set in the same collection states no licence and is not included.

Regenerate with `python tools/build_samples.py`.

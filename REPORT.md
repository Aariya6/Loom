# LOOM v10 release report

## Product
LOOM is a browser music workshop and listening laboratory. It is built around editable musical structure: notes, timing, instruments and layers remain separate so a piece can be studied and changed by hand.

## What is real
- Account creation/login/logout is backed by a persistent relational database.
- Project state and version history are persisted.
- Browser playback is generated with Web Audio; no hosted generative model is required.
- Analysis is deterministic and based on the supplied notes.
- Archive records retain source URLs and licence/provenance fields.
- MIDI export is generated in the browser.

## Algorithms
The analysis path uses vectorized NumPy operations for density, pitch classes, velocity histograms and novelty. Complexity is approximately O(n) for the main feature extraction passes with bounded 12-bin pitch aggregation.

## Security
Argon2id password hashing, server-side session tokens stored only as hashes, CSRF protection, SameSite cookies, rate limits, ownership predicates and bounded request sizes are included.

## Performance posture
The server never schedules audio playback. It only persists project JSON and computes descriptive analytics. Heavy network procurement is outside the request path.

## Known boundary
The zero-build browser frontend is intentional. A Next.js migration is not claimed because the current release prioritizes a directly runnable, dependency-light application.

## Studio rebuild (post-V10)
- The studio is now four views (Pattern, Steps, Arrange, Mixer) over one project model; see README for the feature list.
- Genres and beats are data (`data/genres.json`, `data/beats.json`) served by `/api/genres` and `/api/beats`; the generator in `frontend/assets/studio-gen.js` is pure logic with a Node test (60k+ checks across 20 genres × 3 seeds: pitch / timing / key / register validity, determinism, MIDI round-trip).
- Audio (vocals, loops) is stored server-side per project (`audio_assets`), validated by magic bytes, size- and quota-limited, and cascaded on project delete.
- Verified by rendering all 77 instruments and all 64 genres offline (through the recorded samples where they exist) through the real engine (no NaN, no clipping, audible). **Not verified by ear**: judging how good it sounds needs a human; the sounds are synthesized, not sampled, so expect a "synth" character. Microphone recording needs a real device and was not exercised in the automated browser run.

## Sharing, walkthroughs and collaboration
- `/share/<token>` is a public page that plays the shared snapshot in real time with the same engine as the studio (nothing is pre-rendered, so it starts instantly), with comments pinned to a second (video or song time), emoji reactions, a searchable transcript and a locally computed summary (chords are detected from the notes; no AI service).
- Live collaboration is **polling-based** (about every 4 s while people are present, 15 s alone), not a WebSocket stream, and it syncs whole saves, not keystrokes. Conflicts are caught by revision number and resolved by a person.
- Walkthrough recording needs a Chromium-style browser (screen capture and MediaRecorder). The automated tests use fake screen, camera, microphone and speech streams, so real capture devices and the real speech service were **not** exercised.

## A bug worth knowing about
While building the share page I replaced the CPU-heavy convolution reverb with an algorithmic one. The first version was unstable: its damping filters kept their default resonance, so loop gain exceeded 1 and a single hit grew about 8000x over 20 s. It is fixed (resonance 0, send gains start closed) and guarded by a regression test that renders a tail and requires it to fade. Whole-song offline renders (WAV and stem export) are still CPU-bound; on a busy machine a 16-bar export can take tens of seconds.

## Recorded samples
- 31 melodic instruments and 3 drum kits play recordings from `frontend/assets/samples/` (10 MB, sparse: every 4th semitone, pitch-shifted by playback rate; held instruments loop a matched zero-crossing region, verified click-free). Anything without a recording, or outside its range, or any drum lane the real kit lacks (e.g. clap, tambourine on the acoustic kit) falls back to the synth, per note.
- Licences are those the collections state about themselves: FluidR3_GM (CC BY 3.0, via the MIDI.js soundfonts), Pearl Master Studio by enoe (CC BY 3.0), and LinnDrum LM-2 / Roland CR-78 one-shots labelled "Public Domain" by oramics/sampled. I could not independently verify the provenance of the two drum-machine sets, so treat them as "labelled public domain", and replace them if that matters for your release. A TR-909 set in the same collection states no licence and was left out. If you ship LOOM, keep `CREDITS.md` with it.
- Because samples are on by default, existing projects change sound when opened (Grand Piano, guitars, Acoustic Kit …). Turning off *recorded samples* in the master section restores the original synthesised sound for that project.

## Moods, poems, stretch, MP3
- The poem layout is rule-based (a rough syllable counter and a reading-pace setting), not speech recognition or alignment: lines are placed where a typical reader at that pace would be, and you can drag your clip to match your actual reading. Browser text-to-speech cannot be captured into a mix, so there is no "computer reads the poem" export.
- Time-stretch uses WSOLA, which is good for speech and most music in the 0.5-2x range but can sound slightly phasey on sustained tones and percussive transients; heavy stretching of polyphonic music is not transparent. Stretched copies are computed in the browser the first time they are needed.
- MP3 uses the LGPL-3.0 `lamejs` build. That is a licensing decision for you: it is shipped unmodified as a separate file with its licence texts and loaded only on export, which is the arrangement its authors describe, but check that it suits how you plan to distribute LOOM.

## Known limits
- Automation covers volume, filter, pan, reverb and delay only (not drive, EQ or instrument parameters), and lanes are edited per track below the piano roll (not in Arrange). No pitch correction of recorded vocals, no SoundFont import (only the bundled recordings), the time signature is fixed at 4/4 (no waltz or 6/8 feel), and there are 64-bar and 24-track limits.

from backend.core import analyze_notes

def test_empty_analysis_is_stable():
    out = analyze_notes([])
    assert out["pitch_profile"] == [0] * 12
    assert out["density"] == []

def test_analysis_is_vectorized_and_descriptive():
    notes = [
        {"start": 0, "duration": .5, "pitch": 60, "velocity": .5},
        {"start": .5, "duration": .25, "pitch": 64, "velocity": .75},
        {"start": 4, "duration": .5, "pitch": 67, "velocity": 1},
    ]
    out = analyze_notes(notes, 2)
    assert out["stats"]["note_count"] == 3
    assert out["density"][0]["notes"] == 2
    assert sum(out["pitch_profile"]) == 3
    assert len(out["pc_2d"]) == 3

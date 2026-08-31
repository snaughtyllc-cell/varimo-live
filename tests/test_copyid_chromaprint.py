import os
import shutil
import subprocess
import wave

import pytest

from variant_maker.copyid.chromaprint import (
    AUDIO_METRIC,
    VIA_FFMPEG,
    _fpcalc_result,
    _fpcalc_via_ffmpeg,
    _write_pcm_wav,
    available,
    clear_fingerprint_cache,
    match_fingerprints,
    parse_raw,
    prefetch,
    score_audio,
)


def test_parse_raw_comma_and_spaces():
    text = "FILE=a.mp4\nDURATION=12\nFINGERPRINT=1,2,3,4\n"
    assert parse_raw(text) == [1, 2, 3, 4]
    text2 = "FINGERPRINT=10 20 30"
    assert parse_raw(text2) == [10, 20, 30]


def test_parse_raw_missing_raises():
    try:
        parse_raw("DURATION=1\n")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_identical_fingerprints_match():
    a = [0xAAAAAAAA, 0x55555555, 0xFFFFFFFF, 0x0, 0x1, 0x2, 0x3, 0x4]
    assert match_fingerprints(a, a) == 1.0


def test_offset_shift_still_matches():
    a = [10, 20, 30, 40, 50, 60, 70, 80, 90]
    b = [0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
    assert match_fingerprints(a, b) > 0.99


def test_flipped_bits_lower_score():
    a = [0] * 16
    b = [0xFFFFFFFF] * 16
    assert match_fingerprints(a, b) == 0.0


def test_score_audio_unavailable_without_fpcalc(monkeypatch):
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: False)
    r = score_audio("/nope/a.mp4", "/nope/b.mp4")
    assert r["available"] is False
    assert r["uniqueness"] is None
    assert r["metric"] == AUDIO_METRIC
    assert r["reason"] == "no_fpcalc"


def test_score_audio_reason_missing_file(monkeypatch, tmp_path):
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)
    r = score_audio(str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4"))
    assert r["available"] is False
    assert r["reason"] == "missing_file"


def test_score_audio_prefers_ffmpeg_decode(monkeypatch, tmp_path):
    """Always decode with our ffmpeg first. Direct fpcalc on BtbN mp4s is the miss."""
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    fp = [0xAAAAAAAA, 0x55555555, 0xFFFFFFFF, 0x0, 0x1, 0x2, 0x3, 0x4]
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)
    calls: list[str] = []

    def boom(path, *, length=120):
        calls.append("direct")
        raise subprocess.CalledProcessError(1, ["fpcalc"], stderr="decode")

    def decoded(path, *, length=120):
        calls.append("ffmpeg")
        return fp

    monkeypatch.setattr("variant_maker.copyid.chromaprint._fpcalc_direct", boom)
    monkeypatch.setattr("variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg", decoded)
    r = score_audio(str(a), str(b))
    assert r["available"] is True
    assert r["via"] == VIA_FFMPEG
    assert "ffmpeg" in calls
    assert "direct" not in calls


def test_score_audio_falls_back_to_ffmpeg_decode(monkeypatch, tmp_path):
    """Slim Fast fpcalc's libav often cannot decode our BtbN mp4s."""
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    fp = [0xAAAAAAAA, 0x55555555, 0xFFFFFFFF, 0x0, 0x1, 0x2, 0x3, 0x4]
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)

    def boom(path, *, length=120):
        raise subprocess.CalledProcessError(1, ["fpcalc"], stderr="decode")

    monkeypatch.setattr("variant_maker.copyid.chromaprint._fpcalc_direct", boom)
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg",
        lambda path, *, length=120: fp,
    )
    r = score_audio(str(a), str(b))
    assert r["available"] is True
    assert r["sim"] == 1.0
    assert r["via"] == VIA_FFMPEG


def test_score_audio_reason_error_when_both_paths_fail(monkeypatch, tmp_path):
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)

    def boom(path, *, length=120):
        raise subprocess.CalledProcessError(1, ["fpcalc"], stderr="nope")

    monkeypatch.setattr("variant_maker.copyid.chromaprint._fpcalc_direct", boom)
    monkeypatch.setattr("variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg", boom)
    r = score_audio(str(a), str(b))
    assert r["available"] is False
    assert r["reason"] == "error"
    assert "nope" in (r.get("detail") or "")


def test_score_audio_empty_direct_uses_wav(monkeypatch, tmp_path):
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    fp = [0xAAAAAAAA, 0x55555555, 0xFFFFFFFF, 0x0, 0x1, 0x2, 0x3, 0x4]
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_direct",
        lambda path, *, length=120: [],
    )
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg",
        lambda path, *, length=120: fp,
    )
    r = score_audio(str(a), str(b))
    assert r["available"] is True
    assert r["via"] == VIA_FFMPEG


@pytest.mark.skipif(not shutil.which("fpcalc"), reason="fpcalc not on PATH")
def test_fpcalc_binary_reports_available():
    assert available() is True


@pytest.mark.skipif(
    not shutil.which("fpcalc") or not shutil.which("ffmpeg"),
    reason="fpcalc+ffmpeg needed",
)
def test_score_audio_on_aac_mp4(tmp_path):
    """Our encodes are BtbN libx264+aac. s16le-first must score those, not error."""
    from conftest import HAS_FFMPEG
    if not HAS_FFMPEG:
        pytest.skip("needs ffmpeg")
    def tone(path):
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
                "-f", "lavfi", "-i", "color=c=black:s=64x64:r=15:d=6",
                "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k", path,
            ],
            check=True, capture_output=True,
        )
    a = str(tmp_path / "a.mp4")
    b = str(tmp_path / "b.mp4")
    tone(a)
    tone(b)
    r = score_audio(a, b)
    assert r["available"] is True, r
    assert r["sim"] is not None and r["sim"] > 0.9
    assert r["via"] == VIA_FFMPEG


def test_via_ffmpeg_wraps_classic_wav_for_fpcalc(monkeypatch, tmp_path):
    """ffmpeg decodes s16le; stdlib wave wraps it. Debian EOF'd raw -format s16le."""
    src = tmp_path / "a.mp4"
    src.write_bytes(b"x")
    calls: list[list[str]] = []

    def fake_which(name: str):
        return f"/usr/bin/{name}"

    def fake_run(argv, **kw):
        argv = [str(x) for x in argv]
        calls.append(argv)
        class P:
            returncode = 0
            stdout = "FINGERPRINT=1,2,3,4,5,6,7,8\n"
            stderr = ""
        if "ffmpeg" in argv[0]:
            out = argv[-1]
            with open(out, "wb") as f:
                f.write(b"\x00" * 256)
        return P()

    monkeypatch.setattr("variant_maker.copyid.chromaprint.shutil.which", fake_which)
    monkeypatch.setattr("variant_maker.copyid.chromaprint.subprocess.run", fake_run)
    fp = _fpcalc_via_ffmpeg(str(src))
    assert fp == [1, 2, 3, 4, 5, 6, 7, 8]
    ffmpeg_cmd = next(c for c in calls if "ffmpeg" in c[0])
    fpcalc_cmd = next(c for c in calls if "fpcalc" in c[0])
    assert "-nostdin" in ffmpeg_cmd
    assert "-vn" in ffmpeg_cmd
    assert "-f" in ffmpeg_cmd and "s16le" in ffmpeg_cmd
    assert any(str(x).endswith(".wav") for x in fpcalc_cmd)


def test_fpcalc_eof_with_fingerprint_is_a_score():
    """Pack bd19fcc20eed: Debian fpcalc exits 1 with EOF after printing FINGERPRINT=."""
    proc = subprocess.CompletedProcess(
        args=["fpcalc"], returncode=1,
        stdout="FINGERPRINT=1,2,3,4,5,6,7,8\n",
        stderr="ERROR: Error decoding audio frame (End of file)\n",
    )
    assert _fpcalc_result(proc) == [1, 2, 3, 4, 5, 6, 7, 8]


def test_fpcalc_eof_without_fingerprint_is_empty():
    proc = subprocess.CompletedProcess(
        args=["fpcalc"], returncode=1,
        stdout="",
        stderr="ERROR: Error decoding audio frame (End of file)\n",
    )
    assert _fpcalc_result(proc) == []


def test_write_pcm_wav_is_classic_riff(tmp_path):
    raw = tmp_path / "a.s16"
    raw.write_bytes(b"\x00\x01" * 64)
    wav = tmp_path / "a.wav"
    _write_pcm_wav(str(raw), str(wav))
    assert wav.read_bytes()[:4] == b"RIFF"
    with wave.open(str(wav), "rb") as w:
        assert w.getnchannels() == 1
        assert w.getsampwidth() == 2
        assert w.getframerate() == 11025


def test_score_audio_short_file_is_empty_not_error(monkeypatch, tmp_path):
    """fpcalc exits 2 with 'Empty fingerprint' on a 2s tone. That is a miss, not error."""
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg",
        lambda path, *, length=120: [],
    )
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_direct",
        lambda path, *, length=120: [],
    )
    r = score_audio(str(a), str(b))
    assert r["available"] is False
    assert r["reason"] == "empty"


def test_ffmpeg_empty_does_not_hand_mp4_to_fpcalc(monkeypatch, tmp_path):
    """Debian fpcalc on the BtbN mp4 is a slow miss. ffmpeg already ran."""
    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    a.write_bytes(b"x")
    b.write_bytes(b"y")
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg",
        lambda path, *, length=120: [],
    )
    direct_calls: list[str] = []

    def count_direct(path, *, length=120):
        direct_calls.append(path)
        return []

    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_direct", count_direct,
    )
    clear_fingerprint_cache()
    r = score_audio(str(a), str(b))
    assert r["available"] is False
    assert r["reason"] == "empty"
    assert direct_calls == []


def test_fingerprint_cache_decodes_source_once(monkeypatch, tmp_path):
    """N copies of one source must not ffmpeg-decode the source N times."""
    src = tmp_path / "src.mp4"
    v1 = tmp_path / "v1.mp4"
    v2 = tmp_path / "v2.mp4"
    src.write_bytes(b"s")
    v1.write_bytes(b"1")
    v2.write_bytes(b"2")
    fp = [0xAAAAAAAA, 0x55555555, 0xFFFFFFFF, 0x0, 0x1, 0x2, 0x3, 0x4]
    calls: list[str] = []
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)

    def decoded(path, *, length=120):
        calls.append(os.path.basename(path))
        return fp

    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg", decoded,
    )
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_direct",
        lambda path, *, length=120: [],
    )
    clear_fingerprint_cache()
    assert score_audio(str(src), str(v1))["available"] is True
    assert score_audio(str(src), str(v2))["available"] is True
    assert calls.count("src.mp4") == 1
    assert calls.count("v1.mp4") == 1
    assert calls.count("v2.mp4") == 1


def test_prefetch_fills_cache(monkeypatch, tmp_path):
    src = tmp_path / "src.mp4"
    var = tmp_path / "var.mp4"
    src.write_bytes(b"s")
    var.write_bytes(b"v")
    fp = [0xAAAAAAAA, 0x55555555, 0xFFFFFFFF, 0x0, 0x1, 0x2, 0x3, 0x4]
    calls: list[str] = []
    monkeypatch.setattr("variant_maker.copyid.chromaprint.available", lambda: True)

    def decoded(path, *, length=120):
        calls.append(os.path.basename(path))
        return fp

    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_via_ffmpeg", decoded,
    )
    monkeypatch.setattr(
        "variant_maker.copyid.chromaprint._fpcalc_direct",
        lambda path, *, length=120: [],
    )
    clear_fingerprint_cache()
    prefetch(str(src))
    assert calls == ["src.mp4"]
    assert score_audio(str(src), str(var))["available"] is True
    assert calls == ["src.mp4", "var.mp4"]

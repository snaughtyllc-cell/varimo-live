"""Look-first visual gate: actual frames, not the VMAF proxy."""
from __future__ import annotations

import os
import subprocess
import time

import pytest
from conftest import HAS_FFMPEG

from variant_maker import look, uniqueness

pytestmark = pytest.mark.skipif(not HAS_FFMPEG, reason="needs ffmpeg")


def _clip(path: str, *, seconds: float = 1.0, w: int = 320, h: int = 560) -> str:
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate=15:duration={seconds}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", path,
        ],
        check=True,
        capture_output=True,
    )
    return path


def _overlay_blotch(src: str, dest: str) -> str:
    """Gross luma lift in the lookaqmtp MAE band (real pack scored 41–57)."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-vf", "geq=lum='clip(lum(X,Y)+45,0,255)':cb='cb(X,Y)':cr='cr(X,Y)'",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", dest,
        ],
        check=True,
        capture_output=True,
    )
    return dest


def test_look_gate_is_tighter_than_lookaqmtp_shade():
    assert look.LOOK_LUMA_MAX == 38.0
    assert look.LOOK_GRID == (16, 28)
    assert look.LOOK_METRIC == "coarse_luma_v1"


def test_look_unknown_on_missing_file(tmp_path):
    out = look.score_look(str(tmp_path / "nope.mp4"), str(tmp_path / "also.mp4"))
    assert out["look_status"] == "unknown"
    assert out["look_mae"] is None


def test_identity_look_ok(tmp_path):
    src = _clip(str(tmp_path / "src.mp4"))
    scored = look.score_look(src, src)
    assert scored["look_status"] == "ok"
    assert scored["look_mae"] == 0
    assert scored["look_mae_max"] == 0


def test_gross_luma_blotch_fails_look(tmp_path):
    src = _clip(str(tmp_path / "src.mp4"))
    blotch = _overlay_blotch(src, str(tmp_path / "blotch.mp4"))
    scored = look.score_look(src, blotch)
    assert scored["look_status"] == "fail"
    assert scored["look_mae_max"] > look.LOOK_LUMA_MAX


def test_reencode_without_shade_passes_look(tmp_path):
    src = _clip(str(tmp_path / "src.mp4"))
    dest = str(tmp_path / "clean.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", dest,
        ],
        check=True,
        capture_output=True,
    )
    scored = look.score_look(src, dest)
    assert scored["look_status"] == "ok"
    assert scored["look_mae_max"] <= look.LOOK_LUMA_MAX


def test_lookaqmtp_real_pack_fails_look():
    """Lab lava pack vs source. Skip when the local clips are not on disk."""
    src = "/tmp/vf-screen-unique/03_ig720_aqmtp_th.mp4"
    lava = "/tmp/vf-lab8/aqmtp4540720/03_ig720_aqmtp_th_v01_f75d6cca.mp4"
    medium = "/tmp/vf-first-pass/03_ig720_aqmtp_th_first.mp4"
    if not all(os.path.isfile(p) for p in (src, lava, medium)):
        pytest.skip("lookaqmtp clips not on this machine")
    assert look.score_look(src, lava)["look_status"] == "fail"
    assert look.score_look(src, medium)["look_status"] == "ok"


def test_stills_and_mae_are_not_the_uniqueness_wait(tmp_path):
    """Side-channel stills + coarse MAE must finish inside the SSIM uniqueness budget.

    Overlap only keeps Generate wait flat if uniqueness is the slower of the two.
    """
    src = _clip(str(tmp_path / "src.mp4"), seconds=1.5, w=640, h=1120)
    dest = str(tmp_path / "v.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", dest,
        ],
        check=True,
        capture_output=True,
    )
    t0 = time.perf_counter()
    look.write_look_stills(src, dest, str(tmp_path), 1)
    stills_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    look.score_look(src, dest)
    mae_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    uniqueness.score_uniqueness(src, dest, target=uniqueness.DEFAULT_TARGET)
    uniq_s = time.perf_counter() - t0
    # SSIM extracts 6 frames + 3 SSIM pairs. Stills are 2 JPEGs; MAE is 3 tiny blends.
    # Overlap wall is max(stills, MAE, uniqueness). Uniqueness must be that max.
    assert uniq_s >= stills_s
    assert uniq_s >= mae_s


def test_write_look_stills(tmp_path):
    src = _clip(str(tmp_path / "src.mp4"))
    names = look.write_look_stills(src, src, str(tmp_path), 1)
    assert names["look_src"] == "look_v01_src.jpg"
    assert names["look_var"] == "look_v01.jpg"
    assert os.path.getsize(tmp_path / names["look_src"]) > 0
    assert os.path.getsize(tmp_path / names["look_var"]) > 0


def _mean_rgb(path: str, vf: str) -> tuple[float, float, float]:
    proc = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", path, "-vf", vf,
            "-frames:v", "1", "-f", "rawvideo", "pipe:1",
        ],
        check=True, capture_output=True,
    )
    buf = proc.stdout
    n = len(buf) // 3
    rs = gs = bs = 0
    for i in range(0, len(buf), 3):
        rs += buf[i]
        gs += buf[i + 1]
        bs += buf[i + 2]
    return rs / n, gs / n, bs / n


def test_still_vf_is_zscale_srgb():
    """Naked scale=360 is the 601-ish JPEG path that olives Gallery stills."""
    vf = look.still_vf()
    assert "zscale=" in vf
    assert "iec61966-2-1" in vf
    assert f"scale={look.STILL_WIDTH}:-2" in vf
    assert "eq=saturation" not in vf


def test_look_stills_do_not_olive_a_tagged_skin(tmp_path):
    """Gallery look JPEGs used a naked scale=360. Mid grey hides it (G−R ≈ 0
    either way). Skin-ish 0xC68642 tagged bt709/tv shows the 601 JPEG olive."""
    src = str(tmp_path / "skin.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=0xC68642:s=640x360:r=15:d=1",
            "-vf", "format=yuv420p",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
            "-colorspace", "bt709", "-color_primaries", "bt709",
            "-color_trc", "bt709", "-color_range", "tv",
            src,
        ],
        check=True, capture_output=True,
    )
    names = look.write_look_stills(src, src, str(tmp_path), 1)
    jpg = str(tmp_path / names["look_src"])
    r, g, b = _mean_rgb(jpg, "format=rgb24")
    truth_vf = (
        "zscale=matrixin=709:transferin=709:primariesin=709:rangein=limited:"
        "matrix=709:transfer=iec61966-2-1:primaries=bt709:range=full,format=rgb24"
    )
    tr, tg, tb = _mean_rgb(src, truth_vf)
    assert abs((g - r) - (tg - tr)) < 2.5
    assert abs((g - b) - (tg - tb)) < 2.5


def _caption_bar(src: str, dest: str) -> str:
    """Bottom caption / IG chrome — the bradnded overlay class."""
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-vf", "drawbox=x=0:y=ih*0.75:w=iw:h=ih*0.25:color=white:t=fill",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", dest,
        ],
        check=True, capture_output=True,
    )
    return dest


def _crop_keep(
    src: str, dest: str, keep: float = 0.90,
    *, x_frac: float = 0.5, y_frac: float = 0.5,
) -> str:
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-vf", (
                f"crop=iw*{keep:.4f}:ih*{keep:.4f}:"
                f"(iw-iw*{keep:.4f})*{x_frac:.4f}:(ih-ih*{keep:.4f})*{y_frac:.4f}"
            ),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", dest,
        ],
        check=True, capture_output=True,
    )
    return dest


def test_overlay_plus_caption_crop_does_not_fail_look(tmp_path):
    """Caption + punch-in is a geometry miss, not lava. Naive full-frame MAE
    trips 38; crop-align the source window so a pack Jeff would ship stays look-ok."""
    src = _caption_bar(
        _clip(str(tmp_path / "src.mp4"), w=360, h=640),
        str(tmp_path / "overlay.mp4"),
    )
    cropped = _crop_keep(
        src, str(tmp_path / "crop.mp4"), keep=0.80, x_frac=0.5, y_frac=0.0,
    )
    naive = look.score_look(src, cropped)
    assert naive["look_mae_max"] > look.LOOK_LUMA_MAX
    aligned = look.score_look(
        src, cropped,
        video={"crop_keep": 0.80, "crop_x_frac": 0.5, "crop_y_frac": 0.0},
    )
    assert aligned["look_status"] == "ok"
    assert aligned["look_mae_max"] <= look.LOOK_LUMA_MAX


def test_trim_and_out_fps_do_not_fail_look(tmp_path):
    """NEW-bradnded MAE 119 was keyframe-seek on 60fps vs 48fps + trim, not
    lava. Accurate frame times keep the same story moment under the 38 gate."""
    src = str(tmp_path / "src.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=60:duration=4",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-g", "60", "-keyint_min", "60", "-an", src,
        ],
        check=True, capture_output=True,
    )
    dest = str(tmp_path / "var.mp4")
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error", "-i", src,
            "-vf", "trim=start=0.30:end=3.70,setpts=PTS-STARTPTS,setpts=PTS/1.06,fps=48",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "48", "-an", dest,
        ],
        check=True, capture_output=True,
    )
    scored = look.score_look(
        src, dest,
        video={"trim_s": 0.30, "trim_end_s": 0.30, "speed": 1.06, "out_fps": 48},
    )
    assert scored["look_status"] == "ok"
    assert scored["look_mae_max"] <= look.LOOK_LUMA_MAX


def test_crop_align_does_not_pass_a_luma_blotch(tmp_path):
    src = _clip(str(tmp_path / "src.mp4"), w=360, h=640)
    cropped = _crop_keep(src, str(tmp_path / "crop.mp4"), keep=0.90)
    blotch = _overlay_blotch(cropped, str(tmp_path / "blotch.mp4"))
    scored = look.score_look(
        src, blotch,
        video={"crop_keep": 0.90, "crop_x_frac": 0.5, "crop_y_frac": 0.5},
    )
    assert scored["look_status"] == "fail"
    assert scored["look_mae_max"] > look.LOOK_LUMA_MAX

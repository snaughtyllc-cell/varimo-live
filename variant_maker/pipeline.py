"""Phase 7. Orchestrator: probe -> per-variant (sample -> filtergraph -> render ->
quality guard -> record) -> write manifest. Tier-2 neural stages inserted when quality='hq'.

`run(config)` returns the Manifest object (the clean callable the Drive farm layer wraps).
"""
from __future__ import annotations

import os
import random
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

from . import autotune, look, quality, uniqueness
from .copyid import normalize_mode
from .ffmpeg import has_rubberband, render_variant
from .manifest import Manifest, VariantRecord
from .platforms import fit_platform_to_source, resolve_platform
from .presets import get_preset
from .probe import probe
from .sampler import apply_rotate_safe, clamp_strength, derive_seed, disable_fast_pixel_ops, sample
from .shot import classify_shot

# TikFusion Smart Detector floor ≈ 18 bits. Fast vs-source *gate* is 24/64 (~38% UI)
# so a medium 20-pack stays on medium. Raising the gate to 32 escalated all 20.
# Gate 24/24 (~38% UI). 1080 talking-head medium *can* score ~35–42 bits
# (~55–65% UI) on a matching canvas (portrait 1080×1920 or landscape 1920×1080).
# Usable 720 Fast lands ~24–27 bits (~38–42%) when crop punches from the top —
# still a pass. Centered 0.92 keep on Instagram 720 scored 20 bits and never
# cleared; do not tell operators to re-upload 1080. AQMTp-class tight faces
# miss medium (~18 bits). Do not buy 24 with shade (lookaqmtp lava). Look-first
# (`look.py`) stills overlap uniqueness so Generate wait stays uniqueness-bound.
DEFAULT_UNIQUENESS_TARGET = uniqueness.DEFAULT_TARGET
# Wider ladder so medium can clear the vs-source gate before the one creative escalate.
DEFAULT_UNIQ_STRENGTHS = [1.0, 1.4, 1.8]
DEFAULT_MIN_BITS_VS_PEERS = uniqueness.MIN_PEER_BITS
# Fast daily packs: one medium encode, then escalate. Five-step bisection on a
# 720 talking-head that sits at 23 bits is how a Fast 20 hit executionTimeout.
FAST_TUNE_MAX_ITERS = 1


def use_face_protect(quality_mode: str | None) -> bool:
    """Face crop-gating is HQ-only.

    Fast uniqueness is mostly crop. OpenCV Haar on a talking-head (≥15% face) sets
    ``crop_keep=1.0``, which is how a Fast pack lands ~22 bits (~35% UI) and
    escalates every file. Protect stays on for HQ so Real-ESRGAN does not punch
    into faces.
    """
    return str(quality_mode or "fast").strip().lower() == "hq"


def _apply_variant_policy(
    params: dict,
    vseed: int,
    preset,
    shot_kind: str | None,
    rotate_off: bool,
    config: dict,
) -> None:
    """Rotate safe by default; optional US metadata. Mutates params."""
    if rotate_off:
        params["video"]["rotate_deg"] = 0.0
    else:
        allow_zero = abs(preset.rotate_deg.hi - preset.rotate_deg.lo) < 1e-12
        params["video"]["rotate_deg"] = apply_rotate_safe(
            params["video"]["rotate_deg"], shot_kind, allow_zero=allow_zero,
        )
    if config.get("us_metadata"):
        params["us_metadata"] = True
        params["video"]["us_metadata_seed"] = int(vseed)


def _ffmpeg_version() -> str:
    out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=False)
    line = out.stdout.splitlines()[0] if out.stdout else ""
    parts = line.split()
    return parts[2] if len(parts) >= 3 else "unknown"


def run(config: dict, *, on_event=None) -> Manifest:
    emit = on_event if on_event is not None else (lambda *a, **k: None)
    input_path = config["input"]
    count = config["count"]
    preset = get_preset(config["preset"])
    out_dir = config["out"]
    floor = config.get("quality_floor", 90.0)
    # Spatial-corruption floor. Calibrated on a real clip across BOTH upscale backends (GPU
    # smoke test, 2026-06-28): catastrophic garble (scrambled tiles) scores ~3-4, while clean
    # output scores ~33 (CUDA/PyTorch on a grainy variant) up to ~94 (clean roundtrip); ncnn
    # clean is 60+. 20 sits in that gap — catches the catastrophic tile-seam failure the eye
    # caught, without falsely rejecting clean CUDA output. (Single-clip calibration; a
    # backend-specific floor could restore sensitivity to subtler corruption later.)
    corruption_floor = config.get("corruption_floor", 20.0)
    max_regen = config.get("max_regen", 3)
    rotate_mode = config.get("rotate", "safe")
    rotate_off = rotate_mode == "never"
    dry_run = config.get("dry_run", False)
    jobs = max(1, config.get("jobs", 1))

    audio_uniqueness = bool(config.get("audio_uniqueness", False))
    if audio_uniqueness:
        rubberband = config.get("rubberband")
        if rubberband is None:
            rubberband = has_rubberband()
    else:
        rubberband = False
    config = {**config, "rubberband": rubberband, "audio_uniqueness": audio_uniqueness}

    # Uniqueness gate: try the light (config) preset at escalating strengths; if none
    # clears the target (and peer-bits floor), spend exactly one creative-escalate
    # attempt on the strong preset.
    uniqueness_target = config.get("uniqueness_target", DEFAULT_UNIQUENESS_TARGET)
    # off (default Fast) | record (score heads, SSIM gates) | gate (fused min).
    copyid_mode = normalize_mode(config.get("copyid"))
    allow_creative_escalate = config.get("allow_creative_escalate", True)
    uniq_strengths = config.get("uniq_strengths", list(DEFAULT_UNIQ_STRENGTHS))
    min_bits_vs_peers = config.get("min_bits_vs_peers", DEFAULT_MIN_BITS_VS_PEERS)
    # Fast is the daily pack: auto-tune on unless the caller opts out. HQ stays
    # one-pass (Real-ESRGAN) so bisection cannot blow the GPU time cap.
    auto_tune = config.get("auto_tune")
    if auto_tune is None:
        auto_tune = config.get("quality_mode", "fast") != "hq"
    look_first = bool(config.get("look_first"))
    if look_first:
        # One medium encode + stills. Visual test, not a uniqueness hunt.
        count = 1
        allow_creative_escalate = False
        auto_tune = False
        uniq_strengths = [1.0]

    master_seed = config.get("seed")
    if master_seed is None:
        master_seed = random.randrange(2 ** 32)

    # Same-batch diversity: earlier accepted variants in this source run (TikFusion
    # crossPasses / minBitsVsCopies). Shared across workers when jobs > 1.
    kept_paths: list[str] = []
    kept_lock = threading.Lock()

    # Tier 2 is lazy-imported and gated: hq requested AND the upscaler is actually usable.
    neural = None
    if config.get("quality_mode") == "hq":
        from .neural import upscale as neural
    hq = neural is not None and neural.available()

    src = probe(input_path)
    platform = resolve_platform(
        config["platform"],
        getattr(src, "width", None),
        getattr(src, "height", None),
    )
    # Fast: never lanczos-upscale a sub-canvas source (720p IG → 1080 glitter).
    # HQ Real-ESRGAN is the true upscaler and still targets the full social canvas.
    if not hq:
        platform = fit_platform_to_source(platform, src.width, src.height)
    stem = os.path.splitext(os.path.basename(input_path))[0]
    shot_info = classify_shot(src.path, src.duration_s)
    shot_kind = shot_info.get("kind")
    # Talking-head copies of a still face land ~13–17 peer bits even with
    # different chroma seeds and strong grain. Escalating to strong tightens
    # crop into 0.78 (the face-zoom we banned) and still fails peer. Vs-source
    # already scores 55–65% on medium. Record peer bits; don't let them force
    # strong or demote a passing vs-source score. Motion still uses the 24-bit
    # peer floor. MIN_PEER_BITS stays 24.
    peer_gate = shot_kind != "talking_head"

    def _name(i: int, vseed: int) -> str:
        return f"{stem}_v{i:02d}_{vseed & 0xFFFFFFFF:08x}.mp4"

    run_meta = {
        "master_seed": master_seed,
        "preset": preset.name,
        "platform": platform.name,
        "canvas": (
            [platform.width, platform.height]
            if platform.width and platform.height else None
        ),
        "quality_mode": config.get("quality_mode", "fast"),
        "auto_tune": bool(auto_tune),
        "rubberband": bool(rubberband),
        "audio_uniqueness": bool(audio_uniqueness),
        "protect": False,
        "count": count,
        "shot": shot_info,
        "quality_floor": {"metric": "vmaf", "value": floor},
        "ffmpeg_version": _ffmpeg_version(),
        "copyid": copyid_mode,
    }

    def _prep(i: int):
        vseed = derive_seed(master_seed, i)
        return vseed, _name(i, vseed), os.path.join(out_dir, _name(i, vseed))

    # --dry-run: print the plan + commands, render nothing, write nothing.
    if dry_run:
        from .neural import protect
        records = []
        for i in range(1, count + 1):
            vseed, fname, path = _prep(i)
            params = sample(
                preset, vseed, rubberband=rubberband, duration_s=src.duration_s,
                shot=shot_kind, width=src.width, height=src.height,
                audio_uniqueness=audio_uniqueness,
            )
            if use_face_protect(config.get("quality_mode")):
                params = protect.apply_to_params(params)
            _apply_variant_policy(params, vseed, preset, shot_kind, rotate_off, config)
            if hq:
                params = disable_fast_pixel_ops(params)
            _, cmd = render_variant(src, params, platform, path, dry_run=True)
            print(f"[{i}/{count}] {fname}\n  {cmd}")
            records.append(VariantRecord(index=i, filename=fname, seed=vseed,
                                         params=params, ffmpeg_cmd=cmd, status="dry-run"))
        return Manifest(source=src.to_dict(), run=run_meta, variants=records)

    os.makedirs(out_dir, exist_ok=True)
    protect_frame = None
    from .neural import protect as protect_mod
    if use_face_protect(config.get("quality_mode")) and protect_mod.available():
        protect_frame = protect_mod.grab_mid_frame(src.path, src.duration_s, out_dir)
    run_meta["protect"] = protect_frame is not None

    if copyid_mode != "off":
        def _prefetch_src_audio() -> None:
            try:
                from .copyid.chromaprint import prefetch
                prefetch(src.path)
            except (OSError, subprocess.CalledProcessError, ValueError, TypeError):
                return
        threading.Thread(
            target=_prefetch_src_audio, name="copyid-prefetch", daemon=True,
        ).start()

    def _render_one(i: int) -> VariantRecord:
        token = config.get("cancel_token")
        if token is not None and token.is_set():
            from .server.cancel import JobCancelled
            raise JobCancelled()
        vseed, fname, path = _prep(i)
        attempt_no = -1  # bumped to 0 on first render, +1 on each re-roll
        last_strength = clamp_strength(uniq_strengths[0] if uniq_strengths else 1.0)

        def attempt(strength: float, use_preset, *, gate_quality: bool = True) -> dict:
            nonlocal attempt_no, last_strength
            attempt_no += 1
            # Record the EFFECTIVE strength (post-clamp) — the value `sample` actually
            # applies — not the raw ladder/falloff value, which can differ once clamped.
            effective_strength = clamp_strength(strength)
            last_strength = effective_strength
            emit("rendering", index=i, attempt=attempt_no)
            params = sample(
                use_preset, vseed, strength=effective_strength, rubberband=rubberband,
                duration_s=src.duration_s, shot=shot_kind,
                width=src.width, height=src.height,
                audio_uniqueness=audio_uniqueness,
            )
            if protect_frame is not None:
                from .neural import protect
                params = protect.apply_to_params(params, frame_path=protect_frame)
            _apply_variant_policy(params, vseed, use_preset, shot_kind, rotate_off, config)
            if hq:
                params = disable_fast_pixel_ops(params)
            if hq:
                _, cmd, nops = neural.upscale_clip(src, params, path, platform=platform)
            else:
                _, cmd = render_variant(src, params, platform, path)
                nops = []
            if not gate_quality:
                # Uniqueness miss will discard this encode. Do not pay VMAF on it.
                return {
                    "vmaf": None, "histogram_ok": True, "passed": True,
                    "params": params, "cmd": cmd, "neural_ops": nops,
                    "regen_count": 0,
                }
            qr = path + ".qr.mp4"
            quality.quality_render(src, params, qr)
            emit("checking", index=i)
            g = quality.passes_guard(src.path, path, qr, floor=floor)
            for tmp in (qr, qr + ".vmaf.json"):
                if os.path.exists(tmp):
                    os.remove(tmp)
            return {**g, "params": params, "cmd": cmd, "neural_ops": nops}

        def regen(use_preset, start_strength) -> dict:
            return quality.regen_until_pass(
                lambda s: attempt(s, use_preset), max_regen=max_regen, strength=start_strength,
                on_regen=lambda n, mx: emit("rerolling", index=i, attempt=n, max_attempts=mx),
            )

        def _emit_looking() -> None:
            emit(
                "looking", index=i, filename=fname,
                look_status=look_info.get("look_status"),
                look_mae=look_info.get("look_mae"),
                look_mae_max=look_info.get("look_mae_max"),
                look_src=look_info.get("look_src"),
                look_var=look_info.get("look_var"),
            )

        def _write_look_stills() -> dict:
            try:
                return look.write_look_stills(src.path, path, out_dir, i)
            except (OSError, ValueError, subprocess.CalledProcessError):
                return {}

        def _score_uniqueness_now() -> dict:
            # Extra kwargs only when enabled so existing test fakes stay valid.
            # record: SSIM only on this thread (Generate wait). Chromaprint
            # attaches after uniqueness on the kept file. gate still fuses here.
            extra: dict = {}
            if copyid_mode == "gate":
                extra = {"copyid": "gate"}
            elif copyid_mode == "record":
                extra = {"copyid": "record", "attach_heads": False}
            scored = uniqueness.score_uniqueness(
                src.path, path, target=uniqueness_target, **extra,
            )
            return _apply_peer_status(scored, _peer_bits(path))

        def _look_then_uniqueness(video: dict | None = None) -> dict:
            """Stills on the card first. Uniqueness work starts immediately.

            Two 360px JPEGs overlap SSIM so Generate wait stays uniqueness-bound.
            Coarse MAE runs *after* uniqueness — overlapping it with 8-wide SSIM
            on Fast contended the CPU and stretched the uniqueness phase.
            ``record`` Chromaprint also waits until the kept file (after MAE) so
            autotune attempts do not decode audio N times. ``gate`` still fuses
            inside ``score_uniqueness``.
            Auto-tune calls this before assigning outer ``r`` — pass ``video=``
            from the attempt so crop/trim MAE aligns.
            """
            nonlocal look_info
            with ThreadPoolExecutor(max_workers=1) as look_ex:
                uniq_f = look_ex.submit(_score_uniqueness_now)
                look_info = {**look_info, **_write_look_stills()}
                _emit_looking()
                emit("uniqueness", index=i)
                scored = uniq_f.result()
            look_video = video
            if look_video is None and r is not None:
                look_video = (r.get("params") or {}).get("video")
            look_info = {
                **look_info,
                **look.score_look(src.path, path, video=look_video),
            }
            return scored

        def _snapshot_medium() -> dict:
            """Keep the look-ok medium file so a blotchy escalate can roll back."""
            snap = path + ".look_medium.mp4"
            shutil.copy2(path, snap)
            return {
                "path": snap,
                "look": dict(look_info),
                "u": dict(u),
                "r": dict(r) if r is not None else None,
                "preset_used": preset_used,
            }

        def _restore_medium_if_look_fail(snap: dict) -> None:
            """Escalate is uniqueness-only. Look fail keeps the medium encode."""
            nonlocal look_info, u, r, preset_used, escalated
            if look_info.get("look_status") != "fail":
                if os.path.isfile(snap["path"]):
                    os.remove(snap["path"])
                return
            os.replace(snap["path"], path)
            look_info = snap["look"]
            u = snap["u"]
            r = snap["r"]
            preset_used = snap["preset_used"]
            escalated = False
            look_info = {**look_info, **_write_look_stills()}
            _emit_looking()

        def _peer_bits(variant_path: str) -> int | None:
            """Lowest SSIM bits vs earlier kept variants; None if no peers yet.

            Talking-head skips this (peer_gate is off) — still-face copies land
            ~13 bits even at strong, and 8×8 ffmpeg SSIM on wave 2 of a Fast 20
            was ~160s per uniqueness check.
            """
            if not peer_gate:
                return None
            with kept_lock:
                peers = list(kept_paths)
            if not peers:
                return None
            scores: list[int] = []
            for peer in peers:
                try:
                    scores.append(uniqueness.bits_vs(variant_path, peer))
                except (OSError, subprocess.CalledProcessError, ValueError, TypeError):
                    continue
            return min(scores) if scores else None

        def _gate_ok(u_score: dict, peer_min: int | None) -> bool:
            """Pass when source uniqueness clears (or unknown) AND peers clear min bits."""
            if peer_gate and peer_min is not None and peer_min < min_bits_vs_peers:
                return False
            return u_score["uniqueness_status"] in ("ok", "unknown")

        def _apply_peer_status(u_score: dict, peer_min: int | None) -> dict:
            """Record peer distance; demote ok → below_target when peers are too close."""
            out = dict(u_score)
            out["min_bits_vs_peers"] = peer_min
            if (
                peer_gate
                and peer_min is not None
                and peer_min < min_bits_vs_peers
                and out.get("uniqueness_status") == "ok"
            ):
                out["uniqueness_status"] = "below_target"
            return out

        # Uniqueness gate: light preset at rising strengths, quality regen inside each
        # attempt as before. Source bits AND same-batch peer bits must clear. If none
        # clears, spend one creative escalate at the strong preset (still quality-gated)
        # and only then apply the 19-bit ship floor. 19–23 on the *first* pass is
        # still a miss — escalate. After the hunt, 19–23 ships as below_target;
        # under 19 is uniqueness_fail. Never fake a 24-bit score.
        preset_used = preset.name
        escalated = False
        r = None
        u = {
            "uniqueness": None, "uniqueness_status": "unknown",
            "uniqueness_metric": None, "uniqueness_target": uniqueness_target,
            "bits": None, "min_bits_vs_peers": None,
        }
        look_info: dict = {
            "look_status": "unknown", "look_mae": None, "look_mae_max": None,
            "look_src": None, "look_var": None,
        }
        prev_effective = None
        if auto_tune:
            def _quality_on_current(params) -> dict:
                qr = path + ".qr.mp4"
                quality.quality_render(src, params, qr)
                emit("checking", index=i)
                g = quality.passes_guard(src.path, path, qr, floor=floor)
                for tmp in (qr, qr + ".vmaf.json"):
                    if os.path.exists(tmp):
                        os.remove(tmp)
                return g

            def _tune_attempt(strength: float) -> dict:
                r_try = attempt(strength, preset, gate_quality=False)
                u_try = _look_then_uniqueness(
                    video=(r_try.get("params") or {}).get("video"),
                )
                peer_min = u_try.get("min_bits_vs_peers")
                peer_ok = (
                    (not peer_gate)
                    or peer_min is None
                    or peer_min >= min_bits_vs_peers
                )
                uniq_ok = (
                    u_try.get("uniqueness") is not None
                    and u_try["uniqueness"] >= uniqueness_target
                    and peer_ok
                )
                if uniq_ok:
                    g = _quality_on_current(r_try["params"])
                    if not g["passed"]:
                        r_try = regen(preset, strength)
                    else:
                        r_try = {**r_try, **g, "regen_count": 0}
                # Quality `passed` is VMAF/histogram only. Peer miss is too-similar
                # (search stronger), not too-strong (search milder).
                quality_run = r_try.get("vmaf") is not None
                return {
                    **r_try,
                    **u_try,
                    "quality_passed": bool(r_try.get("passed")) and quality_run,
                    "passed": r_try["passed"],
                    "peer_ok": peer_ok,
                    "uniqueness": u_try["uniqueness"],
                }

            tuned = autotune.tune(
                _tune_attempt, target=uniqueness_target, stop_on_clear=True,
                max_iters=FAST_TUNE_MAX_ITERS,
            )
            r = {
                "params": tuned["params"],
                "cmd": tuned["cmd"],
                "neural_ops": tuned["neural_ops"],
                "vmaf": tuned["vmaf"],
                "histogram_ok": tuned["histogram_ok"],
                "regen_count": tuned["regen_count"],
                "passed": tuned["quality_passed"],
            }
            u = {
                "uniqueness": tuned["uniqueness"],
                "uniqueness_status": tuned["uniqueness_status"],
                "uniqueness_metric": tuned["uniqueness_metric"],
                "uniqueness_target": tuned["uniqueness_target"],
                "bits": tuned.get("bits"),
                "min_bits_vs_peers": tuned.get("min_bits_vs_peers"),
                # Fast auto_tune used to drop these — lab pack 3d4fae98ca77
                # ran copyid=record and still wrote quality.heads=null.
                "heads": tuned.get("heads"),
                "copyid_mode": tuned.get("copyid_mode"),
                "fused_from": tuned.get("fused_from"),
            }
            cleared = (
                tuned.get("quality_passed")
                and tuned.get("uniqueness") is not None
                and tuned["uniqueness"] >= uniqueness_target
                and tuned.get("peer_ok", True)
            )
            if (
                not cleared and allow_creative_escalate
                and look_info.get("look_status") != "fail"
            ):
                snap = _snapshot_medium()
                emit("escalating", index=i)
                strong = get_preset("strong")
                r = regen(strong, 1.0)
                u = _look_then_uniqueness()
                preset_used = strong.name
                escalated = True
                _restore_medium_if_look_fail(snap)
        else:
            for strength in uniq_strengths:
                # Belt-and-suspenders: if two ladder rungs clamp to the same effective
                # strength, the second render would be byte-for-byte identical spend —
                # skip it rather than pay for a duplicate render.
                effective = clamp_strength(strength)
                if r is not None and effective == prev_effective:
                    continue
                prev_effective = effective
                r = regen(preset, strength)
                u = _look_then_uniqueness()
                if r["passed"] and _gate_ok(u, u.get("min_bits_vs_peers")):
                    break
            else:
                if (
                    allow_creative_escalate
                    and look_info.get("look_status") != "fail"
                ):
                    snap = _snapshot_medium()
                    emit("escalating", index=i)
                    strong = get_preset("strong")
                    r = regen(strong, 1.0)
                    u = _look_then_uniqueness()
                    preset_used = strong.name
                    escalated = True
                    _restore_medium_if_look_fail(snap)

        # record: fingerprint the kept file once, after SSIM/MAE. Do not pay
        # Chromaprint on every autotune attempt. gate already fused above.
        if copyid_mode == "record" and not u.get("heads"):
            u = uniqueness.attach_copyid_heads(
                u, src.path, path, copyid="record",
            )

        if r is not None and r.get("vmaf") is None:
            qr = path + ".qr.mp4"
            quality.quality_render(src, r["params"], qr)
            emit("checking", index=i)
            g = quality.passes_guard(src.path, path, qr, floor=floor)
            for tmp in (qr, qr + ".vmaf.json"):
                if os.path.exists(tmp):
                    os.remove(tmp)
            r = {**r, **g, "regen_count": r.get("regen_count") or 0}

        info = probe(path)

        # Spatial-corruption guard: only tier-2 (upscaled) output can tile-seam; tier-1 is
        # N/A (None). A corrupt upscale is flagged here so the farm refuses to upload it —
        # the histogram+VMAF guard above cannot see this failure mode.
        spatial_vmaf = None
        spatial_ok = None
        if r["neural_ops"] and "spatial_vmaf" in r["neural_ops"][0]:
            spatial_vmaf = r["neural_ops"][0]["spatial_vmaf"]
            spatial_ok = spatial_vmaf >= corruption_floor

        if spatial_ok is False:
            status = "corrupt"
        elif uniqueness.status_for_bits(u.get("bits"), target=uniqueness_target) == "below_floor":
            # Missed 24 after the hunt, and missed the 19-bit / 30% post-escalate
            # ship floor. Do not count this as a delivered ok file.
            u["uniqueness_status"] = "below_floor"
            status = "uniqueness_fail"
        elif r["passed"]:
            status = "ok"
        else:
            status = "best_effort"

        quality_info = {
            "vmaf": round(r["vmaf"], 2), "histogram_ok": r["histogram_ok"],
            "regen_count": r["regen_count"], "passed": r["passed"],
            "spatial_vmaf": spatial_vmaf, "spatial_ok": spatial_ok,
            "bits": u.get("bits"),
            "min_bits_vs_peers": u.get("min_bits_vs_peers"),
            "look_status": look_info.get("look_status"),
            "look_mae": look_info.get("look_mae"),
            "look_mae_max": look_info.get("look_mae_max"),
            "heads": u.get("heads"),
        }
        # Accept into the peer set only when we ship a usable file.
        if status not in ("corrupt", "uniqueness_fail") and os.path.exists(path):
            with kept_lock:
                kept_paths.append(path)

        emit(
            "done", index=i, status=status, quality=quality_info, filename=fname,
            uniqueness=u["uniqueness"], uniqueness_status=u["uniqueness_status"],
            uniqueness_metric=u["uniqueness_metric"], uniqueness_target=u["uniqueness_target"],
            escalated=escalated, preset_used=preset_used, strength_final=last_strength,
            look_status=look_info.get("look_status"),
            look_mae=look_info.get("look_mae"),
            look_src=look_info.get("look_src"),
            look_var=look_info.get("look_var"),
        )

        return VariantRecord(
            index=i, filename=fname, seed=vseed, params=r["params"], ffmpeg_cmd=r["cmd"],
            tier=2 if r["neural_ops"] else 1, neural_ops=r["neural_ops"],
            quality=quality_info,
            output_sha256=info.sha256, duration_s=info.duration_s,
            status=status,
            uniqueness=u["uniqueness"], uniqueness_status=u["uniqueness_status"],
            uniqueness_metric=u["uniqueness_metric"], uniqueness_target=u["uniqueness_target"],
            preset_used=preset_used, strength_final=last_strength, escalated=escalated,
            look_status=look_info.get("look_status"),
            look_mae=look_info.get("look_mae"),
            look_src=look_info.get("look_src"),
            look_var=look_info.get("look_var"),
        )

    indices = range(1, count + 1)
    if jobs > 1:
        with ThreadPoolExecutor(max_workers=jobs) as ex:
            records = list(ex.map(_render_one, indices))
    else:
        records = [_render_one(i) for i in indices]
    records.sort(key=lambda r: r.index)

    manifest = Manifest(source=src.to_dict(), run=run_meta, variants=records)
    manifest.write(os.path.join(out_dir, "manifest.json"))
    return manifest

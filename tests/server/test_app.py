import io
import json
import os
import zipfile

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.jobs import Job, JobSource, JobStore, VariantInfo
from variant_maker.server.workspace import Workspace


def test_health_ok():
    client = TestClient(create_app())
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "lab": False}


def test_health_lab_flag(monkeypatch):
    monkeypatch.setenv("VARIANT_LAB", "1")
    client = TestClient(create_app())
    assert client.get("/api/health").json() == {"status": "ok", "lab": True}


def _client(tmp_path, plan=None):
    store = JobStore(Workspace(str(tmp_path)), FakeRunner(plan or {}))
    return TestClient(create_app(store)), store


def test_create_job_returns_sources(tmp_path):
    client, store = _client(tmp_path)
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4")),
               ("files", ("b.mp4", b"y", "video/mp4"))],
        data={"count": "3"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["sources"]) == 2
    assert body["sources"][0]["requested"] == 3
    store.wait(body["job_id"], timeout=5)


def test_create_job_quality_mode_hq(tmp_path):
    client, store = _client(tmp_path)
    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1", "quality_mode": "hq"},
    )
    assert resp.status_code == 201
    store.wait(resp.json()["job_id"], timeout=5)
    assert store._runner.last_quality_mode == "hq"


def test_get_job_detail_shows_ok_variants_and_counts(tmp_path):
    client, store = _client(tmp_path, plan={2: "best_effort"})
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "3"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    detail = client.get(f"/api/jobs/{job_id}").json()
    src = detail["sources"][0]
    assert src["delivered"] == 2 and src["shortfall"] == 1
    assert [v["status"] for v in src["variants"]] == ["ok", "ok"]  # ok-only in cards


def test_get_unknown_job_404(tmp_path):
    client, _ = _client(tmp_path)
    assert client.get("/api/jobs/nope").status_code == 404


def test_queue_lists_running_jobs_without_videos(tmp_path):
    from tests.server.test_jobs import _PausingRunner

    runner = _PausingRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    client = TestClient(create_app(store))
    empty = client.get("/api/queue").json()
    assert empty == {"running": 0, "fast": 0, "hq": 0, "jobs": []}

    job_id = client.post(
        "/api/jobs",
        files=[("files", ("iphone.mov", b"x", "video/mp4"))],
        data={"count": "2", "quality_mode": "fast"},
    ).json()["job_id"]
    assert runner.v1_done.wait(timeout=5)
    body = client.get("/api/queue").json()
    assert body["running"] == 1
    assert body["fast"] == 1 and body["hq"] == 0
    item = body["jobs"][0]
    assert item["job_id"] == job_id
    assert item["quality_mode"] == "fast"
    assert item["filenames"] == ["iphone.mov"]
    assert item["requested"] == 2
    assert item["delivered"] >= 1
    assert item["position"] == 1
    assert "file_url" not in item
    assert "variants" not in item

    runner.gate.set()
    store.wait(job_id, timeout=5)
    assert client.get("/api/queue").json()["running"] == 0


def test_cancel_job_stops_running_pack(tmp_path):
    from tests.server.test_jobs import _PausingRunner

    runner = _PausingRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    client = TestClient(create_app(store))
    job_id = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "2"},
    ).json()["job_id"]
    assert runner.v1_done.wait(timeout=5)
    resp = client.post(f"/api/jobs/{job_id}/cancel")
    assert resp.status_code == 200
    store.wait(job_id, timeout=5)
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["state"] == "cancelled"
    assert "Cancelled" in (detail["error"] or "")


def test_cancel_unknown_job_404(tmp_path):
    client, _ = _client(tmp_path)
    assert client.post("/api/jobs/nope/cancel").status_code == 404


def test_sse_events_stream_until_job_done(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "2"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    # stream is replayable from the recorded event log after completion
    with client.stream("GET", f"/api/jobs/{job_id}/events") as r:
        payloads = []
        for line in r.iter_lines():
            if line.startswith("data:"):
                payloads.append(json.loads(line[len("data:"):].strip()))
                if payloads[-1].get("state") == "job-done":
                    break
    states = [p.get("state") for p in payloads]
    assert states.count("done") == 2
    assert states[-1] == "job-done"


def test_events_snapshot_returns_json_log(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "2"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    snap = client.get(f"/api/jobs/{job_id}/events-snapshot").json()
    assert snap["job_id"] == job_id
    assert snap["state"] == "done"
    states = [e.get("state") for e in snap["events"]]
    assert states.count("done") == 2
    assert "rendering" in states


def test_chunked_upload_then_create_job(tmp_path):
    client, store = _client(tmp_path)
    payload = b"fake-video-bytes-" * 1000
    init = client.post(
        "/api/uploads",
        data={"filename": "clip.mp4", "size": str(len(payload))},
    )
    assert init.status_code == 200
    upload_id = init.json()["upload_id"]
    mid = len(payload) // 2
    r1 = client.put(f"/api/uploads/{upload_id}?offset=0", content=payload[:mid])
    r2 = client.put(f"/api/uploads/{upload_id}?offset={mid}", content=payload[mid:])
    assert r1.status_code == 200 and r2.status_code == 200
    job = client.post(
        "/api/jobs/from-uploads",
        data={"upload_ids": upload_id, "count": "1", "allow_creative_escalate": "true"},
    )
    assert job.status_code == 201
    body = job.json()
    assert body["sources"][0]["filename"] == "clip.mp4"
    store.wait(body["job_id"], timeout=5)


def test_put_upload_client_disconnect_is_400(tmp_path, monkeypatch):
    from starlette.requests import ClientDisconnect, Request

    client, _store = _client(tmp_path)
    init = client.post(
        "/api/uploads",
        data={"filename": "clip.mp4", "size": "12"},
    )
    uid = init.json()["upload_id"]

    async def boom(self):
        raise ClientDisconnect()

    monkeypatch.setattr(Request, "body", boom)
    resp = client.put(f"/api/uploads/{uid}?offset=0", content=b"not-enough")
    assert resp.status_code == 400
    assert "Generate" in resp.json()["detail"]


def test_get_job_exposes_in_flight_from_event_log(tmp_path):
    from variant_maker.server.events import VariantEvent

    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None
    job.state = "running"
    sid = job.sources[0].source_id
    job.events.append(VariantEvent(source_id=sid, index=2, state="uniqueness"))
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["sources"][0]["in_flight"] == {
        "index": 2, "state": "uniqueness", "attempt": 0, "max_attempts": 0,
    }
    assert detail["sources"][0]["in_flights"] == [{
        "index": 2, "state": "uniqueness", "attempt": 0, "max_attempts": 0,
    }]


def test_get_job_exposes_parallel_in_flights(tmp_path):
    from variant_maker.server.events import VariantEvent

    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None
    job.state = "running"
    sid = job.sources[0].source_id
    job.events.append(VariantEvent(source_id=sid, index=1, state="rendering"))
    job.events.append(VariantEvent(source_id=sid, index=2, state="rendering"))
    detail = client.get(f"/api/jobs/{job_id}").json()
    flights = detail["sources"][0]["in_flights"]
    assert [f["index"] for f in flights] == [1, 2]
    assert {f["state"] for f in flights} == {"rendering"}
    assert detail["sources"][0]["in_flight"]["index"] == 2

    job.events.append(VariantEvent(
        source_id=sid, index=1, state="done", status="ok", filename="v01.mp4",
    ))
    detail = client.get(f"/api/jobs/{job_id}").json()
    flights = detail["sources"][0]["in_flights"]
    assert [f["index"] for f in flights] == [2]
    assert detail["sources"][0]["in_flight"]["index"] == 2


def test_done_job_does_not_keep_rendering_in_flight(tmp_path):
    from variant_maker.server.events import VariantEvent

    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None
    sid = job.sources[0].source_id
    job.events.append(VariantEvent(source_id=sid, index=1, state="rendering"))
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["state"] == "done"
    assert detail["sources"][0]["in_flight"] is None
    assert detail["sources"][0]["in_flights"] == []
    assert detail.get("error") in (None, "")


def test_get_job_exposes_look_preview_from_looking_event(tmp_path):
    from variant_maker.server.events import VariantEvent

    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None
    sid = job.sources[0].source_id
    preview = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["look_preview"]
    assert preview["look_src_url"] == f"/api/look/{sid}/look_v01_src.jpg"
    assert preview["look_var_url"] == f"/api/look/{sid}/look_v01.jpg"
    assert preview["look_status"] == "ok"
    job.state = "running"
    job.events.append(VariantEvent(
        source_id=sid, index=1, state="uniqueness",
    ))
    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["sources"][0]["in_flight"]["state"] == "uniqueness"
    assert detail["sources"][0]["look_preview"]["look_src_url"].endswith("look_v01_src.jpg")


def test_look_stills_served_and_non_jpg_rejected(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None
    sid = job.sources[0].source_id
    v = job.sources[0].variants[0]
    resp = client.get(f"/api/look/{sid}/{v.look_src}")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/jpeg")
    blocked = client.get(f"/api/look/{sid}/{v.filename}")
    assert blocked.status_code == 404


def test_gallery_groups_sources_ok_only(tmp_path):
    client, store = _client(tmp_path, plan={2: "best_effort"})
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "3"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    gallery = client.get("/api/gallery").json()
    assert len(gallery) == 1
    assert gallery[0]["delivered"] == 2
    assert gallery[0]["shortfall"] == 1
    assert gallery[0]["failed"] == 1
    assert gallery[0]["job_state"] == "done"
    assert all(v["status"] == "ok" for v in gallery[0]["variants"])
    assert gallery[0]["variants"][0]["uniqueness"] == 0.42


def test_gallery_hides_uniqueness_fail(tmp_path):
    """Under 19 bits is not a Drive/gallery ready file. It still counts as failed."""
    client, store = _client(tmp_path, plan={2: "uniqueness_fail"})
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "3"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    gallery = client.get("/api/gallery").json()
    assert gallery[0]["delivered"] == 2
    assert gallery[0]["shortfall"] == 1
    assert gallery[0]["failed"] == 1
    assert all(v["status"] == "ok" for v in gallery[0]["variants"])
    diag = client.get("/api/diagnostics").json()
    assert len(diag) == 1
    assert diag[0]["status"] == "uniqueness_fail"
    assert diag[0]["quality"]["bits"] == 12


def test_gallery_lists_newest_job_first(tmp_path):
    """Sources must sort by job created_utc, not filename or job-id order."""
    client, store = _client(tmp_path)
    older = client.post(
        "/api/jobs",
        files=[("files", ("apple.mp4", b"x", "video/mp4"))],
        data={"count": "1"},
    ).json()
    store.wait(older["job_id"], timeout=5)
    store.get(older["job_id"]).created_utc = "2026-01-01T00:00:00Z"

    newer = client.post(
        "/api/jobs",
        files=[("files", ("zebra.mp4", b"y", "video/mp4"))],
        data={"count": "1"},
    ).json()
    store.wait(newer["job_id"], timeout=5)
    store.get(newer["job_id"]).created_utc = "2026-08-18T12:00:00Z"

    gallery = client.get("/api/gallery").json()
    assert [s["filename"] for s in gallery] == ["zebra.mp4", "apple.mp4"]
    assert gallery[0]["created_utc"] == "2026-08-18T12:00:00Z"


def _write_gallery_manifest(tmp_path, job_id: str, source_id: str, filename: str, created_utc: str) -> None:
    out = tmp_path / "jobs" / job_id / source_id / "out"
    inn = tmp_path / "jobs" / job_id / source_id / "in"
    out.mkdir(parents=True)
    inn.mkdir(parents=True)
    (inn / filename).write_bytes(b"x")
    (out / "manifest.json").write_text(json.dumps({
        "created_utc": created_utc,
        "source": {"path": filename},
        "run": {"platform": "reels", "count": 1},
        "variants": [{
            "index": 1, "filename": "v01.mp4", "status": "ok",
            "quality": {"vmaf": 95},
        }],
    }))


def test_gallery_hydrated_jobs_sort_by_created_utc_not_job_id(tmp_path):
    """Restart hydrate walks job dirs alphabetically; gallery must still be newest-first."""
    _write_gallery_manifest(tmp_path, "aaa-old-id", "src-a", "apple.mp4", "2026-01-01T00:00:00Z")
    _write_gallery_manifest(tmp_path, "zzz-new-id", "src-z", "zebra.mp4", "2026-08-18T12:00:00Z")
    store = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store.hydrate_from_disk() == 2
    client = TestClient(create_app(store))
    gallery = client.get("/api/gallery").json()
    assert [s["filename"] for s in gallery] == ["zebra.mp4", "apple.mp4"]


def test_diagnostics_lists_non_ok(tmp_path):
    client, store = _client(tmp_path, plan={2: "best_effort", 3: "best_effort"})
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "3"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    diag = client.get("/api/diagnostics").json()
    assert len(diag) == 2
    assert all(d["status"] == "best_effort" for d in diag)


def test_done_events_carry_uniqueness_fields(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    snap = client.get(f"/api/jobs/{job_id}/events-snapshot").json()
    done = [e for e in snap["events"] if e.get("state") == "done"]
    assert len(done) == 1
    assert done[0]["uniqueness"] == 0.42
    assert done[0]["uniqueness_status"] == "ok"
    assert done[0]["uniqueness_metric"] == "ssim_bits_v1"
    assert done[0]["uniqueness_target"] == 24 / 64


def test_serve_variant_and_source_files(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"orig", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    fname = src["variants"][0]["filename"]
    sid = src["source_id"]
    assert client.get(f"/api/variants/{sid}/{fname}").status_code == 200
    assert client.get(f"/api/sources/{sid}/source").content == b"orig"
    assert client.get("/api/variants/nope/x.mp4").status_code == 404


def test_hashtag_variant_filename_encodes_file_url(tmp_path):
    """TikTok-style stems include #fyp — unquoted URLs never load a thumb."""
    import os
    from urllib.parse import unquote

    client, store = _client(tmp_path)
    job_id = client.post(
        "/api/jobs",
        files=[("files", ("clip.mp4", b"orig", "video/mp4"))],
        data={"count": "1"},
    ).json()["job_id"]
    store.wait(job_id, timeout=5)
    job = store.get(job_id)
    source = job.sources[0]
    variant = source.variants[0]
    old = store.find_variant(source.source_id, variant.filename)
    new_name = "Age is just a number #fyp_v01.mp4"
    os.rename(old, os.path.join(os.path.dirname(old), new_name))
    variant.filename = new_name

    url = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["variants"][0]["file_url"]
    assert "%23" in url
    assert "#" not in url
    assert unquote(url.rsplit("/", 1)[-1]) == new_name
    assert client.get(url).status_code == 200


def test_regenerate_endpoint(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "2"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    sid = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["source_id"]
    resp = client.post(f"/api/sources/{sid}/regenerate", data={"n": "2"})
    assert resp.status_code == 200
    assert resp.json()["delivered"] == 4  # 2 initial + 2 regenerated, all ok under FakeRunner
    assert client.post("/api/sources/nope/regenerate", data={"n": "1"}).status_code == 404


def test_get_job_detail_includes_uniqueness_fields(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    v = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["variants"][0]
    assert v["uniqueness"] == 0.42
    assert v["uniqueness_status"] == "ok"
    assert v["uniqueness_metric"] == "ssim_bits_v1"
    assert v["uniqueness_target"] == 24 / 64
    assert v["preset_used"] == "medium"
    assert v["strength_final"] == 1.0
    assert v["escalated"] is False
    assert v["platform_result"] is None
    assert v.get("post_url") in (None, "")


def test_platform_result_roundtrip(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    sid = src["source_id"]
    index = src["variants"][0]["index"]

    resp = client.post(f"/api/variants/{sid}/{index}/platform-result",
                       json={"result": "passed"})
    assert resp.status_code == 200
    assert resp.json()["platform_result"] == "passed"

    detail = client.get(f"/api/jobs/{job_id}").json()
    assert detail["sources"][0]["variants"][0]["platform_result"] == "passed"

    assert client.post(f"/api/variants/{sid}/999/platform-result",
                       json={"result": "passed"}).status_code == 404
    assert client.post(f"/api/variants/nope/{index}/platform-result",
                       json={"result": "passed"}).status_code == 404
    assert client.post(f"/api/variants/{sid}/{index}/platform-result",
                       json={"result": "bogus"}).status_code == 422


def test_post_url_roundtrip_and_persist(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "1"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    sid = src["source_id"]
    index = src["variants"][0]["index"]

    url = "https://www.tiktok.com/@va/video/99"
    resp = client.post(f"/api/variants/{sid}/{index}/post-url", json={"url": url})
    assert resp.status_code == 200
    assert resp.json()["post_url"] == url
    assert client.get(f"/api/jobs/{job_id}").json()["sources"][0]["variants"][0]["post_url"] == url

    # Survive Studio restart via job.json
    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    restored = store2.get(job_id).sources[0].variants[0]
    assert restored.post_url == url

    cleared = client.post(f"/api/variants/{sid}/{index}/post-url", json={"url": "  "})
    assert cleared.status_code == 200
    assert cleared.json()["post_url"] is None

    assert client.post(f"/api/variants/{sid}/{index}/post-url",
                       json={"url": "javascript:alert(1)"}).status_code == 400
    assert client.post(f"/api/variants/{sid}/999/post-url",
                       json={"url": url}).status_code == 404


def test_variant_caption_roundtrip_and_persist(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post(
        "/api/jobs",
        files=[("files", ("boil.mp4", b"x", "video/mp4"))],
        data={"count": "1", "generate_captions": "true", "caption_prompt": "POV boil #reels"},
    ).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    sid = src["source_id"]
    index = src["variants"][0]["index"]

    text = "Wait — the boil hits different\n#reels #fyp"
    resp = client.post(f"/api/variants/{sid}/{index}/caption", json={"caption": text})
    assert resp.status_code == 200
    assert resp.json()["caption"] == text
    assert client.get(f"/api/jobs/{job_id}").json()["sources"][0]["variants"][0]["caption"] == text

    store2 = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    assert store2.hydrate_from_disk() == 1
    assert store2.get(job_id).sources[0].variants[0].caption == text

    cleared = client.post(f"/api/variants/{sid}/{index}/caption", json={"caption": "  "})
    assert cleared.status_code == 200
    assert cleared.json()["caption"] is None
    assert client.post(f"/api/variants/{sid}/999/caption", json={"caption": text}).status_code == 404


def test_variant_caption_api_strips_copy_n_of_m(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post(
        "/api/jobs",
        files=[("files", ("boil.mp4", b"x", "video/mp4"))],
        data={"count": "1"},
    ).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    sid = src["source_id"]
    index = src["variants"][0]["index"]
    resp = client.post(
        f"/api/variants/{sid}/{index}/caption",
        json={"caption": "POV boil\n\nCopy 1 of 20\n#reels"},
    )
    assert resp.status_code == 200
    assert resp.json()["caption"] == "POV boil\n\n#reels"
    listed = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["variants"][0]["caption"]
    assert listed == "POV boil\n\n#reels"
    assert "copy 1 of" not in listed.lower()


def test_rewrite_source_captions_http(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post(
        "/api/jobs",
        files=[("files", ("boil.mp4", b"x", "video/mp4"))],
        data={"count": "2", "generate_captions": "true", "caption_prompt": "POV boil #reels"},
    ).json()["job_id"]
    store.wait(job_id, timeout=5)
    sid = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["source_id"]
    resp = client.post(f"/api/sources/{sid}/captions", json={"prompt": "Gym pump #fyp"})
    assert resp.status_code == 200
    caps = [v.get("caption") or "" for v in resp.json()["variants"]]
    assert len(caps) == 2
    assert caps[0] != caps[1]
    assert resp.json()["caption_prompt"] == "Gym pump #fyp"
    assert "copy 1 of" not in "\n".join(caps).lower()


def test_zip_contains_ok_variants(tmp_path):
    client, store = _client(tmp_path, plan={2: "best_effort"})
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "3"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    sid = src["source_id"]
    ok_filenames = {v["filename"] for v in src["variants"]}

    resp = client.get(f"/api/sources/{sid}/zip")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"

    import io
    zf = zipfile.ZipFile(io.BytesIO(resp.content))
    assert set(zf.namelist()) == ok_filenames

    assert client.get("/api/sources/nope/zip").status_code == 404


def test_zip_404_when_ok_variants_are_missing_from_disk(tmp_path):
    """Don't ship a 22-byte empty zip when Gallery metadata exists but files never landed."""
    client, store = _client(tmp_path)
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "2"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    sid = src["source_id"]
    loc = store._locate(sid)
    assert loc is not None
    job_id, source = loc
    out_dir = store._ws.source_out_dir(job_id, sid)
    for v in source.variants:
        path = os.path.join(out_dir, v.filename)
        if os.path.isfile(path):
            os.remove(path)
    resp = client.get(f"/api/sources/{sid}/zip")
    assert resp.status_code == 404
    assert len(resp.content) != 22


def test_zip_and_file_routes_pull_missing_outputs_from_object_store(tmp_path):
    """GPU finished (job.json has variants) but Railway never copied mp4s — fetch from R2."""
    from tests.server.fakes import FakeObjectStore, FakeRunPodClient
    from variant_maker.server.runpod_runner import RunPodServerlessRunner

    blobstore = FakeObjectStore()
    ws = Workspace(str(tmp_path))
    runner = RunPodServerlessRunner(blobstore, FakeRunPodClient([]))
    store = JobStore(ws, runner)
    client = TestClient(create_app(store))

    job_id = "jobpull01"
    source_id = "srcpull01"
    out_dir = ws.source_out_dir(job_id, source_id)
    os.makedirs(out_dir, exist_ok=True)
    payload = b"FAKE-MP4-BYTES-NOT-EMPTY"
    staged = tmp_path / "staged.mp4"
    staged.write_bytes(payload)
    blobstore.put(f"outputs/{source_id}/v01.mp4", str(staged))

    job = Job(
        job_id=job_id, count=1, created_utc="2026-08-18T00:00:00Z",
        sources=[JobSource(
            source_id=source_id, filename="clip.mp4", requested=1,
            variants=[VariantInfo(
                source_id=source_id, index=1, filename="v01.mp4", status="ok",
                quality={"vmaf": 99.0},
            )],
        )],
        state="done",
    )
    store._install_hydrated_job(job)

    file_resp = client.get(f"/api/variants/{source_id}/v01.mp4")
    assert file_resp.status_code == 200
    assert file_resp.content == payload
    zip_resp = client.get(f"/api/sources/{source_id}/zip")
    assert zip_resp.status_code == 200
    assert len(zip_resp.content) > 22
    zf = zipfile.ZipFile(io.BytesIO(zip_resp.content))
    assert zf.namelist() == ["v01.mp4"]


class _CountingFetchRunner(FakeRunner):
    def __init__(self):
        super().__init__()
        self.fetches = 0

    def fetch_outputs(self, source_id, out_dir, filenames):
        self.fetches += 1
        return 0


def test_gallery_reports_missing_files_without_pulling_object_store(tmp_path):
    """Listing Gallery must not stall on R2; show files_ready from disk only."""
    runner = _CountingFetchRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    client = TestClient(create_app(store))
    job_id = client.post("/api/jobs",
                         files=[("files", ("a.mp4", b"x", "video/mp4"))],
                         data={"count": "2"}).json()["job_id"]
    store.wait(job_id, timeout=5)
    src = client.get(f"/api/jobs/{job_id}").json()["sources"][0]
    assert src["files_ready"] == 2
    assert src["copy_status"] == "ok"
    assert all(v["file_ready"] is True for v in src["variants"])

    loc = store._locate(src["source_id"])
    assert loc is not None
    out_dir = store._ws.source_out_dir(loc[0], src["source_id"])
    for v in src["variants"]:
        os.remove(os.path.join(out_dir, v["filename"]))
    before = runner.fetches
    gallery = client.get("/api/gallery").json()
    assert runner.fetches == before
    assert gallery[0]["delivered"] == 2
    assert gallery[0]["files_ready"] == 0
    assert gallery[0]["copy_status"] == "missing"
    assert all(v["file_ready"] is False for v in gallery[0]["variants"])


def test_retry_copy_endpoint_pulls_from_object_store(tmp_path):
    from tests.server.fakes import FakeObjectStore, FakeRunPodClient
    from variant_maker.server.runpod_runner import RunPodServerlessRunner

    blobstore = FakeObjectStore()
    ws = Workspace(str(tmp_path))
    runner = RunPodServerlessRunner(blobstore, FakeRunPodClient([]))
    store = JobStore(ws, runner)
    client = TestClient(create_app(store))

    job_id, source_id = "jobapi01", "srcapi01"
    out_dir = ws.source_out_dir(job_id, source_id)
    os.makedirs(out_dir, exist_ok=True)
    payload = b"RETRY-COPY-API"
    staged = tmp_path / "staged.mp4"
    staged.write_bytes(payload)
    blobstore.put(f"outputs/{source_id}/v01.mp4", str(staged))

    job = Job(
        job_id=job_id, count=1, created_utc="2026-08-18T00:00:00Z",
        sources=[JobSource(
            source_id=source_id, filename="clip.mp4", requested=1,
            variants=[VariantInfo(
                source_id=source_id, index=1, filename="v01.mp4", status="ok",
                quality={"vmaf": 99.0},
            )],
        )],
        state="done",
    )
    store._install_hydrated_job(job)
    os.remove(os.path.join(out_dir, "v01.mp4"))

    missing = client.get("/api/gallery").json()[0]
    assert missing["copy_status"] == "missing"
    assert missing["files_ready"] == 0

    resp = client.post(f"/api/sources/{source_id}/retry-copy")
    assert resp.status_code == 200
    body = resp.json()
    assert body["copy_status"] == "ok"
    assert body["files_ready"] == 1
    assert body["variants"][0]["file_ready"] is True
    assert client.get(f"/api/variants/{source_id}/v01.mp4").content == payload
    assert client.post("/api/sources/nope/retry-copy").status_code == 404


def test_delete_source_endpoint_removes_gallery_card(tmp_path):
    client, store = _client(tmp_path)
    job_id = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1"},
    ).json()["job_id"]
    store.wait(job_id, timeout=5)
    sid = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["source_id"]
    assert client.get("/api/gallery").json()[0]["source_id"] == sid
    resp = client.delete(f"/api/sources/{sid}")
    assert resp.status_code == 204
    assert client.get("/api/gallery").json() == []
    assert client.get(f"/api/jobs/{job_id}").status_code == 404
    assert client.delete("/api/sources/nope").status_code == 404


def test_cli_build_app_serves_health(tmp_path):
    from variant_maker.server.cli import build_app
    client = TestClient(build_app(str(tmp_path)))
    assert client.get("/api/health").json() == {"status": "ok", "lab": False}


def test_make_runner_local():
    from variant_maker.server.cli import make_runner
    from variant_maker.server.runner import LocalRunner
    assert isinstance(make_runner("local"), LocalRunner)


def test_make_runner_runpod_from_env(monkeypatch):
    from variant_maker.server import cli
    from variant_maker.server.runner import LocalRunner, RoutingRunner
    from variant_maker.server.runpod_runner import RunPodServerlessRunner
    # avoid real boto3/httpx construction
    monkeypatch.setattr(cli, "S3ObjectStore", lambda **kw: object())
    monkeypatch.setattr(cli, "HttpRunPodClient", lambda **kw: object())
    monkeypatch.delenv("RUNPOD_FAST_ENDPOINT_ID", raising=False)
    for k, v in {"RUNPOD_ENDPOINT_ID": "ep", "RUNPOD_API_KEY": "k",
                 "R2_ENDPOINT": "https://r2", "R2_BUCKET": "b",
                 "R2_ACCESS_KEY": "a", "R2_SECRET_KEY": "s"}.items():
        monkeypatch.setenv(k, v)
    runner = cli.make_runner("runpod")
    assert isinstance(runner, RoutingRunner)
    assert isinstance(runner._remote, RunPodServerlessRunner)
    assert isinstance(runner._local, LocalRunner)
    assert runner._fast_remote is None


def test_make_runner_runpod_wires_fast_endpoint(monkeypatch):
    from variant_maker.server import cli
    from variant_maker.server.runner import RoutingRunner
    from variant_maker.server.runpod_runner import RunPodServerlessRunner
    clients = []
    monkeypatch.setattr(cli, "S3ObjectStore", lambda **kw: object())
    monkeypatch.setattr(cli, "HttpRunPodClient", lambda **kw: clients.append(kw) or object())
    for k, v in {"RUNPOD_ENDPOINT_ID": "ep-gpu", "RUNPOD_API_KEY": "k",
                 "RUNPOD_FAST_ENDPOINT_ID": "ep-fast",
                 "R2_ENDPOINT": "https://r2", "R2_BUCKET": "b",
                 "R2_ACCESS_KEY": "a", "R2_SECRET_KEY": "s"}.items():
        monkeypatch.setenv(k, v)
    runner = cli.make_runner("runpod")
    assert isinstance(runner, RoutingRunner)
    assert isinstance(runner._remote, RunPodServerlessRunner)
    assert isinstance(runner._fast_remote, RunPodServerlessRunner)
    assert [c["endpoint_id"] for c in clients] == ["ep-gpu", "ep-fast"]


def test_make_runner_runpod_missing_env_exits(monkeypatch):
    from variant_maker.server import cli
    for k in ("RUNPOD_ENDPOINT_ID", "RUNPOD_API_KEY", "R2_ENDPOINT", "R2_BUCKET",
              "R2_ACCESS_KEY", "R2_SECRET_KEY"):
        monkeypatch.delenv(k, raising=False)
    import pytest
    with pytest.raises(SystemExit):
        cli.make_runner("runpod")


def test_resolve_runner_auto_runpod_when_env_complete(monkeypatch):
    from variant_maker.server import cli
    for k, v in {"RUNPOD_ENDPOINT_ID": "ep", "RUNPOD_API_KEY": "k",
                 "R2_ENDPOINT": "https://r2", "R2_BUCKET": "b",
                 "R2_ACCESS_KEY": "a", "R2_SECRET_KEY": "s"}.items():
        monkeypatch.setenv(k, v)
    assert cli.resolve_runner(None) == "runpod"


def test_resolve_runner_auto_local_when_env_incomplete(monkeypatch):
    from variant_maker.server import cli
    for k in ("RUNPOD_ENDPOINT_ID", "RUNPOD_API_KEY", "R2_ENDPOINT", "R2_BUCKET",
              "R2_ACCESS_KEY", "R2_SECRET_KEY"):
        monkeypatch.delenv(k, raising=False)
    assert cli.resolve_runner(None) == "local"
    assert cli.resolve_runner("runpod") == "runpod"


def test_create_job_generate_captions_attaches_copy(tmp_path):
    client, store = _client(tmp_path)
    resp = client.post(
        "/api/jobs",
        files=[("files", ("boil.mp4", b"x", "video/mp4"))],
        data={"count": "2", "generate_captions": "true", "caption_prompt": "POV boil #reels"},
    )
    assert resp.status_code == 201
    job_id = resp.json()["job_id"]
    store.wait(job_id, timeout=5)
    variants = client.get(f"/api/jobs/{job_id}").json()["sources"][0]["variants"]
    captions = [v.get("caption") or "" for v in variants if v["status"] == "ok"]
    assert captions
    assert captions[0] != captions[1]
    joined = "\n".join(captions).lower()
    assert "copy 1 of" not in joined


def test_create_job_caption_prompts_json_is_per_source(tmp_path):
    client, store = _client(tmp_path)
    resp = client.post(
        "/api/jobs",
        files=[
            ("files", ("boil.mp4", b"x", "video/mp4")),
            ("files", ("gym.mp4", b"y", "video/mp4")),
        ],
        data={
            "count": "1",
            "generate_captions": "true",
            "caption_prompts": '["POV boil #reels","Gym pull #fyp"]',
        },
    )
    assert resp.status_code == 201
    job_id = resp.json()["job_id"]
    store.wait(job_id, timeout=5)
    sources = client.get(f"/api/jobs/{job_id}").json()["sources"]
    boil = sources[0]["variants"][0].get("caption") or ""
    gym = sources[1]["variants"][0].get("caption") or ""
    assert "boil" in boil.lower()
    assert "gym" in gym.lower()
    assert "copy 1 of" not in boil.lower()

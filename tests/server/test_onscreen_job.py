"""Studio burns on-screen text after the worker returns the file."""
import json

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from variant_maker.server.app import create_app
from variant_maker.server.jobs import JobStore
from variant_maker.server.models import JobFromDriveIn
from variant_maker.server.workspace import Workspace

PROJECT = {
    "captions": [{
        "id": "1",
        "text": "Sale",
        "box_ids": ["A"],
    }],
    "boxes": [{"id": "A", "x": 0.1, "y": 0.2, "w": 0.5, "h": 0.2}],
    "look": {"style": "classic", "background": "solid", "color": "#FFFFFF"},
}


class _RecordingRunner(FakeRunner):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[dict] = []

    def run(self, source_path: str, **kwargs):
        self.calls.append(kwargs)
        result = super().run(source_path, **kwargs)
        for variant in result.variants:
            with open(variant.path, "wb") as fh:
                fh.write(b"mp4-bytes")
        return result


class _Probe:
    width = 1080
    height = 1920
    color = None


def _patch_burn(monkeypatch):
    burned: list[tuple[str, str]] = []

    def burn(path, placement, width, height, color=None):
        burned.append((path, placement["text"]))
        with open(path, "ab") as fh:
            fh.write(b"BURNED")

    monkeypatch.setattr("variant_maker.onscreen.fonts_ready", lambda: True)
    monkeypatch.setattr("variant_maker.onscreen.burn_file", burn)
    monkeypatch.setattr("variant_maker.onscreen.write_text_poster", lambda *args, **kwargs: None)
    monkeypatch.setattr("variant_maker.probe.probe", lambda path: _Probe())
    return burned


def test_job_burns_after_run_and_regenerate_without_telling_the_worker(tmp_path, monkeypatch):
    burned = _patch_burn(monkeypatch)
    runner = _RecordingRunner()
    store = JobStore(Workspace(str(tmp_path)), runner)
    job = store.create_job([("a.mp4", b"x")], count=1, onscreen=PROJECT)
    assert job.onscreen["captions"][0]["text"] == "Sale"
    assert job.sources[0].onscreen["captions"][0]["text"] == "Sale"
    assert store.wait(job.job_id, timeout=5)
    assert job.error is None, job.error
    assert job.sources[0].variants[0].quality["onscreen"]["text"] == "Sale"
    assert burned and burned[0][1] == "Sale"
    with open(burned[0][0], "rb") as fh:
        assert b"BURNED" in fh.read()
    assert runner.calls
    assert all("onscreen" not in call for call in runner.calls)

    fresh = JobStore(Workspace(str(tmp_path)), FakeRunner())
    assert fresh.hydrate_from_disk() == 1
    loaded = fresh.get(job.job_id)
    assert loaded is not None
    assert loaded.onscreen["captions"][0]["text"] == "Sale"
    assert loaded.sources[0].onscreen["captions"][0]["text"] == "Sale"

    assert store.regenerate(job.sources[0].source_id, 1) is not None
    assert store.wait(job.job_id, timeout=5)
    assert job.error is None, job.error
    assert len(burned) == 2
    assert job.sources[0].variants[-1].quality["onscreen"]["text"] == "Sale"
    assert all("onscreen" not in call for call in runner.calls)


def test_job_routes_accept_onscreen_and_templates(tmp_path, monkeypatch):
    _patch_burn(monkeypatch)
    store = JobStore(Workspace(str(tmp_path)), FakeRunner())
    original = store._runner.run

    def run(*args, **kwargs):
        result = original(*args, **kwargs)
        for variant in result.variants:
            with open(variant.path, "wb") as fh:
                fh.write(b"mp4-bytes")
        return result

    store._runner.run = run
    client = TestClient(create_app(store))

    saved = client.post(
        "/api/onscreen/templates",
        json={"name": "Hook", "project": PROJECT},
    )
    assert saved.status_code == 201, saved.text
    template_id = saved.json()["id"]
    listed = client.get("/api/onscreen/templates")
    assert listed.status_code == 200
    assert listed.json()["templates"][0]["name"] == "Hook"
    assert client.get("/api/onscreen/beds/missing").status_code == 404

    resp = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={
            "count": "1",
            "export_destination_id": "",
            "onscreen": json.dumps(PROJECT),
        },
    )
    assert resp.status_code == 201, resp.text
    job_id = resp.json()["job_id"]
    assert store.wait(job_id, timeout=5)
    job = store.get(job_id)
    assert job is not None and job.error is None
    assert job.sources[0].variants[0].quality["onscreen"]["text"] == "Sale"
    assert job.export_destination_id is None

    bad = client.post(
        "/api/jobs",
        files=[("files", ("a.mp4", b"x", "video/mp4"))],
        data={"count": "1", "onscreen": "not-json"},
    )
    assert bad.status_code == 400

    removed = client.delete(f"/api/onscreen/templates/{template_id}")
    assert removed.status_code == 204
    assert client.get("/api/onscreen/templates").json()["templates"] == []


def test_drive_model_keeps_export_destination_and_onscreens():
    body = JobFromDriveIn(
        destination_id="dst_in",
        file_ids=["f1"],
        count=8,
        export_destination_id="dst_out",
        onscreen=PROJECT,
        onscreens=[PROJECT],
    )
    assert body.export_destination_id == "dst_out"
    assert body.onscreen["captions"][0]["text"] == "Sale"
    assert body.onscreens[0]["captions"][0]["text"] == "Sale"

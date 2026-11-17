import json
import threading
from concurrent.futures import ThreadPoolExecutor

from tests.server.fakes import FakeRunner
from variant_maker.server.jobs import Job, JobStore
from variant_maker.server.workspace import Workspace


def test_concurrent_persist_uses_independent_temp_files(tmp_path, monkeypatch):
    store = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    job = Job("concurrent", 1, "2026-11-17T00:00:00Z", state="done")
    store._jobs[job.job_id] = job
    barrier = threading.Barrier(2)
    original_dump = json.dump

    def simultaneous_dump(*args, **kwargs):
        original_dump(*args, **kwargs)
        barrier.wait(timeout=5)

    monkeypatch.setattr(json, "dump", simultaneous_dump)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(store._persist, job) for _ in range(2)]
        for future in futures:
            future.result(timeout=10)
    path = store._ws.job_meta_path(job.job_id)
    with open(path) as f:
        assert json.load(f)["job_id"] == job.job_id
    assert not list(tmp_path.rglob("*.tmp"))


def test_persist_deleted_job_does_not_recreate_snapshot(tmp_path):
    store = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    job = Job("deleted", 1, "2026-11-17T00:00:00Z", state="done")
    store._persist(job)
    assert not list(tmp_path.rglob("job.json"))
    assert not list(tmp_path.rglob("*.tmp"))


def test_persist_serialization_failure_cleans_temp_file(tmp_path, monkeypatch):
    import pytest
    store = JobStore(Workspace(str(tmp_path)), FakeRunner({}))
    job = Job("failure", 1, "2026-11-17T00:00:00Z", state="done")
    store._jobs[job.job_id] = job

    def broken_dump(*args, **kwargs):
        raise ValueError("serialization failure")

    monkeypatch.setattr(json, "dump", broken_dump)
    with pytest.raises(ValueError, match="serialization failure"):
        store._persist(job)
    assert not list(tmp_path.rglob("*.tmp"))

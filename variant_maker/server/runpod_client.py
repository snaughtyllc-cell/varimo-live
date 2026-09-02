"""RunPod serverless client seam: submit a job and stream its output chunks."""
from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Protocol


class RunPodClient(Protocol):
    def stream_run(self, payload: dict, cancel_token=None) -> Iterator[dict]: ...


def _http():
    import httpx  # lazy: only the real client needs it
    # Generate jobs can sit in queue for minutes; each poll should still return quickly,
    # but a 60s global timeout is too tight around GPU cold start.
    return httpx.Client(timeout=httpx.Timeout(10.0, read=300.0))


def _is_result(chunk: dict) -> bool:
    return isinstance(chunk, dict) and chunk.get("type") == "result"


def _as_chunks(payload) -> list[dict]:
    """Unwrap RunPod stream/status envelopes into progress/result chunks.

    `/stream` may complete with an empty `stream` while the last yield sits on
    `output` (or only on `/status` when `return_aggregate_stream` is on).
    """
    if payload is None:
        return []
    if isinstance(payload, dict):
        if payload.get("type") in ("progress", "result"):
            return [payload]
        inner = payload.get("output")
        if inner is not None and inner is not payload:
            return _as_chunks(inner)
        stream = payload.get("stream")
        if isinstance(stream, list):
            chunks: list[dict] = []
            for item in stream:
                if isinstance(item, dict):
                    chunks.extend(_as_chunks(item.get("output", item)))
            return chunks
        return []
    if isinstance(payload, list):
        chunks: list[dict] = []
        for item in payload:
            chunks.extend(_as_chunks(item))
        return chunks
    return []


class HttpRunPodClient:
    def __init__(self, *, endpoint_id: str, api_key: str,
                 base_url: str = "https://api.runpod.ai/v2", poll_interval: float = 1.0) -> None:
        self._base = f"{base_url}/{endpoint_id}"
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._poll = poll_interval

    def stream_run(self, payload: dict, cancel_token=None) -> Iterator[dict]:
        from .cancel import JobCancelled

        with _http() as http:
            if cancel_token is not None and cancel_token.is_set():
                raise JobCancelled()
            resp = http.post(f"{self._base}/run", json=payload, headers=self._headers)
            resp.raise_for_status()
            job_id = resp.json()["id"]
            yield from self._poll_stream(http, job_id, cancel_token)

    def stream_resume(self, job_id: str, cancel_token=None) -> Iterator[dict]:
        from .cancel import JobCancelled

        with _http() as http:
            if cancel_token is not None and cancel_token.is_set():
                raise JobCancelled()
            yield from self._poll_stream(http, job_id, cancel_token)

    def _poll_stream(self, http, job_id: str, cancel_token=None) -> Iterator[dict]:
        from .cancel import JobCancelled

        if cancel_token is not None:
            cancel_token.bind_runpod(job_id, self._base, self._headers)
            if cancel_token.is_set():
                raise JobCancelled()
        saw_result = False
        while True:
            if cancel_token is not None and cancel_token.is_set():
                cancel_token.cancel()
                raise JobCancelled()
            r = http.get(f"{self._base}/stream/{job_id}", headers=self._headers)
            r.raise_for_status()
            body = r.json()
            for item in body.get("stream") or []:
                chunk = item.get("output") if isinstance(item, dict) else None
                if not isinstance(chunk, dict):
                    continue
                if _is_result(chunk):
                    saw_result = True
                yield chunk
            status = body.get("status")
            if status in ("COMPLETED", "FAILED", "CANCELLED"):
                if status == "CANCELLED":
                    raise JobCancelled()
                if status != "COMPLETED":
                    raise RuntimeError(f"RunPod job {job_id} ended: {status}")
                if not saw_result:
                    for extra in self._completed_result(http, job_id, body):
                        if _is_result(extra):
                            saw_result = True
                        yield extra
                return
            if self._poll:
                time.sleep(self._poll)

    def _completed_result(self, http, job_id: str, body: dict) -> Iterator[dict]:
        extras = [c for c in _as_chunks(body) if isinstance(c, dict)]
        results = [c for c in extras if _is_result(c)]
        if results:
            yield from results
            return
        try:
            r = http.get(f"{self._base}/status/{job_id}", headers=self._headers)
            r.raise_for_status()
            status_chunks = [c for c in _as_chunks(r.json()) if isinstance(c, dict)]
        except Exception as exc:
            print(
                f"runpod status {job_id}: {type(exc).__name__}: {exc}",
                flush=True,
            )
            return
        results = [c for c in status_chunks if _is_result(c)]
        if results:
            yield from results
            return
        yield from status_chunks

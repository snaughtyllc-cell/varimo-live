"""Instagram Connect: many tester accounts, OAuth stores the token (no paste)."""
from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from tests.server.fakes import FakeRunner
from tests.server.test_auth_app import _env, _exchange, _login
from variant_maker.server.app import create_app
from variant_maker.server.instagram_oauth import (
    ENV_APP_ID,
    ENV_APP_SECRET,
    ENV_REDIRECT_URI,
    InstagramAccountStore,
    InstagramOAuthPendingStore,
    build_authorization_url,
    status_payload,
)
from variant_maker.server.jobs import JobStore
from variant_maker.server.tenants import can_manage_instagram, tenant_root
from variant_maker.server.workspace import Workspace


def test_workspace_instagram_dir(tmp_path):
    ws = Workspace(str(tmp_path))
    path = ws.instagram_dir()
    assert path.endswith(("instagram", "instagram"))
    pending = ws.instagram_pending_path()
    assert pending.endswith(("instagram/oauth_pending.json", "instagram\\oauth_pending.json"))


def test_account_store_adds_second_handle_without_replacing(tmp_path):
    store = InstagramAccountStore(str(tmp_path / "instagram"))
    store.save({"user_id": "111", "username": "maya.main", "access_token": "tok-a"})
    store.save({"user_id": "222", "username": "maya.trial", "access_token": "tok-b"})
    names = [a.username for a in store.list_accounts()]
    assert names == ["maya.main", "maya.trial"]
    store.remove("111")
    left = store.list_accounts()
    assert [a.username for a in left] == ["maya.trial"]
    assert store.load("222")["access_token"] == "tok-b"


def test_build_authorization_url_uses_instagram_login():
    url = build_authorization_url(
        client_id="ig-app",
        redirect_uri="https://lab.example/api/instagram/oauth/callback",
        state="st1",
    )
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    assert parsed.netloc == "www.instagram.com"
    assert qs["client_id"] == ["ig-app"]
    assert qs["redirect_uri"] == ["https://lab.example/api/instagram/oauth/callback"]
    assert qs["response_type"] == ["code"]
    assert "instagram_business_basic" in qs["scope"][0]
    assert "instagram_business_manage_insights" in qs["scope"][0]
    assert qs["force_reauth"] == ["true"]


def test_status_lists_every_connected_account(tmp_path):
    store = InstagramAccountStore(str(tmp_path))
    store.save({"user_id": "1", "username": "main", "access_token": "a"})
    body = status_payload(store, {ENV_APP_ID: "id", ENV_APP_SECRET: "sec"})
    assert body["connected"] is True
    assert body["oauth_available"] is True
    assert body["accounts"][0]["username"] == "main"
    assert "token" not in json.dumps(body["accounts"])


def test_can_manage_instagram_is_owner_or_admin_not_vas():
    assert can_manage_instagram(
        email="va@x.com", role="member", admin_email="jeff@x.com", auth_on=True,
    ) is False
    assert can_manage_instagram(
        email="owner@x.com", role="owner", admin_email="jeff@x.com", auth_on=True,
    ) is True
    assert can_manage_instagram(
        email="jeff@x.com", role="member", admin_email="jeff@x.com", auth_on=True,
    ) is True
    assert can_manage_instagram(
        email=None, role=None, admin_email="jeff@x.com", auth_on=True,
    ) is False
    assert can_manage_instagram(
        email="va@x.com", role="member", admin_email="jeff@x.com", auth_on=False,
    ) is True


def _ig_app(tmp_path, *, exchange=None, fetch_profile=None, list_media=None, fetch_insights=None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    env = {
        ENV_APP_ID: "ig-app-id",
        ENV_APP_SECRET: "ig-app-secret",
        ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
    }
    app = create_app(
        store,
        sa_json_path="",
        instagram_environ=env,
        instagram_exchange=exchange,
        instagram_fetch_profile=fetch_profile,
        instagram_list_media=list_media,
        instagram_fetch_insights=fetch_insights,
    )
    return TestClient(app), ws


def test_oauth_start_redirects_to_instagram(tmp_path):
    client, _ = _ig_app(tmp_path)
    resp = client.get("/api/instagram/oauth/start", follow_redirects=False)
    assert resp.status_code in (302, 307)
    loc = resp.headers["location"]
    assert "instagram.com" in loc
    assert "ig-app-id" in loc


def test_oauth_start_503_when_app_not_configured(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    client = TestClient(create_app(store, sa_json_path="", instagram_environ={}))
    resp = client.get("/api/instagram/oauth/start", follow_redirects=False)
    assert resp.status_code == 503


def test_oauth_callback_adds_account_and_keeps_an_existing_one(tmp_path):
    def fake_exchange(*, code, client_id, client_secret, redirect_uri):
        assert code == "auth-ig-1"
        return {"access_token": "long-1", "user_id": "17841"}

    def fake_profile(token):
        assert token == "long-1"
        return {"user_id": "17841", "username": "maya.growth", "name": "Maya"}

    client, ws = _ig_app(tmp_path, exchange=fake_exchange, fetch_profile=fake_profile)
    accounts = InstagramAccountStore(ws.instagram_dir())
    accounts.save({"user_id": "100", "username": "maya.main", "access_token": "keep-me"})

    start = client.get("/api/instagram/oauth/start", follow_redirects=False)
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
    resp = client.get(
        f"/api/instagram/oauth/callback?code=auth-ig-1&state={state}",
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307)
    loc = resp.headers["location"]
    assert "/analytics" in loc
    assert "ig=connected" in loc
    status = client.get("/api/instagram/status").json()
    names = {a["username"] for a in status["accounts"]}
    assert names == {"maya.main", "maya.growth"}
    assert accounts.load("100")["access_token"] == "keep-me"


def test_paste_token_adds_another_account(tmp_path):
    def fake_profile(token):
        assert token == "pasted-long-token"
        return {"user_id": "999", "username": "lab.tester", "name": "Lab"}

    client, _ = _ig_app(tmp_path, fetch_profile=fake_profile)
    resp = client.post("/api/instagram/token", json={"access_token": "pasted-long-token"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["accounts"][0]["username"] == "lab.tester"
    assert "pasted-long-token" not in json.dumps(body)


def test_disconnect_one_account_leaves_the_other(tmp_path):
    client, ws = _ig_app(tmp_path)
    store = InstagramAccountStore(ws.instagram_dir())
    store.save({"user_id": "1", "username": "a", "access_token": "x"})
    store.save({"user_id": "2", "username": "b", "access_token": "y"})
    resp = client.post("/api/instagram/accounts/1/disconnect")
    assert resp.status_code == 200
    names = {a["username"] for a in client.get("/api/instagram/status").json()["accounts"]}
    assert names == {"b"}


def test_sync_matches_unique_caption_onto_gallery_copy(tmp_path):
    def fake_profile(token):
        return {"user_id": "178", "username": "lab.ig", "name": "Lab"}

    def fake_media(user_id, token):
        assert user_id == "178"
        return [{
            "id": "media99",
            "permalink": "https://www.instagram.com/reel/SyncCap/",
            "caption": "unique lab hook",
        }]

    def fake_insights(media_id, token):
        assert media_id == "media99"
        return {"views": 1234, "likes": 9}

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    src.variants[0].caption = "Unique Lab Hook"
    store._persist(job)
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "lab.ig", "access_token": "tok",
    })
    env = {
        ENV_APP_ID: "ig-app-id",
        ENV_APP_SECRET: "ig-app-secret",
        ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
    }
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ=env,
        instagram_fetch_profile=fake_profile,
        instagram_list_media=fake_media,
        instagram_fetch_insights=fake_insights,
    ))
    resp = client.post("/api/instagram/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["matched"] == 1
    gallery = client.get("/api/gallery").json()
    variant = gallery[0]["variants"][0]
    assert variant["ig_media_id"] == "media99"
    assert variant["ig_insights"]["views"] == 1234
    assert gallery[0]["insights_views"] == 1234
    assert gallery[0]["insights_linked"] == 1
    assert body["unmatched"] == []
    assert "suggestions" in body["analytics"]


def test_sync_surfaces_graph_error_instead_of_pretending_zero(tmp_path):
    def fake_media(user_id, token):
        raise ValueError("Instagram HTTP 400: Invalid user id")

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "lab.ig", "access_token": "tok",
    })
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ={
            ENV_APP_ID: "ig-app-id",
            ENV_APP_SECRET: "ig-app-secret",
            ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
        },
        instagram_list_media=fake_media,
    ))
    resp = client.post("/api/instagram/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["matched"] == 0
    assert body["media"] == 0
    assert body["errors"]
    assert "Invalid user id" in body["errors"][0]
    assert "tok" not in json.dumps(body)


def test_sync_matches_drive_export_filename_when_gallery_caption_missing(tmp_path):
    def fake_media(user_id, token):
        return [{
            "id": "media-drive",
            "permalink": "https://www.instagram.com/reel/DriveCap/",
            "caption": "unique lab hook",
        }]

    def fake_insights(media_id, token):
        return {"views": 88}

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    assert not src.variants[0].caption
    from variant_maker.server.drive_exports import ExportFile, ExportStore
    ExportStore(ws.exports_dir()).create(
        destination_id="d1",
        folder_id="f1",
        files=[ExportFile(
            source_id=src.source_id,
            index=src.variants[0].index,
            filename="Unique Lab Hook.mp4",
            local_path="x",
            status="succeeded",
        )],
    )
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "lab.ig", "access_token": "tok",
    })
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ={
            ENV_APP_ID: "ig-app-id",
            ENV_APP_SECRET: "ig-app-secret",
            ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
        },
        instagram_list_media=fake_media,
        instagram_fetch_insights=fake_insights,
    ))
    resp = client.post("/api/instagram/sync")
    assert resp.status_code == 200
    assert resp.json()["matched"] == 1
    gallery = client.get("/api/gallery").json()
    assert gallery[0]["variants"][0]["ig_media_id"] == "media-drive"


def test_sync_returns_unmatched_reels_for_the_picker(tmp_path):
    def fake_media(user_id, token):
        return [
            {
                "id": "linked",
                "permalink": "https://www.instagram.com/reel/SyncCap/",
                "caption": "unique lab hook",
            },
            {
                "id": "orphan",
                "permalink": "https://www.instagram.com/reel/OrphanReel/",
                "caption": "reused bank line",
            },
        ]

    def fake_insights(media_id, token):
        return {"views": 50}

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    src.variants[0].caption = "Unique Lab Hook"
    store._persist(job)
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "lab.ig", "access_token": "tok",
    })
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ={
            ENV_APP_ID: "ig-app-id",
            ENV_APP_SECRET: "ig-app-secret",
            ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
        },
        instagram_list_media=fake_media,
        instagram_fetch_insights=fake_insights,
    ))
    resp = client.post("/api/instagram/sync")
    assert resp.status_code == 200
    unmatched = resp.json()["unmatched"]
    assert [u["media_id"] for u in unmatched] == ["orphan"]
    assert unmatched[0]["permalink"].endswith("OrphanReel/")
    assert "tok" not in json.dumps(unmatched)

    src_id = src.source_id
    idx = src.variants[0].index
    linked = client.post("/api/instagram/link", json={
        "source_id": src_id,
        "index": idx,
        "media_id": "orphan",
        "ig_user_id": "178",
        "permalink": "https://www.instagram.com/reel/OrphanReel/",
    })
    assert linked.status_code == 200
    gallery = client.get("/api/gallery").json()
    assert gallery[0]["variants"][0]["ig_media_id"] == "orphan"


def test_analytics_and_gallery_stamp_winner_and_quiet(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("winner.mp4", b"x"), ("quiet.mp4", b"y")], count=3)
    store.wait(job.job_id, timeout=5)
    job = store.get(job.job_id)
    job.created_utc = "2026-08-01T00:00:00Z"
    winner, quiet = job.sources
    for variant in winner.variants:
        store.set_ig_insights(
            winner.source_id, variant.index,
            ig_media_id=f"w{variant.index}",
            ig_user_id="178",
            insights={"views": 40_000, "fetched_at": "2026-08-30T00:00:00Z"},
        )
    for variant in quiet.variants:
        store.set_ig_insights(
            quiet.source_id, variant.index,
            ig_media_id=f"q{variant.index}",
            ig_user_id="178",
            insights={"views": 10, "fetched_at": "2026-08-30T00:00:00Z"},
        )
    job = store.get(job.job_id)
    job.created_utc = (
        datetime.now(UTC).replace(microsecond=0) - timedelta(hours=48)
    ).isoformat().replace("+00:00", "Z")
    store._persist(job)
    client = TestClient(create_app(store, sa_json_path=""))
    body = client.get("/api/instagram/analytics").json()
    kinds = {row["kind"]: row["source_id"] for row in body["suggestions"]}
    assert kinds["winner"] == winner.source_id
    assert kinds["held_no_push"] == quiet.source_id
    gallery = {row["filename"]: row for row in client.get("/api/gallery").json()}
    assert gallery["winner.mp4"]["suggestion_kind"] == "winner"
    assert "Generate 20 more" in gallery["winner.mp4"]["suggestion_copy"]
    assert gallery["quiet.mp4"]["suggestion_kind"] == "held_no_push"
    assert "flagged" not in gallery["quiet.mp4"]["suggestion_copy"].lower()


def test_analytics_lanes_label_connected_handles(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    store.set_ig_insights(
        src.source_id, src.variants[0].index,
        ig_media_id="m1",
        ig_user_id="trial",
        insights={"views": 200, "follows": 4, "shares": 3, "fetched_at": "2026-08-30T00:00:00Z"},
    )
    store.set_ig_insights(
        src.source_id, src.variants[1].index,
        ig_media_id="m2",
        ig_user_id="main",
        insights={"views": 50, "follows": 1, "shares": 1, "fetched_at": "2026-08-30T00:00:00Z"},
    )
    accounts = InstagramAccountStore(ws.instagram_dir())
    accounts.save({"user_id": "trial", "username": "lab.trial", "access_token": "secret-tok"})
    accounts.save({"user_id": "main", "username": "lab.main", "access_token": "secret-tok-2"})
    client = TestClient(create_app(store, sa_json_path=""))
    body = client.get("/api/instagram/analytics").json()
    dumped = json.dumps(body)
    assert "secret-tok" not in dumped
    by_user = {row["username"]: row for row in body["lanes"]}
    assert by_user["lab.trial"]["insights_views"] == 200
    assert by_user["lab.trial"]["insights_follows"] == 4
    assert by_user["lab.main"]["insights_views"] == 50
    assert "flagged" not in dumped.lower()


def test_unlink_drops_a_tracked_copy_from_a_disconnected_account(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("pack.mp4", b"x")], count=2)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    leftover, kept = src.variants
    store.set_ig_insights(
        src.source_id, leftover.index,
        ig_media_id="mckenzie-reel",
        ig_user_id="mckenzie",
        insights={"views": 80, "username": "mckenzie.trial", "fetched_at": "2026-08-30T00:00:00Z"},
        post_url="https://www.instagram.com/reel/MckTrial/",
    )
    store.set_ig_insights(
        src.source_id, kept.index,
        ig_media_id="jeff-reel",
        ig_user_id="jeff",
        insights={"views": 20, "username": "jeff.main", "fetched_at": "2026-08-30T00:00:00Z"},
    )
    accounts = InstagramAccountStore(ws.instagram_dir())
    accounts.save({"user_id": "jeff", "username": "jeff.main", "access_token": "secret-tok"})
    client = TestClient(create_app(store, sa_json_path=""))
    body = client.get("/api/instagram/analytics").json()
    tracked = {row["ig_media_id"]: row for row in body["ranked"][0]["tracked"]}
    assert tracked["mckenzie-reel"]["account_connected"] is False
    assert tracked["mckenzie-reel"]["username"] == "mckenzie.trial"
    assert tracked["jeff-reel"]["account_connected"] is True

    resp = client.post("/api/instagram/unlink", json={
        "source_id": src.source_id,
        "index": leftover.index,
    })
    assert resp.status_code == 200
    dumped = json.dumps(resp.json())
    assert "secret-tok" not in dumped
    left = [row["ig_media_id"] for row in resp.json()["ranked"][0]["tracked"]]
    assert left == ["jeff-reel"]
    gallery = {v["index"]: v for v in client.get("/api/gallery").json()[0]["variants"]}
    assert gallery[leftover.index]["ig_media_id"] is None
    assert gallery[leftover.index]["ig_insights"] is None
    assert gallery[kept.index]["ig_media_id"] == "jeff-reel"


def test_sync_keeps_views_when_graph_returns_no_counts(tmp_path):
    def fake_media(user_id, token):
        return [{
            "id": "reel-jeff",
            "permalink": "https://www.instagram.com/reel/JeffReel/",
            "caption": "jeff hook",
        }]

    def fake_insights(media_id, token):
        return {}

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("jeff tingz.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    idx = src.variants[0].index
    store.set_ig_insights(
        src.source_id, idx,
        ig_media_id="reel-jeff",
        ig_user_id="178",
        insights={"views": 5000, "shares": 9, "username": "jeff.tingz", "fetched_at": "2026-08-01T00:00:00Z"},
        post_url="https://www.instagram.com/reel/JeffReel/",
    )
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "jeff.tingz", "access_token": "tok",
    })
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ={
            ENV_APP_ID: "ig-app-id",
            ENV_APP_SECRET: "ig-app-secret",
            ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
        },
        instagram_list_media=fake_media,
        instagram_fetch_insights=fake_insights,
    ))
    resp = client.post("/api/instagram/sync")
    assert resp.status_code == 200
    variant = client.get("/api/gallery").json()[0]["variants"][0]
    assert variant["ig_media_id"] == "reel-jeff"
    assert variant["ig_insights"]["views"] == 5000
    assert variant["ig_insights"]["shares"] == 9


def test_link_moves_reel_off_the_wrong_gallery_pack(tmp_path):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job(
        [("mckenzie trial reels.mp4", b"x"), ("jeff tingz.mp4", b"y")],
        count=1,
    )
    store.wait(job.job_id, timeout=5)
    job = store.get(job.job_id)
    wrong, right = job.sources
    store.set_ig_insights(
        wrong.source_id, wrong.variants[0].index,
        ig_media_id="reel-jeff",
        ig_user_id="178",
        insights={"views": 900, "shares": 12, "username": "jeff.tingz", "fetched_at": "2026-08-30T00:00:00Z"},
        post_url="https://www.instagram.com/reel/JeffReel/",
    )
    client = TestClient(create_app(store, sa_json_path=""))
    resp = client.post("/api/instagram/link", json={
        "source_id": right.source_id,
        "index": right.variants[0].index,
        "media_id": "reel-jeff",
        "ig_user_id": "178",
        "username": "jeff.tingz",
        "permalink": "https://www.instagram.com/reel/JeffReel/",
    })
    assert resp.status_code == 200
    gallery = {row["filename"]: row for row in client.get("/api/gallery").json()}
    assert gallery["mckenzie trial reels.mp4"]["variants"][0]["ig_media_id"] is None
    moved = gallery["jeff tingz.mp4"]["variants"][0]
    assert moved["ig_media_id"] == "reel-jeff"
    assert moved["ig_insights"]["views"] == 900
    assert moved["ig_insights"]["shares"] == 12
    tracked = {
        row["filename"]: [c["ig_media_id"] for c in row.get("tracked") or []]
        for row in resp.json()["ranked"]
    }
    assert tracked.get("jeff tingz.mp4") == ["reel-jeff"]
    assert "mckenzie trial reels.mp4" not in tracked


def test_analytics_get_returns_insights_without_leaking_token(tmp_path):
    client, ws = _ig_app(tmp_path)
    accounts = InstagramAccountStore(ws.instagram_dir())
    accounts.save({"user_id": "178", "username": "lab.ig", "access_token": "secret-tok"})

    resp = client.get("/api/instagram/analytics")
    assert resp.status_code == 200
    body = resp.json()
    assert body["insights_views"] is None
    assert body["insights_linked"] == 0
    assert body["insights_fetched_at"] is None
    assert body["ranked"] == []
    assert len(body["accounts"]) == 1
    assert body["accounts"][0]["username"] == "lab.ig"
    dumped = json.dumps(body)
    assert "secret-tok" not in dumped
    assert "access_token" not in dumped
    assert body.get("unmatched") == []


def test_analytics_get_keeps_unmatched_reels_after_sync(tmp_path):
    def fake_media(user_id, token):
        return [
            {
                "id": "linked",
                "permalink": "https://www.instagram.com/reel/SyncCap/",
                "caption": "unique lab hook",
            },
            {
                "id": "orphan",
                "permalink": "https://www.instagram.com/reel/OrphanReel/",
                "caption": "old post from before varimo",
            },
        ]

    def fake_insights(media_id, token):
        return {"views": 50}

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    src.variants[0].caption = "Unique Lab Hook"
    store._persist(job)
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "lab.ig", "access_token": "tok",
    })
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ={
            ENV_APP_ID: "ig-app-id",
            ENV_APP_SECRET: "ig-app-secret",
            ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
        },
        instagram_list_media=fake_media,
        instagram_fetch_insights=fake_insights,
    ))
    synced = client.post("/api/instagram/sync")
    assert synced.status_code == 200
    assert [u["media_id"] for u in synced.json()["unmatched"]] == ["orphan"]
    assert synced.json()["analytics"]["insights_fetched_at"]

    again = client.get("/api/instagram/analytics").json()
    assert again["insights_fetched_at"] == synced.json()["analytics"]["insights_fetched_at"]
    assert [u["media_id"] for u in again["unmatched"]] == ["orphan"]
    assert "tok" not in json.dumps(again)

    linked = client.post("/api/instagram/link", json={
        "source_id": src.source_id,
        "index": src.variants[0].index,
        "media_id": "orphan",
        "ig_user_id": "178",
        "permalink": "https://www.instagram.com/reel/OrphanReel/",
    })
    assert linked.status_code == 200
    leftover = client.get("/api/instagram/analytics").json()["unmatched"]
    assert leftover == []


def test_second_sync_exposes_view_delta_since_the_last_look(tmp_path):
    views = {"n": 100}

    def fake_media(user_id, token):
        return [{
            "id": "linked",
            "permalink": "https://www.instagram.com/reel/SyncCap/",
            "caption": "unique lab hook",
        }]

    def fake_insights(media_id, token):
        return {"views": views["n"]}

    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    job = store.create_job([("a.mp4", b"x")], count=1)
    store.wait(job.job_id, timeout=5)
    src = store.get(job.job_id).sources[0]
    src.variants[0].caption = "Unique Lab Hook"
    store._persist(job)
    InstagramAccountStore(ws.instagram_dir()).save({
        "user_id": "178", "username": "lab.ig", "access_token": "tok",
    })
    client = TestClient(create_app(
        store,
        sa_json_path="",
        instagram_environ={
            ENV_APP_ID: "ig-app-id",
            ENV_APP_SECRET: "ig-app-secret",
            ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
        },
        instagram_list_media=fake_media,
        instagram_fetch_insights=fake_insights,
    ))
    first = client.post("/api/instagram/sync")
    assert first.status_code == 200
    assert first.json()["analytics"]["ranked"][0].get("insights_views_delta") is None

    views["n"] = 12100
    second = client.post("/api/instagram/sync").json()
    row = second["analytics"]["ranked"][0]
    assert row["insights_views"] == 12100
    assert row["insights_views_delta"] == 12000
    assert second["analytics"]["insights_views_delta"] == 12000

    again = client.get("/api/instagram/analytics").json()
    assert again["ranked"][0]["insights_views_delta"] == 12000


def test_instagram_oauth_pending_store_round_trips_workspace_id(tmp_path):
    store = InstagramOAuthPendingStore(str(tmp_path / "instagram_oauth_pending.json"))
    store.add("st-owner", workspace_id="ws_jeff")
    assert store.consume("missing") is None
    pending = store.consume("st-owner")
    assert pending is not None
    assert pending.workspace_id == "ws_jeff"
    assert store.consume("st-owner") is None


def _auth_ig_app(tmp_path, *, exchange=None, fetch_profile=None):
    ws = Workspace(str(tmp_path))
    store = JobStore(ws, FakeRunner({}))
    env = _env()
    env.update({
        ENV_APP_ID: "ig-app-id",
        ENV_APP_SECRET: "ig-app-secret",
        ENV_REDIRECT_URI: "https://ui.example/api/instagram/oauth/callback",
    })
    app = create_app(
        store,
        hydrate=True,
        auth_environ=env,
        oauth_environ=env,
        login_exchange=_exchange,
        sa_json_path="",
        instagram_environ=env,
        instagram_exchange=exchange,
        instagram_fetch_profile=fetch_profile,
    )
    return app, ws


def test_instagram_oauth_start_requires_login_when_auth_on(tmp_path):
    app, _ = _auth_ig_app(tmp_path)
    resp = TestClient(app).get("/api/instagram/oauth/start", follow_redirects=False)
    assert resp.status_code == 401
    assert resp.json()["detail"] == "login required"


def test_instagram_oauth_callback_without_cookie_bad_state_redirects(tmp_path):
    app, _ = _auth_ig_app(tmp_path)
    resp = TestClient(app).get(
        "/api/instagram/oauth/callback?code=ig-code&state=nope",
        follow_redirects=False,
    )
    assert resp.status_code in (302, 307), resp.text
    loc = resp.headers["location"]
    assert "/analytics" in loc
    assert "ig=error" in loc
    assert "bad_state" in loc


def test_instagram_oauth_callback_without_session_cookie_saves_to_workspace(tmp_path):
    """Instagram's top-level redirect often omits SameSite=Lax Studio cookies."""

    def fake_exchange(*, code, client_id, client_secret, redirect_uri):
        assert code == "ig-code"
        return {"access_token": "long-ig", "user_id": "17841"}

    def fake_profile(token):
        assert token == "long-ig"
        return {"user_id": "17841", "username": "connected_user", "name": "Maya"}

    app, ws = _auth_ig_app(tmp_path, exchange=fake_exchange, fetch_profile=fake_profile)
    logged_in = TestClient(app)
    login = _login(logged_in, "jeff")
    assert login.status_code in (302, 307), login.text
    me = logged_in.get("/api/auth/me").json()
    workspace_id = me["workspace_id"]
    assert workspace_id

    start = logged_in.get("/api/instagram/oauth/start", follow_redirects=False)
    assert start.status_code in (302, 307), start.text
    state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]

    anon = TestClient(app)
    cb = anon.get(
        f"/api/instagram/oauth/callback?code=ig-code&state={state}",
        follow_redirects=False,
    )
    assert cb.status_code in (302, 307), cb.text
    loc = cb.headers["location"]
    assert "/analytics" in loc
    assert "ig=connected" in loc

    tenant_ig = InstagramAccountStore(
        os.path.join(tenant_root(ws.root, workspace_id), "instagram"),
    )
    assert [a.username for a in tenant_ig.list_accounts()] == ["connected_user"]
    assert InstagramAccountStore(os.path.join(ws.root, "instagram")).list_accounts() == []

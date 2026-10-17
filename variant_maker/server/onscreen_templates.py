"""Saved on-screen setups. A template is one winning project, not a new system."""
from __future__ import annotations

import json
import os
import secrets
import threading

from ..onscreen import OnScreenError, normalize_project

MAX_TEMPLATES = 30
MAX_NAME = 48
_LOCK = threading.Lock()


class TemplateError(ValueError):
    pass


def _path(root: str) -> str:
    return os.path.join(root, "onscreen_templates.json")


def _load(root: str) -> list[dict]:
    path = _path(root)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []
    if isinstance(data, dict):
        data = data.get("templates")
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict) and row.get("id")]


def _save(root: str, rows: list[dict]) -> None:
    os.makedirs(root, exist_ok=True)
    path = _path(root)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"templates": rows}, fh)
    os.replace(tmp, path)


def list_templates(root: str) -> list[dict]:
    with _LOCK:
        return [dict(row) for row in _load(root)]


def save_template(root: str, name: str, project: dict) -> dict:
    label = str(name or "").strip()
    if not label:
        raise TemplateError("Name this setup.")
    label = label[:MAX_NAME]
    try:
        clean = normalize_project(project)
    except OnScreenError as exc:
        raise TemplateError(str(exc)) from exc
    if not clean:
        raise TemplateError("Add a line and a box before saving.")
    clean.pop("prints", None)
    row = {"id": secrets.token_hex(6), "name": label, "project": clean}
    with _LOCK:
        rows = _load(root)
        rows.append(row)
        _save(root, rows[-MAX_TEMPLATES:])
    return row


def delete_template(root: str, template_id: str) -> None:
    tid = str(template_id or "").strip()
    with _LOCK:
        rows = _load(root)
        kept = [row for row in rows if row.get("id") != tid]
        if len(kept) == len(rows):
            raise TemplateError("Setup not found.")
        _save(root, kept)

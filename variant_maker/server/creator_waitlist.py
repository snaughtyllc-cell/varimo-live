"""Durable creator demand capture, separate from paid users and workspace access."""
from __future__ import annotations

import csv
import io
import os
import re
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from typing import Callable, Literal

from fastapi import FastAPI, Query, Request, Response
from pydantic import BaseModel, Field, field_validator


class CreatorSignup(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    instagram: str = Field(default="", max_length=31)
    monthly_variants: Literal["under_100", "100_500", "500_2000", "2000_plus", "unsure"]
    monthly_budget: Literal["under_25", "25_50", "50_100", "100_plus", "unsure"]
    use_case: str = Field(default="", max_length=1000)
    consent: Literal[True]
    website: str = Field(default="", max_length=254)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("instagram")
    @classmethod
    def clean_instagram(cls, value: str) -> str:
        value = value.strip().lstrip("@").lower()
        if value and not re.fullmatch(r"[a-z0-9_.]{1,30}", value):
            raise ValueError("Enter an Instagram handle, not a URL")
        return value


class CreatorWaitlist:
    def __init__(self, path: str):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with closing(self.connect()) as db, db:
            db.execute("""CREATE TABLE IF NOT EXISTS signups (
                email TEXT PRIMARY KEY, instagram TEXT NOT NULL,
                monthly_variants TEXT NOT NULL, monthly_budget TEXT NOT NULL,
                use_case TEXT NOT NULL, consent_version TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )""")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def save(self, signup: CreatorSignup):
        now = datetime.now(UTC).isoformat()
        with closing(self.connect()) as db, db:
            db.execute("""INSERT INTO signups VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET instagram=excluded.instagram,
                monthly_variants=excluded.monthly_variants,
                monthly_budget=excluded.monthly_budget, use_case=excluded.use_case,
                consent_version=excluded.consent_version, updated_at=excluded.updated_at""",
                (signup.email, signup.instagram, signup.monthly_variants,
                 signup.monthly_budget, signup.use_case.strip(), "creator-plan-updates-v1", now, now))

    def read(self, offset: int = 0, limit: int = 50):
        with closing(self.connect()) as db, db:
            total = db.execute("SELECT COUNT(*) FROM signups").fetchone()[0]
            rows = db.execute("SELECT * FROM signups ORDER BY created_at DESC, email LIMIT ? OFFSET ?", (limit, offset))
            items = [dict(row) for row in rows]
            budgets = dict(db.execute("SELECT monthly_budget, COUNT(*) FROM signups GROUP BY monthly_budget").fetchall())
            usage = dict(db.execute("SELECT monthly_variants, COUNT(*) FROM signups GROUP BY monthly_variants").fetchall())
        return {"total": total, "items": items, "budgets": budgets, "usage": usage}


def register_creator_waitlist_routes(app: FastAPI, *, data_dir: str, require_admin: Callable):
    store = CreatorWaitlist(os.path.join(data_dir, "creator-waitlist.sqlite3"))

    @app.post("/api/waitlist/creator", status_code=201)
    def join(body: CreatorSignup):
        if not body.website:  # Honeypot: never store automated hidden-field submissions.
            store.save(body)
        return {"accepted": True}

    @app.get("/api/admin/creator-waitlist")
    def list_signups(request: Request, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        require_admin(request)
        return store.read(offset, limit)

    @app.get("/api/admin/creator-waitlist/export")
    def export_signups(request: Request):
        require_admin(request)
        # Quote formula-like values so a downloaded CSV cannot execute spreadsheet formulas.
        def cell(value):
            text = str(value)
            return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text
        output = io.StringIO()
        with closing(store.connect()) as db:
            cursor = db.execute("SELECT * FROM signups ORDER BY created_at DESC, email")
            writer = csv.writer(output)
            writer.writerow([column[0] for column in cursor.description])
            for row in cursor:
                writer.writerow([cell(value) for value in row])
        return Response(output.getvalue(), media_type="text/csv", headers={
            "Content-Disposition": 'attachment; filename="creator-waitlist.csv"',
            "Cache-Control": "no-store",
        })

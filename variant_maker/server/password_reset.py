"""Operator-issued recovery; no public issuance or account enumeration."""
from __future__ import annotations

import json
import secrets
import threading
import time
from collections import deque
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from starlette.concurrency import run_in_threadpool

from .passwords import MIN_PASSWORD_LENGTH, hash_password

PAGE = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Varimo · Choose a new password</title></head>
<body><main><h1>Choose a new Varimo password</h1><p>This link expires after one hour and works once. Your workspace and videos stay unchanged.</p>
<form><label>New password <input id="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><br>
<label>Repeat password <input id="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></label><br>
<button>Save new password</button></form><p id="status" role="status"></p><a href="/login">Back to sign in</a></main>
<script nonce="NONCE">let token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const form=document.querySelector('form'),status=document.querySelector('#status'),button=document.querySelector('button');
if(!token){status.textContent='Missing reset link. Ask for a fresh link.';button.disabled=true;}
form.addEventListener('submit',async(event)=>{event.preventDefault();const password=document.querySelector('#password').value;if(password!==document.querySelector('#confirm').value){status.textContent='Passwords do not match.';return;}button.disabled=true;try{const r=await fetch('/api/auth/password/reset',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({token,password})});if(r.ok){token='';form.reset();form.hidden=true;status.textContent='Password saved. Sign in with your email and new password.';}else{status.textContent=r.status===429?'Too many attempts. Please wait a minute.':'This link is invalid or expired, or the password is too short. Request a new link if needed.';button.disabled=false;}}catch{status.textContent='Connection failed. Please try again.';button.disabled=false;}});</script></body></html>'''


def register_password_reset_routes(app, tenants, studio_origin=None):
    # Global bounded throttle avoids trusting spoofable forwarding headers. With
    # this single-process service, at most 10 password hashes/minute for recovery.
    attempts = deque()
    lock = threading.Lock()

    @app.get('/api/auth/password/reset', response_class=HTMLResponse)
    def reset_form():
        if tenants is None:
            raise HTTPException(404)
        nonce = secrets.token_urlsafe(24)
        return HTMLResponse(PAGE.replace('NONCE', nonce), headers={
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': f"default-src 'none'; script-src 'nonce-{nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        })

    @app.post('/api/auth/password/reset', status_code=204)
    async def reset_password(request: Request):
        if tenants is None:
            raise HTTPException(404)
        origin = request.headers.get('origin')
        expected = studio_origin(request) if studio_origin else str(request.base_url).rstrip('/')
        if origin and (urlsplit(origin).scheme, urlsplit(origin).netloc) != (urlsplit(expected).scheme, urlsplit(expected).netloc):
            raise HTTPException(403, 'Invalid origin')
        if request.headers.get('sec-fetch-site') == 'cross-site':
            raise HTTPException(403, 'Invalid origin')
        if not request.headers.get('content-type', '').startswith('application/json'):
            raise HTTPException(415)
        now = time.monotonic()
        with lock:
            while attempts and attempts[0] <= now - 60:
                attempts.popleft()
            if len(attempts) >= 10:
                raise HTTPException(429, 'Too many attempts', headers={'Retry-After': '60'})
            attempts.append(now)
        try:
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 16384:
                    raise ValueError()
            body = json.loads(raw)
            token, password = body['token'], body['password']
            if not isinstance(token, str) or not isinstance(password, str):
                raise TypeError()
            if not 1 <= len(token) <= 128 or not MIN_PASSWORD_LENGTH <= len(password) <= 1024:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise HTTPException(400, 'Invalid reset request') from None
        # Never use model-validation errors that echo passwords/tokens.
        hashed = await run_in_threadpool(hash_password, password)
        user = await run_in_threadpool(tenants.consume_password_reset, token, hashed)
        if user is None:
            raise HTTPException(400, 'Invalid or expired reset link')
        return Response(status_code=204, headers={'Cache-Control': 'no-store'})

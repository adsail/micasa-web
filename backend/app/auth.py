"""Optional single-account authentication, gated behind AUTH_ENABLED.

OFF BY DEFAULT. When AUTH_ENABLED is false everything here is a no-op: the
dependency lets every request through, /auth/me reports auth_disabled so the
frontend never renders a login wall, and no cookies are ever set. That keeps
the LAN deployment behaviorally identical to a build without auth.

When AUTH_ENABLED is true the app refuses to start unless it has a bcrypt
password hash and a long signing secret (see load_config). A plaintext password
env var is never accepted and no plaintext is ever stored or logged.

Mechanism: a signed, timestamped session cookie (itsdangerous TimestampSigner)
holding nothing but the username -- no server-side session store. State-changing
requests additionally need a double-submit CSRF token (non-HttpOnly cookie that
must match the X-CSRF-Token header) on top of the SameSite=Strict baseline.
"""

import hmac
import math
import os
import secrets
import threading
import time

from dataclasses import dataclass, field

import bcrypt
from fastapi import APIRouter, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner
from pydantic import BaseModel

SESSION_COOKIE = "micasa_session"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"
SESSION_SALT = "micasa-session"

# Brute-force protection for POST /auth/login. In-memory and per-process, which
# is fine for the single-instance deployments this app targets (a restart clears
# the counters). Tunable here.
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_LOCKOUT_SECONDS = 15 * 60

# Refuse to start with a signing secret shorter than this.
MIN_SECRET_LENGTH = 32

# /api paths reachable without a session. Everything else is protected --
# including plain GET reads -- so a new route is guarded by default.
PUBLIC_PATHS = frozenset({"/auth/login", "/auth/me", "/health"})

# Methods that require a matching double-submit CSRF token.
MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

GENERIC_LOGIN_ERROR = "invalid username or password"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def _env_flag(name, default=False):
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class AuthConfig:
    enabled: bool
    username: str = ""
    password_hash: str = field(default="", repr=False)
    secret: str = field(default="", repr=False)
    session_days: int = 7
    cookie_secure: bool = True

    @property
    def session_max_age(self):
        return self.session_days * 24 * 60 * 60


def load_config():
    """Build the auth config from the environment.

    Raises RuntimeError with an actionable message when AUTH_ENABLED is on but
    the required secrets are missing or unusable, so the app fails loudly at
    startup instead of coming up unprotected.
    """
    if not _env_flag("AUTH_ENABLED", False):
        return AuthConfig(enabled=False)

    username = (os.environ.get("AUTH_USERNAME") or "admin").strip()
    if not username:
        raise RuntimeError("AUTH_ENABLED=true but AUTH_USERNAME is blank")

    password_hash = (os.environ.get("AUTH_PASSWORD_HASH") or "").strip()
    if not password_hash:
        raise RuntimeError(
            "AUTH_ENABLED=true requires AUTH_PASSWORD_HASH (a bcrypt hash of "
            "your password). Generate one with: python -m app.hashpw -- a "
            "plaintext password env var is never accepted."
        )
    if not password_hash.startswith(("$2a$", "$2b$", "$2y$")):
        raise RuntimeError(
            "AUTH_PASSWORD_HASH does not look like a bcrypt hash (expected it "
            "to start with $2b$). Generate one with: python -m app.hashpw"
        )

    secret = os.environ.get("AUTH_SECRET") or ""
    if len(secret) < MIN_SECRET_LENGTH:
        raise RuntimeError(
            f"AUTH_ENABLED=true requires AUTH_SECRET of at least "
            f"{MIN_SECRET_LENGTH} characters to sign session cookies. "
            "Generate one with: openssl rand -hex 32"
        )

    raw_days = (os.environ.get("AUTH_SESSION_DAYS") or "7").strip()
    try:
        session_days = int(raw_days)
    except ValueError:
        raise RuntimeError(f"AUTH_SESSION_DAYS must be an integer, got '{raw_days}'")
    if session_days < 1:
        raise RuntimeError("AUTH_SESSION_DAYS must be at least 1")

    return AuthConfig(
        enabled=True,
        username=username,
        password_hash=password_hash,
        secret=secret,
        session_days=session_days,
        cookie_secure=_env_flag("AUTH_COOKIE_SECURE", True),
    )


_config = None


def init_auth():
    """Load + cache the config. Called at import time by main so a bad auth
    setup aborts startup."""
    global _config
    _config = load_config()
    return _config


def get_config():
    if _config is None:
        return init_auth()
    return _config


# ---------------------------------------------------------------------------
# Session token (signed cookie, no server-side store)
# ---------------------------------------------------------------------------
def _signer(cfg):
    return TimestampSigner(cfg.secret, salt=SESSION_SALT)


def issue_session_token(cfg, username):
    """Sign the username with a timestamp; that pair IS the whole session."""
    return _signer(cfg).sign(username.encode("utf-8")).decode("utf-8")


def verify_session_token(cfg, token):
    """Return the username carried by a valid, unexpired token, else None."""
    if not token:
        return None
    try:
        raw = _signer(cfg).unsign(token, max_age=cfg.session_max_age)
    except (BadSignature, SignatureExpired):
        return None
    username = raw.decode("utf-8", "replace")
    # A username change (or hash/secret rotation) invalidates old cookies.
    if not hmac.compare_digest(username.encode("utf-8"), cfg.username.encode("utf-8")):
        return None
    return username


def _session_username(request, cfg):
    return verify_session_token(cfg, request.cookies.get(SESSION_COOKIE))


def _check_password(password, password_hash):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (TypeError, ValueError):
        # Unusable hash or an over-long password (bcrypt caps at 72 bytes).
        return False


# ---------------------------------------------------------------------------
# Cookies
# ---------------------------------------------------------------------------
def _set_session_cookie(response, cfg, username):
    response.set_cookie(
        SESSION_COOKIE,
        issue_session_token(cfg, username),
        max_age=cfg.session_max_age,
        httponly=True,
        secure=cfg.cookie_secure,
        samesite="strict",
        path="/",
    )


def _set_csrf_cookie(response, cfg):
    # Readable by JS on purpose: the frontend echoes it back in X-CSRF-Token.
    response.set_cookie(
        CSRF_COOKIE,
        secrets.token_urlsafe(32),
        max_age=cfg.session_max_age,
        httponly=False,
        secure=cfg.cookie_secure,
        samesite="strict",
        path="/",
    )


def _clear_cookies(response, cfg):
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            name,
            path="/",
            secure=cfg.cookie_secure,
            samesite="strict",
        )


# ---------------------------------------------------------------------------
# Login rate limiter (in-memory, per process)
# ---------------------------------------------------------------------------
class LoginLimiter:
    """Sliding-window failure counter keyed by client IP.

    After LOGIN_MAX_FAILURES failures inside LOGIN_WINDOW_SECONDS the key is
    locked out for LOGIN_LOCKOUT_SECONDS from its last failure.
    """

    MAX_KEYS = 4096

    def __init__(self, max_failures, window_seconds, lockout_seconds):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.lockout_seconds = lockout_seconds
        self._failures = {}
        self._lock = threading.Lock()

    def retry_after(self, key):
        """Seconds the caller must wait, or 0 when it may try a login."""
        now = time.monotonic()
        with self._lock:
            hits = self._prune(key, now)
            if len(hits) < self.max_failures:
                return 0
            unlock_at = hits[-1] + self.lockout_seconds
            return max(1, int(math.ceil(unlock_at - now))) if unlock_at > now else 0

    def record_failure(self, key):
        now = time.monotonic()
        with self._lock:
            hits = self._prune(key, now)
            hits.append(now)
            self._failures[key] = hits
            if len(self._failures) > self.MAX_KEYS:
                self._evict(now)

    def reset(self, key):
        with self._lock:
            self._failures.pop(key, None)

    def _prune(self, key, now):
        cutoff = now - max(self.window_seconds, self.lockout_seconds)
        hits = [t for t in self._failures.get(key, []) if t > cutoff]
        if hits:
            self._failures[key] = hits
        else:
            self._failures.pop(key, None)
        return hits

    def _evict(self, now):
        cutoff = now - max(self.window_seconds, self.lockout_seconds)
        for key in [k for k, hits in self._failures.items() if not hits or hits[-1] <= cutoff]:
            self._failures.pop(key, None)


_limiter = LoginLimiter(LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS, LOGIN_LOCKOUT_SECONDS)


def _client_ip(request):
    """Peer address. Behind a reverse proxy this is the proxy unless uvicorn is
    told to trust forwarded headers (FORWARDED_ALLOW_IPS); see the README."""
    client = request.client
    return client.host if client and client.host else "unknown"


# ---------------------------------------------------------------------------
# Dependency: protects every /api route except PUBLIC_PATHS
# ---------------------------------------------------------------------------
def _api_path(request):
    """Path of the request relative to the mounted /api app."""
    path = request.scope.get("path") or "/"
    if path == "/api":
        path = "/"
    elif path.startswith("/api/"):
        path = path[len("/api"):]
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return path


def _require_csrf(request):
    cookie = request.cookies.get(CSRF_COOKIE) or ""
    header = request.headers.get(CSRF_HEADER) or ""
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status_code=403, detail="missing or invalid CSRF token")


def require_session(request: Request):
    """No-op when auth is disabled; otherwise demands a valid session cookie
    (plus a CSRF token on mutating requests)."""
    cfg = get_config()
    if not cfg.enabled:
        return None

    if _api_path(request) in PUBLIC_PATHS:
        return None

    username = _session_username(request, cfg)
    if not username:
        raise HTTPException(status_code=401, detail="authentication required")
    if request.method in MUTATING_METHODS:
        _require_csrf(request)
    return username


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str | None = None
    password: str | None = None


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    cfg = get_config()
    if not cfg.enabled:
        return {"authenticated": True, "auth_disabled": True}

    ip = _client_ip(request)
    retry_after = _limiter.retry_after(ip)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="too many failed login attempts; try again later",
            headers={"Retry-After": str(retry_after)},
        )

    username = (payload.username or "").strip()
    password = payload.password or ""
    # Evaluate both factors before branching so the response does not reveal
    # which one was wrong (in time or in the message).
    username_ok = hmac.compare_digest(
        username.encode("utf-8"), cfg.username.encode("utf-8")
    )
    password_ok = _check_password(password, cfg.password_hash)
    if not (username_ok and password_ok):
        _limiter.record_failure(ip)
        raise HTTPException(status_code=401, detail=GENERIC_LOGIN_ERROR)

    _limiter.reset(ip)
    _set_session_cookie(response, cfg, cfg.username)
    _set_csrf_cookie(response, cfg)
    return {"authenticated": True, "username": cfg.username}


@router.post("/logout")
def logout(response: Response):
    cfg = get_config()
    if cfg.enabled:
        _clear_cookies(response, cfg)
    return {"ok": True}


@router.get("/me")
def me(request: Request, response: Response):
    cfg = get_config()
    if not cfg.enabled:
        return {"authenticated": True, "auth_disabled": True}

    username = _session_username(request, cfg)
    if not username:
        return {"authenticated": False}
    # Make sure a live session always has a CSRF token to double-submit (e.g.
    # after the cookie expired on its own). Existing tokens are left alone so
    # in-flight mutations keep working.
    if not request.cookies.get(CSRF_COOKIE):
        _set_csrf_cookie(response, cfg)
    return {"authenticated": True, "username": username}

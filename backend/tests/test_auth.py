import pytest

from conftest import PASSWORD, SECRET, USERNAME

PROTECTED_READ = "/api/project-types"
PROTECTED_WRITE = "/api/vendors"


def login(client):
    res = client.post(
        "/api/auth/login", json={"username": USERNAME, "password": PASSWORD}
    )
    assert res.status_code == 200, res.text
    return res


# ---------------------------------------------------------------------------
# Flag off: nothing changes
# ---------------------------------------------------------------------------
def test_auth_disabled_is_a_no_op(build_app):
    client = build_app()

    assert client.get("/api/auth/me").json() == {
        "authenticated": True,
        "auth_disabled": True,
    }
    assert client.get(PROTECTED_READ).status_code == 200
    assert not client.cookies.get("micasa_session")

    # Mutations go straight through without a CSRF token; 400 is the endpoint's
    # own validation talking, which means the auth layer never intervened.
    res = client.post(PROTECTED_WRITE, json={"name": ""})
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Startup refuses an incomplete configuration
# ---------------------------------------------------------------------------
def test_startup_requires_password_hash(build_app):
    with pytest.raises(RuntimeError, match="AUTH_PASSWORD_HASH"):
        build_app(AUTH_ENABLED="true", AUTH_SECRET=SECRET)


def test_startup_rejects_plaintext_password_hash(build_app):
    with pytest.raises(RuntimeError, match="bcrypt"):
        build_app(
            AUTH_ENABLED="true",
            AUTH_PASSWORD_HASH="hunter2",
            AUTH_SECRET=SECRET,
        )


def test_startup_requires_long_secret(build_app, password_hash):
    with pytest.raises(RuntimeError, match="AUTH_SECRET"):
        build_app(
            AUTH_ENABLED="true",
            AUTH_PASSWORD_HASH=password_hash,
            AUTH_SECRET="short",
        )


# ---------------------------------------------------------------------------
# Login / logout
# ---------------------------------------------------------------------------
def test_login_success_sets_session_and_csrf_cookies(build_app, auth_env):
    client = build_app(**auth_env)

    res = login(client)
    assert res.json() == {"authenticated": True, "username": USERNAME}
    assert client.cookies.get("micasa_session")
    assert client.cookies.get("csrf_token")

    set_cookie = " ".join(res.headers.get_list("set-cookie")).lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie

    assert client.get("/api/auth/me").json() == {
        "authenticated": True,
        "username": USERNAME,
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"username": USERNAME, "password": "wrong"},
        {"username": "nobody", "password": PASSWORD},
        {},
    ],
)
def test_login_failure_is_401_and_generic(build_app, auth_env, payload):
    client = build_app(**auth_env)

    res = client.post("/api/auth/login", json=payload)
    assert res.status_code == 401
    assert res.json()["detail"] == "invalid username or password"
    assert not client.cookies.get("micasa_session")


def test_logout_clears_the_session(build_app, auth_env):
    client = build_app(**auth_env)
    login(client)

    res = client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": client.cookies["csrf_token"]},
    )
    assert res.status_code == 200
    assert not client.cookies.get("micasa_session")
    assert client.get("/api/auth/me").json() == {"authenticated": False}
    assert client.get(PROTECTED_READ).status_code == 401


# ---------------------------------------------------------------------------
# Route protection
# ---------------------------------------------------------------------------
def test_reads_require_a_session(build_app, auth_env):
    client = build_app(**auth_env)

    assert client.get(PROTECTED_READ).status_code == 401
    login(client)
    assert client.get(PROTECTED_READ).status_code == 200


def test_health_and_me_stay_public(build_app, auth_env, tmp_path):
    client = build_app(**auth_env)

    assert client.get("/api/auth/me").json() == {"authenticated": False}
    assert client.get("/api/health").status_code == 200


def test_tampered_session_cookie_is_rejected(build_app, auth_env):
    client = build_app(**auth_env)
    login(client)

    client.cookies.set("micasa_session", "admin.forged.signature")
    assert client.get(PROTECTED_READ).status_code == 401


# ---------------------------------------------------------------------------
# CSRF
# ---------------------------------------------------------------------------
def test_mutation_without_csrf_header_is_rejected(build_app, auth_env):
    client = build_app(**auth_env)
    login(client)

    res = client.post(PROTECTED_WRITE, json={"name": "Acme Plumbing"})
    assert res.status_code == 403


def test_mutation_with_mismatched_csrf_header_is_rejected(build_app, auth_env):
    client = build_app(**auth_env)
    login(client)

    res = client.post(
        PROTECTED_WRITE,
        json={"name": "Acme Plumbing"},
        headers={"X-CSRF-Token": "not-the-cookie"},
    )
    assert res.status_code == 403


def test_mutation_with_matching_csrf_header_passes_the_auth_layer(build_app, auth_env):
    client = build_app(**auth_env)
    login(client)

    # 400 comes from the endpoint's own "name is required" check, i.e. the
    # request cleared both the session and CSRF gates.
    res = client.post(
        PROTECTED_WRITE,
        json={"name": ""},
        headers={"X-CSRF-Token": client.cookies["csrf_token"]},
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Brute-force protection
# ---------------------------------------------------------------------------
def test_repeated_failures_lock_out_with_429(build_app, auth_env):
    client = build_app(**auth_env)
    bad = {"username": USERNAME, "password": "wrong"}

    for _ in range(5):
        assert client.post("/api/auth/login", json=bad).status_code == 401

    res = client.post("/api/auth/login", json=bad)
    assert res.status_code == 429
    assert res.headers.get("Retry-After")

    # The lockout applies to correct credentials too, so it can't be bypassed.
    assert (
        client.post(
            "/api/auth/login", json={"username": USERNAME, "password": PASSWORD}
        ).status_code
        == 429
    )

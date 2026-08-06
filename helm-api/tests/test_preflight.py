"""The preflight check must catch the confusing failures and leak nothing."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.cli.preflight import Finding, check_configuration, main, parse_env_file

CLIENT_SECRET = "super-secret-client-value-do-not-print"

VALID_APP = {
    "AUTH0_ISSUER": "https://helm.eu.auth0.com",
    "AUTH0_CLIENT_ID": "client-id-value",
    "AUTH0_CLIENT_SECRET": CLIENT_SECRET,
    "AUTH0_AUDIENCE": "helm-api",
    "HELM_API_BASE_URL": "http://localhost:8000",
}

VALID_API = {
    "OIDC_ISSUER": "https://helm.eu.auth0.com/",
    "OIDC_JWKS_URL": "https://helm.eu.auth0.com/.well-known/jwks.json",
    "OIDC_AUDIENCE": "helm-api",
    "OIDC_ALLOWED_ALGORITHMS": '["RS256"]',
    "DATABASE_URL": "postgresql+asyncpg://helm_app@localhost/helm",
}


def _keys(findings: list[Finding]) -> set[str]:
    return {finding.key for finding in findings}


def test_a_correct_configuration_produces_no_findings() -> None:
    assert check_configuration(dict(VALID_APP), dict(VALID_API)) == []


def test_trailing_slash_on_the_app_issuer_is_caught() -> None:
    """NextAuth appends discovery paths, so a trailing slash yields a double slash."""

    app_env = dict(VALID_APP) | {"AUTH0_ISSUER": "https://helm.eu.auth0.com/"}
    findings = check_configuration(app_env, dict(VALID_API))
    assert "AUTH0_ISSUER" in _keys(findings)


def test_missing_trailing_slash_on_the_api_issuer_is_caught() -> None:
    """Auth0's `iss` carries a slash and the verifier compares it verbatim."""

    api_env = dict(VALID_API) | {"OIDC_ISSUER": "https://helm.eu.auth0.com"}
    findings = check_configuration(dict(VALID_APP), api_env)
    assert "OIDC_ISSUER" in _keys(findings)


def test_two_different_tenants_are_caught() -> None:
    api_env = dict(VALID_API) | {
        "OIDC_ISSUER": "https://other.eu.auth0.com/",
        "OIDC_JWKS_URL": "https://other.eu.auth0.com/.well-known/jwks.json",
    }
    findings = check_configuration(dict(VALID_APP), api_env)
    assert any("different Auth0 tenant" in finding.problem for finding in findings)


def test_mismatched_audience_is_caught() -> None:
    api_env = dict(VALID_API) | {"OIDC_AUDIENCE": "some-other-api"}
    findings = check_configuration(dict(VALID_APP), api_env)
    assert "AUTH0_AUDIENCE" in _keys(findings)


def test_jwks_url_from_another_origin_is_caught() -> None:
    api_env = dict(VALID_API) | {"OIDC_JWKS_URL": "https://attacker.test/jwks"}
    findings = check_configuration(dict(VALID_APP), api_env)
    assert "OIDC_JWKS_URL" in _keys(findings)


def test_symmetric_algorithm_is_caught() -> None:
    api_env = dict(VALID_API) | {"OIDC_ALLOWED_ALGORITHMS": '["HS256"]'}
    findings = check_configuration(dict(VALID_APP), api_env)
    assert "OIDC_ALLOWED_ALGORITHMS" in _keys(findings)


@pytest.mark.parametrize("key", sorted(VALID_APP))
def test_each_missing_app_key_is_reported(key: str) -> None:
    app_env = dict(VALID_APP) | {key: ""}
    assert key in _keys(check_configuration(app_env, dict(VALID_API)))


@pytest.mark.parametrize("key", ["OIDC_ISSUER", "OIDC_JWKS_URL", "OIDC_AUDIENCE", "DATABASE_URL"])
def test_each_missing_api_key_is_reported(key: str) -> None:
    api_env = dict(VALID_API) | {key: ""}
    assert key in _keys(check_configuration(dict(VALID_APP), api_env))


def test_no_finding_ever_contains_a_configured_value(capsys: pytest.CaptureFixture[str]) -> None:
    """A preflight that leaks the secret it checks is worse than no preflight.

    Every value is made distinctive so a leak by any route -- a finding's text,
    an f-string, an exception -- shows up in captured output.
    """

    # Every value carries a distinctive marker, including both issuers. The
    # issuers previously did not: they were plausible-looking hostnames
    # (`leaky.eu.auth0.com` / `other.eu.auth0.com`) with no marker in the
    # asserted list below, so interpolating `api_issuer` into the
    # tenant-mismatch or trailing-slash findings would have leaked an issuer
    # without failing anything -- while the exactly parallel mutation on
    # `app_audience` WAS caught, purely because audiences had markers and
    # issuers did not. The markers are in the host label so `AUTH0_ISSUER`
    # still has no trailing slash and `OIDC_ISSUER` still has one, keeping
    # each branch reachable for the reason it is meant to be reachable.
    app_env = {
        "AUTH0_ISSUER": "https://leaked-app-issuer-marker.eu.auth0.com/",
        "AUTH0_CLIENT_ID": "leaked-client-id-marker",
        "AUTH0_CLIENT_SECRET": CLIENT_SECRET,
        "AUTH0_AUDIENCE": "leaked-audience-marker",
        "HELM_API_BASE_URL": "http://leaked-host-marker:8000",
    }
    api_env = {
        "OIDC_ISSUER": "https://leaked-api-issuer-marker.eu.auth0.com",
        "OIDC_JWKS_URL": "https://attacker.test/leaked-jwks-marker",
        "OIDC_AUDIENCE": "leaked-api-audience-marker",
        "OIDC_ALLOWED_ALGORITHMS": '["HS256"]',
        "DATABASE_URL": "postgresql://leaked-db-user:leaked-db-password@host/db",
    }

    # Two passes, because the mismatch branches and the missing-key branch are
    # different code with different leak potential.
    #
    # On the missing-key branch specifically: it is guarded by
    # `if not app_env.get(key)`, so the value in scope there is always `''` or
    # `None`. That branch is structurally incapable of leaking a configured
    # value, and this pass does not prove otherwise. What the second pass
    # actually buys is coverage: it makes the missing-key branch execute at all,
    # so the *finding text* it produces is included in the leak scan below, and
    # so a future edit that starts reading some other key's value inside that
    # branch would be seen.
    partial_app = dict(app_env) | {"AUTH0_CLIENT_SECRET": "", "AUTH0_CLIENT_ID": ""}
    partial_api = dict(api_env) | {"DATABASE_URL": ""}

    findings = [
        *check_configuration(app_env, api_env),
        *check_configuration(partial_app, partial_api),
        *check_configuration({}, {}),
    ]
    assert findings, "this fixture must produce findings or the test proves nothing"
    assert any("missing" in finding.problem for finding in findings), (
        "the missing-key branch must be exercised, or a leak there goes unseen"
    )

    rendered = " ".join(f"{finding.key} {finding.problem}" for finding in findings)
    for secret in (
        CLIENT_SECRET,
        "leaked-client-id-marker",
        "leaked-audience-marker",
        "leaked-host-marker",
        "leaked-jwks-marker",
        "leaked-api-audience-marker",
        "leaked-app-issuer-marker",
        "leaked-api-issuer-marker",
        "leaked-db-password",
        "leaked-db-user",
    ):
        assert secret not in rendered

    print(f"Preflight found {len(findings)} problem(s):")
    for finding in findings:
        print(f"  {finding.key}: {finding.problem}")
    captured = capsys.readouterr().out
    assert CLIENT_SECRET not in captured
    assert "leaked-db-password" not in captured


def test_parse_env_file_ignores_comments_and_blanks(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        '# a comment\n\nAUTH0_ISSUER=https://helm.eu.auth0.com\nQUOTED="quoted-value"\nno_equals_sign\n',
        encoding="utf-8",
    )
    values = parse_env_file(env_file)
    assert values == {"AUTH0_ISSUER": "https://helm.eu.auth0.com", "QUOTED": "quoted-value"}


def test_parse_env_file_returns_empty_for_a_missing_file(tmp_path: Path) -> None:
    assert parse_env_file(tmp_path / "does-not-exist") == {}


def test_parse_env_file_returns_empty_for_a_directory(tmp_path: Path) -> None:
    """`is_file()` is the guard, not `exists()`: a directory must not raise."""

    directory = tmp_path / "a-directory"
    directory.mkdir()
    assert parse_env_file(directory) == {}


def test_parse_env_file_surfaces_undecodable_bytes_rather_than_guessing(tmp_path: Path) -> None:
    """A .env that is not UTF-8 must fail loudly, not silently parse as empty.

    `read_text(encoding="utf-8")` raises on undecodable bytes. Swallowing that
    would be the dangerous behaviour: preflight would report every key as
    'missing' for a file that is present and populated, sending the operator to
    fix configuration that is already correct.
    """

    env_file = tmp_path / ".env"
    env_file.write_bytes(b"AUTH0_ISSUER=https://helm.eu.auth0.com\nBROKEN=\xff\xfe\x00bad\n")
    with pytest.raises(UnicodeDecodeError):
        parse_env_file(env_file)


def test_main_exits_zero_on_a_usable_configuration(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Only the failure path was asserted; a main() that always returned 1 passed.

    Writes a matching pair of env files under a temp root and drives the real
    `main()` end to end, so this covers `parse_env_file` -> `check_configuration`
    -> exit code, not just the last of the three.
    """

    (tmp_path / "helm-app").mkdir()
    (tmp_path / "helm-api").mkdir()
    (tmp_path / "helm-app" / ".env.local").write_text(
        "\n".join(f"{key}={value}" for key, value in VALID_APP.items()), encoding="utf-8"
    )
    (tmp_path / "helm-api" / ".env").write_text(
        "\n".join(f"{key}={value}" for key, value in VALID_API.items()), encoding="utf-8"
    )

    monkeypatch.setattr("app.cli.preflight.Path", _RootedPath(tmp_path))
    assert main([]) == 0

    output = capsys.readouterr().out
    assert "Preflight passed" in output
    # The success path must not print a configured value either.
    assert CLIENT_SECRET not in output


def test_main_exits_nonzero_when_configuration_is_absent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """An unconfigured checkout must fail the preflight, not pass it vacuously."""

    monkeypatch.setattr("app.cli.preflight.Path", _RootedPath(tmp_path))
    assert main([]) == 1
    assert "problem" in capsys.readouterr().out


class _RootedPath:
    """Redirects preflight's `Path(__file__).resolve().parents[3]` to a temp root."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def __call__(self, _: object) -> _RootedPath:
        return self

    def resolve(self) -> _RootedPath:
        return self

    @property
    def parents(self) -> dict[int, Path]:
        return {3: self._root}

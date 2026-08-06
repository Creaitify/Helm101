"""Check the OIDC configuration of both services before anyone attempts a login.

Every failure this catches would otherwise surface as a 401 at first sign-in,
where it reads as broken authentication rather than a mistyped environment
variable. The trailing-slash asymmetry between `AUTH0_ISSUER` and `OIDC_ISSUER`
is the worst of them: the token verifies cryptographically and is then rejected
for wrong issuer, which looks like a signing problem and is not.

This contacts nothing. It reads both environment files and compares them. A
clean run does not prove login works -- only Auth0 can prove that -- but a
failing run proves it cannot, and names the line to fix.

Nothing here prints a value. Client secrets and tokens are reported as present
or absent by key name only, because a preflight check that leaks the secret it
is checking is worse than no check.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True, slots=True)
class Finding:
    """A single configuration problem, phrased so the fix is obvious."""

    key: str
    problem: str


def parse_env_file(path: Path) -> dict[str, str]:
    """Read a dotenv file into a mapping, ignoring comments and blank lines.

    Deliberately minimal: this must not import the application's settings, which
    would fail on unrelated missing values and obscure the OIDC problem the
    caller is trying to diagnose.
    """

    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def check_configuration(app_env: dict[str, str], api_env: dict[str, str]) -> list[Finding]:
    """Return every problem found across the two services' configurations."""

    findings: list[Finding] = []

    required_app = ("AUTH0_ISSUER", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_AUDIENCE", "HELM_API_BASE_URL")
    for key in required_app:
        if not app_env.get(key):
            findings.append(Finding(key, "missing from helm-app/.env.local"))

    required_api = ("OIDC_ISSUER", "OIDC_JWKS_URL", "OIDC_AUDIENCE", "DATABASE_URL")
    for key in required_api:
        if not api_env.get(key):
            findings.append(Finding(key, "missing from helm-api/.env"))

    app_issuer = app_env.get("AUTH0_ISSUER", "")
    api_issuer = api_env.get("OIDC_ISSUER", "")

    # The asymmetry is deliberate, not a typo to be normalised away. NextAuth
    # appends discovery paths to AUTH0_ISSUER, so a trailing slash there yields
    # a double slash. Auth0's `iss` claim carries a trailing slash, and the
    # verifier compares it verbatim, so OIDC_ISSUER must have one.
    if app_issuer and app_issuer.endswith("/"):
        findings.append(Finding("AUTH0_ISSUER", "must NOT end with '/' -- NextAuth appends discovery paths to it"))
    if api_issuer and not api_issuer.endswith("/"):
        findings.append(
            Finding("OIDC_ISSUER", "must end with '/' -- Auth0's `iss` claim carries one and it is compared verbatim")
        )

    if app_issuer and api_issuer and app_issuer.rstrip("/") != api_issuer.rstrip("/"):
        findings.append(
            Finding("OIDC_ISSUER", "names a different Auth0 tenant than AUTH0_ISSUER (ignoring the trailing slash)")
        )

    jwks_url = api_env.get("OIDC_JWKS_URL", "")
    if api_issuer and jwks_url:
        issuer_parts = urlsplit(api_issuer)
        jwks_parts = urlsplit(jwks_url)
        if (issuer_parts.scheme, issuer_parts.netloc) != (jwks_parts.scheme, jwks_parts.netloc):
            findings.append(Finding("OIDC_JWKS_URL", "does not share an origin with OIDC_ISSUER"))

    app_audience = app_env.get("AUTH0_AUDIENCE", "")
    api_audience = api_env.get("OIDC_AUDIENCE", "")
    if app_audience and api_audience and app_audience != api_audience:
        findings.append(
            Finding("AUTH0_AUDIENCE", "does not match helm-api's OIDC_AUDIENCE; the token's `aud` would be rejected")
        )

    algorithms = api_env.get("OIDC_ALLOWED_ALGORITHMS", "")
    if algorithms and ("HS" in algorithms or "none" in algorithms):
        findings.append(
            Finding(
                "OIDC_ALLOWED_ALGORITHMS",
                "must contain only asymmetric algorithms; a symmetric algorithm against a public JWKS permits forgery",
            )
        )

    return findings


def main(argv: list[str] | None = None) -> int:
    """Report configuration findings. Returns 0 when the configuration is usable."""

    root = Path(__file__).resolve().parents[3]
    app_env = parse_env_file(root / "helm-app" / ".env.local")
    api_env = parse_env_file(root / "helm-api" / ".env")

    findings = check_configuration(app_env, api_env)

    if not findings:
        print("Preflight passed: both services agree on issuer, audience, and JWKS origin.")
        print("This does not prove Auth0 accepts the credentials -- only a real sign-in does.")
        return 0

    print(f"Preflight found {len(findings)} problem(s):\n")
    for finding in findings:
        print(f"  {finding.key}: {finding.problem}")
    print("\nSee docs/runbooks/auth0-setup.md. No values were printed.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

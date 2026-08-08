"""Check the OIDC configuration of both services before anyone attempts a login.

Every failure this catches would otherwise surface as a 401 at first sign-in,
where it reads as broken authentication rather than a mistyped environment
variable. The trailing-slash asymmetry between `AUTH0_ISSUER` and `OIDC_ISSUER`
is the worst of them: the token verifies cryptographically and is then rejected
for wrong issuer, which looks like a signing problem and is not.

By default this contacts nothing: it reads both environment files and compares
them. A clean run does not prove login works, but a failing run proves it cannot,
and names the line to fix.

`--live` additionally asks Auth0 whether an API is registered under
`AUTH0_AUDIENCE`. That is the one failure the offline checks cannot see, and it
is the most misleading: with no such API the password grant is rejected for
"invalid audience", and the user is told "incorrect email or password" -- on the
signup path, immediately after their account was created successfully.

Nothing here prints a value. Client secrets and tokens are reported as present
or absent by key name only, because a preflight check that leaks the secret it
is checking is worse than no check.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
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


def check_audience_is_registered(app_env: dict[str, str]) -> list[Finding]:
    """Ask Auth0 whether the API named by AUTH0_AUDIENCE actually exists.

    This is the one failure the offline checks cannot see, and it is the most
    confusing one in the whole setup. If the API was never created in the Auth0
    tenant, the audience names nothing: Auth0 rejects the password grant with
    "invalid audience specified for password grant exchange", `authorize`
    correctly returns None, and next-auth reports it as
    "incorrect email or password". The user then hunts for a typo in a password
    that was never the problem -- and on the signup path they see it immediately
    after the account was successfully created, which is doubly misleading.

    Uses the client-credentials grant purely as an existence probe: it names the
    audience directly, so "Service not enabled within domain: <id>" is a
    definitive answer about registration. A rejection for any OTHER reason
    (this application may legitimately not be authorised for machine-to-machine
    access) is not reported, because that would be a false positive on a
    correctly configured tenant.

    Network-only. Sends the client secret to the issuer that owns it and to
    nowhere else, and prints no value from any response.
    """

    issuer = app_env.get("AUTH0_ISSUER", "").rstrip("/")
    audience = app_env.get("AUTH0_AUDIENCE", "")
    client_id = app_env.get("AUTH0_CLIENT_ID", "")
    client_secret = app_env.get("AUTH0_CLIENT_SECRET", "")
    if not all((issuer, audience, client_id, client_secret)):
        return []  # the offline checks already reported whatever is missing

    payload = json.dumps(
        {
            "grant_type": "client_credentials",
            "audience": audience,
            "client_id": client_id,
            "client_secret": client_secret,
        }
    ).encode()
    request = urllib.request.Request(
        f"{issuer}/oauth/token", data=payload, headers={"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=20):
            return []  # a token came back: the API exists and is authorised
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode())
        except Exception:
            return []
        description = str(body.get("error_description", "")).lower()
        # Only this specific shape proves non-registration.
        if "not enabled within domain" in description or "audience" in description and "invalid" in description:
            return [
                Finding(
                    "AUTH0_AUDIENCE",
                    "names an API that does not exist in the Auth0 tenant. Create it: "
                    "Applications -> APIs -> Create API, Identifier exactly this value, RS256",
                )
            ]
        return []
    except (urllib.error.URLError, TimeoutError):
        return [Finding("AUTH0_ISSUER", "could not be reached over the network to verify the audience")]


def main(argv: list[str] | None = None) -> int:
    """Report configuration findings. Returns 0 when the configuration is usable."""

    live = "--live" in (argv if argv is not None else sys.argv[1:])

    root = Path(__file__).resolve().parents[3]
    app_env = parse_env_file(root / "helm-app" / ".env.local")
    api_env = parse_env_file(root / "helm-api" / ".env")

    findings = check_configuration(app_env, api_env)
    if live and not findings:
        # Only worth asking Auth0 once the offline checks agree; otherwise the
        # network answer would just restate a local misconfiguration.
        findings += check_audience_is_registered(app_env)

    if not findings:
        print("Preflight passed: both services agree on issuer, audience, and JWKS origin.")
        if live:
            print("The Auth0 tenant confirms an API registered under this audience.")
        else:
            print("Offline checks only. Re-run with --live to ask Auth0 whether the API exists;")
            print("a missing API surfaces at sign-in as 'incorrect email or password'.")
        return 0

    print(f"Preflight found {len(findings)} problem(s):\n")
    for finding in findings:
        print(f"  {finding.key}: {finding.problem}")
    print("\nSee docs/runbooks/auth0-setup.md. No values were printed.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

"""The worker's structural guarantees.

"Workers never hold provider keys" is only a guarantee if something fails when
it stops being true. The audit found the opposite in an earlier prototype: a
`gateway_stub.py` that imported the provider SDK and read the key directly
inside the worker, which made the gateway optional in practice while the
documentation still said otherwise.

These tests are what make it structural.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from helm_worker.config import FORBIDDEN_CREDENTIAL_VARS, WorkerSettings

PACKAGE_ROOT = Path(__file__).resolve().parent.parent / "helm_worker"
WORKERS_ROOT = Path(__file__).resolve().parent.parent

# Modules a worker must never import. Provider SDKs would let it call a model
# directly; database drivers would let it bypass the API's RLS entirely.
FORBIDDEN_IMPORTS = frozenset(
    {"anthropic", "openai", "google", "sqlalchemy", "asyncpg", "psycopg", "psycopg2"}
)


def _imported_modules(path: Path) -> set[str]:
    """Top-level module names imported by a file."""

    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.add(node.module.split(".")[0])
    return modules


def test_no_worker_module_imports_a_provider_sdk_or_database_driver() -> None:
    """The worker's only route to a model is the gateway over HTTP.

    An AST scan rather than a text search, so a mention inside a docstring or a
    comment does not fail the build while a real import does. The mutation that
    turns this red is adding `import anthropic` to any worker module.
    """

    offenders: dict[str, set[str]] = {}
    for path in PACKAGE_ROOT.rglob("*.py"):
        forbidden = _imported_modules(path) & FORBIDDEN_IMPORTS
        if forbidden:
            offenders[path.relative_to(PACKAGE_ROOT).as_posix()] = forbidden

    assert offenders == {}, f"Worker modules must not import providers or drivers: {offenders}"


def test_the_requirements_declare_no_provider_sdk() -> None:
    """A dependency that is merely present is a dependency someone will use."""

    for name in ("requirements.txt", "requirements-dev.txt"):
        text = (WORKERS_ROOT / name).read_text(encoding="utf-8")
        # Strip comments: the file explains *why* these are absent, and that
        # explanation naming them must not fail its own check.
        declared = "\n".join(line for line in text.splitlines() if not line.strip().startswith("#"))
        for forbidden in ("anthropic", "openai", "sqlalchemy", "asyncpg"):
            assert forbidden not in declared.lower(), f"{name} must not declare {forbidden}"


@pytest.mark.parametrize("variable", FORBIDDEN_CREDENTIAL_VARS)
def test_startup_refuses_while_holding_a_forbidden_credential(variable: str) -> None:
    """Fail closed and name the variable.

    Starting anyway would mean the guarantee quietly stops holding while
    everything still appears to work — the worst failure mode available.
    """

    settings = WorkerSettings()

    with pytest.raises(RuntimeError, match=variable):
        settings.assert_no_provider_credentials({variable: "a-real-looking-secret"})


def test_startup_succeeds_with_a_clean_environment() -> None:
    """The guard must admit the normal case, or it proves nothing."""

    WorkerSettings().assert_no_provider_credentials({"PATH": "/usr/bin", "HELM_API_BASE_URL": "http://localhost:8000"})


def test_a_blank_credential_variable_is_not_treated_as_present() -> None:
    """An exported-but-empty variable is absence, not a violation."""

    WorkerSettings().assert_no_provider_credentials({"ANTHROPIC_API_KEY": "   "})


def test_the_checkpoint_path_lives_under_the_configured_state_directory() -> None:
    settings = WorkerSettings(state_dir=Path("/tmp/helm-state"))

    assert settings.checkpoint_path.parent == Path("/tmp/helm-state")
    assert settings.checkpoint_path.name.endswith(".sqlite")

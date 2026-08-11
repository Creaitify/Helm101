"""The identity-spine migration must widen roles and isolate idempotency keys."""

from __future__ import annotations

from pathlib import Path

import pytest

MIGRATION = Path(__file__).parents[1] / "alembic" / "versions" / "20260730_02_identity_spine.py"


@pytest.fixture(scope="module")
def source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


@pytest.mark.parametrize("role", ["strategist", "creative", "analyst"])
def test_adds_each_new_role_value(source: str, role: str) -> None:
    assert f"'{role}'" in source


def test_creates_the_idempotency_table(source: str) -> None:
    assert "idempotency_keys" in source


def test_idempotency_keys_are_tenant_scoped_with_forced_rls(source: str) -> None:
    assert "tenant_id" in source
    assert "enable row level security" in source
    assert "force row level security" in source
    assert "helm_tenant_id()" in source


def test_idempotency_keys_are_unique_per_tenant(source: str) -> None:
    assert "uq_idempotency_keys_tenant_key" in source


def test_migration_is_reversible(source: str) -> None:
    assert "def downgrade()" in source

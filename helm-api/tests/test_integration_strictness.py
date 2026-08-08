"""A green run must not be able to mean "the database tests never ran".

The container-backed tests are the only ones that exercise RLS, the SECURITY
DEFINER keyholes, and provisioning under a genuinely non-bypass role. Each of
those has already hidden a real defect that unit tests could not see. Skipping
them silently is the "skipped counted as passing" failure recorded as pattern 6
in docs/conventions/test-vacuity.md, so the opt-in strictness switch that
prevents it needs its own tests -- otherwise it is one more thing that quietly
does nothing.
"""

from __future__ import annotations

import pytest

from tests.conftest import require_integration_tests


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", "anything"])
def test_strictness_is_enabled_by_a_set_value(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("HELM_REQUIRE_INTEGRATION_TESTS", value)
    assert require_integration_tests() is True


@pytest.mark.parametrize("value", ["", "0", "false", "FALSE", "no", "  "])
def test_strictness_is_disabled_by_an_empty_or_falsey_value(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """A developer machine without Docker must still be able to run the suite."""

    monkeypatch.setenv("HELM_REQUIRE_INTEGRATION_TESTS", value)
    assert require_integration_tests() is False


def test_strictness_is_off_when_the_variable_is_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HELM_REQUIRE_INTEGRATION_TESTS", raising=False)
    assert require_integration_tests() is False


def test_the_value_is_read_at_call_time_not_import_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reading at import would make the switch unsettable by CI that exports late.

    This also keeps the tests above honest: if the value were captured at import,
    every monkeypatch here would be inert and they would all pass vacuously
    against whatever the environment happened to hold.
    """

    monkeypatch.delenv("HELM_REQUIRE_INTEGRATION_TESTS", raising=False)
    assert require_integration_tests() is False

    monkeypatch.setenv("HELM_REQUIRE_INTEGRATION_TESTS", "1")
    assert require_integration_tests() is True

    monkeypatch.setenv("HELM_REQUIRE_INTEGRATION_TESTS", "0")
    assert require_integration_tests() is False

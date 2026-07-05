"""Regression tests for clean_address / _expand_address_abbrev.

The old expander used greedy `\\s+` and swallowed the street name after
"R "/"Av " prefixes ("R Palmeira das Bermudas, 892" turned into "Rua, 892").
These tests lock in the lookahead-based fix.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import clean_address, _expand_address_abbrev  # noqa: E402


def test_expand_r_prefix_preserves_street_name():
    assert (
        _expand_address_abbrev("R Palmeira das Bermudas, 892")
        == "Rua Palmeira das Bermudas, 892"
    )


def test_expand_r_dot_prefix():
    assert (
        _expand_address_abbrev("R. Palmeira das Bermudas")
        == "Rua Palmeira das Bermudas"
    )


def test_expand_av_prefix():
    assert _expand_address_abbrev("Av Paulista 1000") == "Avenida Paulista 1000"


def test_expand_trav_prefix():
    assert _expand_address_abbrev("Trav do Comércio") == "Travessa do Comércio"


def test_expand_dr_prefix():
    assert _expand_address_abbrev("Dr Alceu Wamosy") == "Doutor Alceu Wamosy"


def test_clean_address_r_prefix_full_pipeline():
    out = clean_address("R Palmeira das Bermudas, 892")
    assert "Rua Palmeira das Bermudas" in out
    assert "892" in out
    assert "São Paulo" in out

import pytest

from hardware_sets.page_ranges import parse_page_range


def test_parses_and_deduplicates_page_ranges() -> None:
    assert parse_page_range("3-5, 5, 8", 10) == [3, 4, 5, 8]


def test_all_is_explicit() -> None:
    assert parse_page_range("all", 3) == [1, 2, 3]


@pytest.mark.parametrize("value", ["", "0", "4", "3-1", "one", "1,,2"])
def test_rejects_invalid_ranges(value: str) -> None:
    with pytest.raises(ValueError):
        parse_page_range(value, 3)


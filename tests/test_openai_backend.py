from pathlib import Path

import pymupdf

from hardware_sets.models import (
    BBox,
    HardwareSet,
    Location,
    ModelExtraction,
    PageRegion,
)
from hardware_sets.openai_backend import _map_subset_pages, extract_openai


class _Response:
    def __init__(self, output_parsed: ModelExtraction) -> None:
        self.output_parsed = output_parsed


class _Responses:
    def __init__(self, parsed: ModelExtraction | None = None) -> None:
        self.arguments: dict[str, object] | None = None
        self.parsed = parsed or ModelExtraction(
            outcome="no_hardware_sets",
            sets=[],
            warnings=["No hardware sets found."],
        )

    def parse(self, **kwargs: object) -> _Response:
        self.arguments = kwargs
        return _Response(self.parsed)


class _Client:
    def __init__(self, responses: _Responses) -> None:
        self.responses = responses


def test_openai_backend_sends_only_selected_pages(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "fixture.pdf"
    document = pymupdf.open()
    for label in ("one", "two", "three"):
        page = document.new_page()
        page.insert_text((48, 72), label)
    document.save(path)
    document.close()

    responses = _Responses()
    monkeypatch.setattr("openai.OpenAI", lambda: _Client(responses))

    result = extract_openai(path, [2], model="test-model")

    assert result.sets == []
    assert responses.arguments is not None
    assert responses.arguments["model"] == "test-model"
    assert responses.arguments["store"] is False
    system_prompt = responses.arguments["input"][0]["content"]  # type: ignore[index]
    assert "PE can mean" in system_prompt
    assert "NO can mean" in system_prompt
    assert "changes in a set-number column" in system_prompt
    assert "Never guess a missing quantity" in system_prompt
    assert "lookup appears before or after" in system_prompt
    assert "Preserve visible source strikeouts" in system_prompt
    user_content = responses.arguments["input"][1]["content"]  # type: ignore[index]
    assert user_content[0]["file_data"].startswith("data:application/pdf;base64,")
    assert "1->2" in user_content[1]["text"]


def test_openai_backend_maps_subset_pages(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "fixture.pdf"
    document = pymupdf.open()
    for _ in range(3):
        document.new_page()
    document.save(path)
    document.close()
    parsed = ModelExtraction(
        outcome="extracted",
        sets=[
            HardwareSet(
                set_number="1",
                description=None,
                status="not_used",
                location=Location(
                    regions=[
                        PageRegion(
                            page=1,
                            bbox=BBox(x0=0.1, y0=0.1, x1=0.9, y1=0.9),
                        )
                    ]
                ),
                components=[],
                confidence=0.8,
            )
        ],
        warnings=[],
    )
    responses = _Responses(parsed)
    monkeypatch.setattr("openai.OpenAI", lambda: _Client(responses))

    result = extract_openai(path, [3], model="test-model")

    assert result.sets[0].location.regions[0].page == 3


def test_subset_mapping_wins_when_page_numbers_overlap() -> None:
    parsed = ModelExtraction(
        outcome="extracted",
        sets=[
            HardwareSet(
                set_number="1",
                description=None,
                status="not_used",
                location=Location(
                    regions=[
                        PageRegion(
                            page=2,
                            bbox=BBox(x0=0.1, y0=0.1, x1=0.9, y1=0.9),
                        )
                    ]
                ),
                components=[],
                confidence=0.8,
            )
        ],
        warnings=[],
    )

    result = _map_subset_pages(parsed, [2, 4])

    assert result.sets[0].location.regions[0].page == 4


def test_openai_schema_uses_fixed_strikethrough_fields() -> None:
    from openai.lib._pydantic import to_strict_json_schema

    schema = to_strict_json_schema(ModelExtraction)
    component_format = schema["$defs"]["ComponentStrikethrough"]
    set_format = schema["$defs"]["SetStrikethrough"]

    for source_format in (component_format, set_format):
        assert source_format["additionalProperties"] is False
        assert "propertyNames" not in source_format

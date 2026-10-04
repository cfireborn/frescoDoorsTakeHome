import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from hardware_sets.models import BBox, ExtractionResult, HardwareSet, ModelExtraction


def hardware_set_payload(*, status: str, components: list[dict[str, object]]) -> dict[str, object]:
    return {
        "set_number": "1",
        "description": None,
        "status": status,
        "location": {
            "regions": [
                {
                    "page": 1,
                    "bbox": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9},
                }
            ]
        },
        "components": components,
        "confidence": 0.8,
    }


def component_payload() -> dict[str, object]:
    return {
        "qty": "1",
        "description": "Hinge",
        "catalog_number": "T4A3386",
        "mfr": "MK",
        "finish": "US26D",
        "notes": None,
        "confidence": {},
    }


def test_bbox_rejects_reversed_coordinates() -> None:
    with pytest.raises(ValidationError):
        BBox(x0=0.8, y0=0.1, x1=0.2, y1=0.9)

    with pytest.raises(ValidationError):
        BBox(x0=0.2, y0=0.1, x1=0.2, y1=0.9)


def test_output_schema_rejects_extra_fields() -> None:
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate(
            {
                "source_file": "spec.pdf",
                "selected_pages": [1],
                "backend": "heuristic",
                "outcome": "no_hardware_sets",
                "sets": [],
                "warnings": [],
                "surprise": True,
            }
        )


def test_output_schema_rejects_unselected_locations() -> None:
    with pytest.raises(ValidationError, match="unselected pages"):
        ExtractionResult.model_validate(
            {
                "source_file": "spec.pdf",
                "selected_pages": [2],
                "backend": "openai",
                "outcome": "extracted",
                "sets": [
                    {
                        "set_number": "1",
                        "description": None,
                        "status": "not_used",
                        "location": {
                            "regions": [
                                {
                                    "page": 1,
                                    "bbox": {"x0": 0.1, "y0": 0.1, "x1": 0.9, "y1": 0.9},
                                }
                            ]
                        },
                        "components": [],
                        "confidence": 0.8,
                    }
                ],
                "warnings": [],
            }
        )


def test_not_used_set_rejects_components() -> None:
    with pytest.raises(ValidationError, match="status=not_used"):
        HardwareSet.model_validate(
            hardware_set_payload(status="not_used", components=[component_payload()])
        )


def test_extracted_result_rejects_empty_active_set() -> None:
    empty_active = HardwareSet.model_validate(
        hardware_set_payload(status="active", components=[])
    )

    with pytest.raises(ValidationError, match="every active set"):
        ModelExtraction(outcome="extracted", sets=[empty_active], warnings=[])


def test_needs_review_result_allows_empty_active_set() -> None:
    empty_active = HardwareSet.model_validate(
        hardware_set_payload(status="active", components=[])
    )

    result = ModelExtraction(
        outcome="needs_review",
        sets=[empty_active],
        warnings=["Set 1 has no parsed components; review the source region."],
    )

    assert result.sets == [empty_active]


def test_shared_browser_result_with_strikethrough_satisfies_python_schema() -> None:
    fixture = Path(__file__).parent / "fixtures" / "strikethrough-result.json"

    result = ExtractionResult.model_validate(json.loads(fixture.read_text()))

    assert result.sets[0].strikethrough["description"][0].end == 5
    assert result.sets[0].components[0].strikethrough["catalog_number"][0].start == 8


def test_strikethrough_ranges_must_match_string_fields() -> None:
    payload = component_payload()
    payload["strikethrough"] = {"notes": [{"start": 0, "end": 1}]}
    with pytest.raises(ValidationError, match="requires a string source field"):
        HardwareSet.model_validate(
            hardware_set_payload(status="active", components=[payload])
        )

    payload = component_payload()
    payload["strikethrough"] = {"description": [{"start": 2, "end": 99}]}
    with pytest.raises(ValidationError, match="exceeds the source field"):
        HardwareSet.model_validate(
            hardware_set_payload(status="active", components=[payload])
        )

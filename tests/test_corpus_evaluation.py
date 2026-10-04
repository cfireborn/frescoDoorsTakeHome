from pathlib import Path

import pytest

from evaluation.evaluate_corpus import (
    COMPONENT_FIELDS,
    DEFAULT_CORPUS_ROOT,
    DEFAULT_SOURCE_MAP,
    CorpusReport,
    evaluate_case,
    evaluate_manifest,
    format_report,
    has_evaluation_failures,
    load_manifest,
    load_source_map,
)


def _region(page: int, *, valid: bool = True) -> dict[str, object]:
    bbox = (
        {"x0": 0.1, "y0": 0.2, "x1": 0.8, "y1": 0.6}
        if valid
        else {"x0": 0.8, "y0": 0.2, "x1": 0.1, "y1": 0.6}
    )
    return {
        "page": page,
        "bbox": bbox,
        "line_start": 1,
        "line_end": 2,
    }


def _set(
    set_number: str,
    status: str,
    component_count: int,
    regions: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "set_number": set_number,
        "status": status,
        "components": [{} for _ in range(component_count)],
        "location": {"regions": regions},
    }


def test_manifest_contains_only_valid_manually_checked_labels() -> None:
    manifest = load_manifest()

    assert {case["id"] for case in manifest["cases"]} == {
        "case_01_cross_page",
        "case_02_dense_table",
        "case_03_short_schedule",
        "case_04_not_used",
        "case_05_multi_page_excerpt",
        "case_06_incomplete_external_schedule",
        "case_07_no_sets",
    }
    not_used_case = next(
        case for case in manifest["cases"] if case["id"] == "case_04_not_used"
    )
    assert not_used_case["expected"]["component_total"] == 142
    assert {
        hardware_set["set_number"]
        for hardware_set in not_used_case["expected"]["sets"]
        if hardware_set["status"] == "not_used"
    } == {"05", "16", "21", "22"}
    component_labels = [
        component
        for case in manifest["cases"]
        for hardware_set in case["expected"]["sets"]
        for component in hardware_set.get("components", [])
    ]
    assert len(component_labels) == 13
    assert sum(
        field_name in component
        for component in component_labels
        for field_name in COMPONENT_FIELDS
    ) == 65
    assert any(
        component.get("mfr") == "PE" and component.get("finish") is None
        for component in component_labels
    )
    assert any(component.get("qty", "not-labeled") is None for component in component_labels)


def test_manifest_pdf_paths_resolve_when_private_corpus_is_present() -> None:
    if not DEFAULT_CORPUS_ROOT.is_dir() or not DEFAULT_SOURCE_MAP.is_file():
        pytest.skip("private corpus is not available")

    manifest = load_manifest()
    source_map = load_source_map()
    missing = [
        source_map[case["source"]]
        for case in manifest["cases"]
        if not (DEFAULT_CORPUS_ROOT / source_map[case["source"]]).is_file()
    ]
    assert missing == []


def test_committed_manifest_does_not_disclose_private_source_paths() -> None:
    manifest = load_manifest()

    assert all("pdf" not in case for case in manifest["cases"])
    assert {case["source"] for case in manifest["cases"]} == {
        f"case_{index:02d}" for index in range(1, 8)
    }


def test_evaluator_reports_all_requested_metrics() -> None:
    case = {
        "id": "synthetic",
        "pages": "10-11",
        "expected": {
            "outcome": "extracted",
            "component_total": 2,
            "sets": [
                {
                    "set_number": "A",
                    "status": "active",
                    "component_count": 2,
                    "pages": [10, 11],
                    "components": [
                        {
                            "component_index": 0,
                            "qty": "1",
                            "description": "HINGE",
                            "catalog_number": "H1",
                            "mfr": "IVE",
                            "finish": "630",
                        },
                        {"component_index": 1, "qty": None},
                    ],
                },
                {
                    "set_number": "B",
                    "status": "not_used",
                    "component_count": 0,
                    "pages": [11],
                },
            ],
        },
    }
    actual = {
        "outcome": "extracted",
        "sets": [
            {
                **_set("A", "active", 2, [_region(10), _region(11)]),
                "components": [
                    {
                        "qty": "1",
                        "description": "HINGE",
                        "catalog_number": "H1",
                        "mfr": "IVE",
                        "finish": "626",
                    },
                    {"qty": None},
                ],
            },
            _set("B", "active", 1, [_region(11, valid=False)]),
            _set("C", "active", 0, [_region(10)]),
        ],
    }

    case_report = evaluate_case(case, actual)
    report = CorpusReport(cases=[case_report])
    summary = report.to_dict()["summary"]

    assert summary["set_precision"] == pytest.approx(2 / 3)
    assert summary["set_recall"] == 1
    assert summary["status_accuracy"] == pytest.approx(1 / 2)
    assert summary["component_count_agreement"] == pytest.approx(1 / 3)
    assert summary["component_field_accuracy"] == pytest.approx(5 / 6)
    assert summary["component_field_checked"] == 6
    assert summary["component_row_accuracy"] == pytest.approx(1 / 2)
    assert summary["component_row_checked"] == 2
    assert summary["component_rows_checked"] == 2
    assert summary["page_region_validity"] == pytest.approx(1 / 2)
    assert summary["outcome_accuracy"] == 1
    assert any("unexpected set 'C'" in item for item in case_report.mismatches)

    rendered = format_report(report)
    assert "Set precision: 66.7% (2/3)" in rendered
    assert "Component-count agreement: 33.3% (1/3)" in rendered
    assert "Component-field accuracy: 83.3% (5/6) across 2 rows" in rendered
    assert "Labeled-row exact accuracy: 50.0% (1/2)" in rendered
    assert any("component 0 finish" in item for item in case_report.mismatches)
    assert has_evaluation_failures(report)


@pytest.mark.parametrize(
    ("components", "expected_marker"),
    [([], "<missing component>"), ([{}], "<missing field>")],
)
def test_missing_component_or_field_does_not_match_an_expected_null(
    components: list[dict[str, object]], expected_marker: str
) -> None:
    case = {
        "id": "missing-component",
        "pages": "1",
        "expected": {
            "sets": [
                {
                    "set_number": "A",
                    "status": "active",
                    "pages": [1],
                    "components": [{"component_index": 0, "qty": None}],
                }
            ]
        },
    }
    actual_set = _set("A", "active", 0, [_region(1)])
    actual_set["components"] = components
    actual = {"sets": [actual_set]}

    report = evaluate_case(case, actual)

    assert report.component_field.checked == 1
    assert report.component_field.correct == 0
    assert report.component_rows_checked == 1
    assert any(f"got {expected_marker}" in item for item in report.mismatches)


def test_duplicate_set_numbers_are_scored_by_occurrence() -> None:
    case = {
        "id": "duplicate-ids",
        "pages": "3-4",
        "expected": {
            "sets": [
                {"set_number": "MISC", "occurrence": 1, "status": "active", "pages": [3]},
                {"set_number": "MISC", "occurrence": 2, "status": "active", "pages": [4]},
            ]
        },
    }
    actual = {
        "sets": [
            _set("MISC", "active", 1, [_region(3)]),
            _set("MISC", "active", 2, [_region(4)]),
        ]
    }

    report = evaluate_case(case, actual)

    assert report.set_true_positives == 2
    assert report.set_false_positives == 0
    assert report.set_false_negatives == 0
    assert report.page_region == report.status
    assert report.page_region.correct == 2


def test_missing_private_corpus_is_skipped_cleanly(tmp_path: Path) -> None:
    manifest = load_manifest()

    report = evaluate_manifest(manifest, tmp_path)

    assert len(report.cases) == len(manifest["cases"])
    assert all(case.skipped for case in report.cases)
    assert report.set_precision is None
    assert report.set_recall is None
    assert not has_evaluation_failures(report)
    assert has_evaluation_failures(report, require_all=True)

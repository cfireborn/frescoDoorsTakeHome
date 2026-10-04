import warnings

from hardware_sets.heuristic import extract_heuristic, resolve_code_role
from hardware_sets.models import BBox, ComponentStrikethrough, SetStrikethrough
from hardware_sets.pdf import PageText, TextLine, Word


def line(page: int, number: int, text: str, *, x0: float = 0.12) -> TextLine:
    bbox = BBox(x0=x0, y0=number / 20, x1=0.9, y1=(number + 0.5) / 20)
    words = tuple(Word(text=token, bbox=bbox) for token in text.split())
    return TextLine(page=page, number=number, text=text, bbox=bbox, words=words)


def strike_words(source: TextLine, texts: set[str] | None = None) -> TextLine:
    words = tuple(
        Word(
            text=word.text,
            bbox=word.bbox,
            block=word.block,
            is_struck=texts is None or word.text in texts,
        )
        for word in source.words
    )
    return TextLine(
        page=source.page,
        number=source.number,
        text=source.text,
        bbox=source.bbox,
        words=words,
        gap_before=source.gap_before,
        block=source.block,
    )


def strike_word_indexes(source: TextLine, indexes: set[int]) -> TextLine:
    words = tuple(
        Word(
            text=word.text,
            bbox=word.bbox,
            block=word.block,
            is_struck=index in indexes,
        )
        for index, word in enumerate(source.words)
    )
    return TextLine(
        page=source.page,
        number=source.number,
        text=source.text,
        bbox=source.bbox,
        words=words,
        gap_before=source.gap_before,
        block=source.block,
    )


def row(
    page: int,
    number: int,
    cells: tuple[tuple[float, str], ...],
    *,
    block: int = 0,
    gap_before: float = 0.004,
) -> TextLine:
    words: list[Word] = []
    y0 = number / 30
    y1 = y0 + 0.015
    for cell_x, value in cells:
        x = cell_x
        for token in value.split():
            width = max(0.012, len(token) * 0.006)
            bbox = BBox(x0=x, y0=y0, x1=min(x + width, 0.99), y1=y1)
            words.append(Word(text=token, bbox=bbox, block=block))
            x += width + 0.006
    bbox = BBox(
        x0=min(word.bbox.x0 for word in words),
        y0=y0,
        x1=max(word.bbox.x1 for word in words),
        y1=y1,
    )
    return TextLine(
        page=page,
        number=number,
        text=" ".join(word.text for word in words),
        bbox=bbox,
        words=tuple(words),
        gap_before=gap_before,
        block=block,
    )


def positioned_line(
    page: int, number: int, items: tuple[tuple[str, float, float], ...]
) -> TextLine:
    y0 = number / 30
    y1 = y0 + 0.015
    words = tuple(
        Word(text=text, bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1))
        for text, x0, x1 in items
    )
    return TextLine(
        page=page,
        number=number,
        text=" ".join(word.text for word in words),
        bbox=BBox(
            x0=min(word.bbox.x0 for word in words),
            y0=y0,
            x1=max(word.bbox.x1 for word in words),
            y1=y1,
        ),
        words=words,
    )


def test_extracts_list_not_used_and_mult_page_sets() -> None:
    pages = [
        PageText(
            page=10,
            lines=(
                line(10, 16, "SET #3A - ENTRY DOORS", x0=0.05),
                line(10, 17, "3 Hinge T4A3386 MK US26D"),
                line(10, 18, "Closer 4040XP LCN 689"),
            ),
        ),
        PageText(
            page=11,
            lines=(
                line(11, 1, "1 Threshold 2005 PE 630"),
                line(11, 5, "SET #4 - NOT USED", x0=0.05),
                line(11, 6, "N/A"),
            ),
        ),
    ]

    result = extract_heuristic(pages)

    assert [item.set_number for item in result.sets] == ["3A", "4"]
    assert [region.page for region in result.sets[0].location.regions] == [10, 11]
    assert result.sets[0].components[1].qty is None
    assert result.sets[1].status == "not_used"
    assert result.sets[1].components == []


def test_ambiguous_pe_uses_column_context() -> None:
    assert resolve_code_role(["MK", "PE", "LCN"], "Code") == "mfr"
    assert resolve_code_role(["US26D", "PE", "630"], "Code") == "finish"
    assert resolve_code_role(["PE"], "Code") is None
    assert resolve_code_role(["PE"], "Manufacturer") == "mfr"


def test_geometry_inferred_finish_is_removed_from_catalog_group() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #1 - ENTRY", x0=0.05),
            positioned_line(
                1,
                2,
                (
                    ("1.0", 0.118, 0.140),
                    ("Mortise", 0.153, 0.206),
                    ("Cylinder", 0.211, 0.271),
                    ("CR1000-XXX-CAM-7", 0.382, 0.536),
                    ("59D1", 0.541, 0.580),
                    ("(TIE", 0.585, 0.616),
                    ("TO", 0.620, 0.643),
                    ("SYSTEM)", 0.647, 0.720),
                    ("626", 0.741, 0.768),
                    ("C-R", 0.816, 0.845),
                ),
            ),
        ),
    )

    component = extract_heuristic([page]).sets[0].components[0]

    assert component.catalog_number == "CR1000-XXX-CAM-7 59D1 (TIE TO SYSTEM)"
    assert component.finish == "626"
    assert component.mfr == "C-R"


def test_known_three_digit_finish_is_not_left_in_notes() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #1 - ENTRY", x0=0.05),
            positioned_line(
                1,
                2,
                (
                    ("1", 0.114, 0.123),
                    ("EA", 0.163, 0.184),
                    ("PANIC", 0.220, 0.268),
                    ("HARDWARE", 0.273, 0.368),
                    ("33A-NL-OP-388", 0.440, 0.557),
                    ("315", 0.779, 0.806),
                    ("VON", 0.849, 0.884),
                ),
            ),
        ),
    )

    component = extract_heuristic([page]).sets[0].components[0]

    assert component.catalog_number == "33A-NL-OP-388"
    assert component.finish == "315"
    assert component.mfr == "VON"
    assert component.notes is None


def test_unheaded_component_schedule_requires_review() -> None:
    page = PageText(
        page=1,
        lines=(
            row(
                1,
                1,
                (
                    (0.05, "QTY"),
                    (0.18, "DESCRIPTION"),
                    (0.50, "CATALOG"),
                    (0.72, "MFR"),
                    (0.84, "FINISH"),
                ),
                block=1,
            ),
            row(
                1,
                2,
                (
                    (0.05, "3"),
                    (0.18, "Hinge"),
                    (0.50, "T4A3386"),
                    (0.72, "MK"),
                    (0.84, "US26D"),
                ),
                block=1,
            ),
            row(
                1,
                3,
                (
                    (0.05, "1"),
                    (0.18, "Closer"),
                    (0.50, "4040XP"),
                    (0.72, "LCN"),
                    (0.84, "689"),
                ),
                block=1,
            ),
        ),
    )

    result = extract_heuristic([page])

    assert result.outcome == "needs_review"
    assert result.sets == []
    assert any("no recoverable hardware set identifier" in warning for warning in result.warnings)


def test_ordinary_hardware_prose_without_sets_is_not_escalated() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "Door hardware shall comply with the referenced standards."),
            line(1, 2, "Coordinate closer installation with the door supplier."),
            line(1, 3, "Submit product data before fabrication."),
        ),
    )

    result = extract_heuristic([page])

    assert result.outcome == "no_hardware_sets"
    assert result.sets == []


def test_extraction_uses_column_context_for_ambiguous_pe() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #1 - ENTRY", x0=0.05),
            line(1, 2, "1 Hinge MK"),
            line(1, 3, "1 Threshold PE"),
            line(1, 4, "1 Closer LCN"),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].components[1].mfr == "PE"
    assert result.sets[0].components[1].finish is None


def test_assignment_style_option_lookup_adds_resolution_note() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "OPTION LIST", x0=0.05),
            line(1, 2, "NRP = Non-Removable Pins", x0=0.05),
            line(1, 3, "SET #1 - ENTRY", x0=0.05),
            line(1, 4, "3 Hinge T4A3386 NRP MK US26D"),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].components[0].notes == "Option NRP = Non-Removable Pins"


def test_ambiguous_lookup_notes_follow_the_detected_column_role() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "MANUFACTURER LIST", x0=0.05),
            line(1, 2, "PE = Pemko", x0=0.05),
            line(1, 3, "FINISH LIST", x0=0.05),
            line(1, 4, "PE = Painted Enamel", x0=0.05),
            line(1, 5, "SET #1 - ENTRY", x0=0.05),
            row(
                1,
                6,
                (
                    (0.05, "QTY"),
                    (0.18, "DESCRIPTION"),
                    (0.48, "CATALOG"),
                    (0.68, "MFR"),
                    (0.80, "FINISH"),
                ),
            ),
            row(
                1,
                7,
                (
                    (0.05, "1"),
                    (0.18, "Threshold"),
                    (0.48, "2005"),
                    (0.68, "PE"),
                    (0.80, "630"),
                ),
            ),
            row(
                1,
                8,
                (
                    (0.05, "1"),
                    (0.18, "Hinge"),
                    (0.48, "T4A3386"),
                    (0.68, "MK"),
                    (0.80, "PE"),
                ),
            ),
        ),
    )

    components = extract_heuristic([page]).sets[0].components

    assert components[0].notes == "Manufacturer PE = Pemko"
    assert components[1].notes == "Finish PE = Painted Enamel"


def test_disjoint_pages_do_not_continue_a_set() -> None:
    pages = [
        PageText(
            page=3,
            lines=(
                line(3, 1, "SET #1 - ENTRY", x0=0.05),
                line(3, 2, "1 Hinge T4A3386 MK US26D"),
            ),
        ),
        PageText(page=20, lines=(line(20, 1, "General notes unrelated sentence"),)),
    ]

    result = extract_heuristic(pages)

    assert [region.page for region in result.sets[0].location.regions] == [3]
    assert len(result.sets[0].components) == 1


def test_adjacent_page_without_continuation_evidence_is_not_appended() -> None:
    pages = [
        PageText(
            page=3,
            lines=(
                line(3, 1, "SET #1 - ENTRY", x0=0.05),
                line(3, 2, "1 Hinge T4A3386 MK US26D"),
            ),
        ),
        PageText(page=4, lines=(line(4, 1, "1 Lock testing laboratory report"),)),
    ]

    result = extract_heuristic(pages)

    assert [region.page for region in result.sets[0].location.regions] == [3]
    assert len(result.sets[0].components) == 1
    assert "Ignored 1 component-like row" in result.warnings[0]


def test_repeated_header_continues_the_same_set() -> None:
    pages = [
        PageText(page=3, lines=(line(3, 1, "SET #1 - ENTRY", x0=0.05),)),
        PageText(
            page=4,
            lines=(
                line(4, 1, "SET #1 - ENTRY", x0=0.05),
                line(4, 2, "1 Closer 4040XP LCN 689"),
            ),
        ),
    ]

    result = extract_heuristic(pages)

    assert len(result.sets) == 1
    assert [region.page for region in result.sets[0].location.regions] == [3, 4]


def test_continued_header_merges_even_when_prior_rows_do_not_reach_page_bottom() -> None:
    pages = [
        PageText(
            page=3,
            lines=(
                line(3, 1, "SET #3A - MAIN ENTRY", x0=0.05),
                line(3, 2, "1 Hinge T4A3386 MK US26D"),
            ),
        ),
        PageText(
            page=4,
            lines=(
                line(4, 1, "SET #3A - MAIN ENTRY CONTINUED", x0=0.05),
                line(4, 2, "1 Closer 4040XP LCN 689"),
            ),
        ),
    ]

    result = extract_heuristic(pages)

    assert len(result.sets) == 1
    assert len(result.sets[0].components) == 2
    assert [region.page for region in result.sets[0].location.regions] == [3, 4]


def test_same_page_duplicate_explicit_set_number_starts_a_new_occurrence() -> None:
    page = PageText(
        page=3,
        lines=(
            line(3, 1, "SET #1 - ENTRY", x0=0.05),
            line(3, 2, "1 Hinge T4A3386 MK US26D"),
            line(3, 5, "SET #1 - ENTRY", x0=0.05),
            line(3, 6, "1 Closer 4040XP LCN 689"),
        ),
    )

    result = extract_heuristic([page])

    assert [item.set_number for item in result.sets] == ["1", "1"]
    assert [item.components[0].description for item in result.sets] == [
        "Hinge T4A3386",
        "Closer 4040XP",
    ]


def test_struck_set_and_component_words_become_field_ranges() -> None:
    page = PageText(
        page=1,
        lines=(
            strike_words(
                line(1, 1, "SET #7 - ENTRY", x0=0.05),
                {"#7", "ENTRY"},
            ),
            row(
                1,
                2,
                (
                    (0.05, "QTY"),
                    (0.18, "DESCRIPTION"),
                    (0.50, "CATALOG"),
                    (0.72, "FINISH"),
                    (0.86, "MFR"),
                ),
                block=4,
            ),
            strike_words(
                row(
                    1,
                    3,
                    (
                        (0.05, "1"),
                        (0.18, "OH Concealed Closer"),
                        (0.50, "2031"),
                        (0.72, "689"),
                        (0.86, "LCN"),
                    ),
                    block=4,
                ),
                {"OH", "Concealed", "Closer", "2031", "689", "LCN"},
            ),
        ),
    )

    hardware_set = extract_heuristic([page]).sets[0]
    component = hardware_set.components[0]

    assert [item.model_dump() for item in hardware_set.strikethrough["set_number"]] == [
        {"start": 0, "end": 1}
    ]
    assert [item.model_dump() for item in hardware_set.strikethrough["description"]] == [
        {"start": 0, "end": 5}
    ]
    assert [item.model_dump() for item in component.strikethrough["description"]] == [
        {"start": 0, "end": 19}
    ]
    assert component.strikethrough["catalog_number"][0].end == 4
    assert component.strikethrough["finish"][0].end == 3
    assert component.strikethrough["mfr"][0].end == 3


def test_only_second_repeated_source_token_maps_to_second_output_range() -> None:
    page = PageText(
        page=1,
        lines=(
            strike_word_indexes(
                line(1, 1, "SET #7 - ENTRY ENTRY", x0=0.05),
                {4},
            ),
            line(1, 2, "1 Hinge T4A3386 MK US26D"),
        ),
    )

    hardware_set = extract_heuristic([page]).sets[0]

    assert [item.model_dump() for item in hardware_set.strikethrough["description"]] == [
        {"start": 6, "end": 11}
    ]


def test_set_label_does_not_consume_matching_description_tokens() -> None:
    for description, expected in (
        ("SET SET", {"start": 4, "end": 7}),
        ("LOCK SET", {"start": 5, "end": 8}),
    ):
        page = PageText(
            page=1,
            lines=(
                strike_word_indexes(
                    line(1, 1, f"SET #7 - {description}", x0=0.05),
                    {4},
                ),
                line(1, 2, "1 Hinge T4A3386 MK US26D"),
            ),
        )

        hardware_set = extract_heuristic([page]).sets[0]

        assert [
            item.model_dump()
            for item in hardware_set.strikethrough["description"]
        ] == [expected]


def test_model_copy_strikethrough_updates_remain_typed_and_serialize_cleanly() -> None:
    page = PageText(
        page=1,
        lines=(
            strike_words(line(1, 1, "SET #7 - ENTRY", x0=0.05), {"ENTRY"}),
            strike_words(
                line(1, 2, "1 OH Concealed Closer 2031 LCN 689"),
                {"OH", "Concealed", "Closer"},
            ),
            line(1, 3, "Note: Closer removed."),
        ),
    )

    hardware_set = extract_heuristic([page]).sets[0]
    component = hardware_set.components[0]

    assert isinstance(hardware_set.strikethrough, SetStrikethrough)
    assert isinstance(component.strikethrough, ComponentStrikethrough)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        hardware_set.model_dump_json()
    assert not any(
        "PydanticSerializationUnexpectedValue" in str(item.message) for item in caught
    )


def test_struck_and_live_page_break_occurrences_are_not_merged() -> None:
    pages = [
        PageText(
            page=1,
            lines=(
                strike_words(line(1, 1, "SET #7 - ENTRY", x0=0.05)),
                line(1, 17, "1 OH Concealed Closer 2031 LCN 689"),
            ),
        ),
        PageText(
            page=2,
            lines=(
                line(2, 1, "SET #7 - ENTRY", x0=0.05),
                line(2, 2, "1 Surface Closer 4040XP LCN 689"),
            ),
        ),
    ]

    result = extract_heuristic(pages)

    assert [item.set_number for item in result.sets] == ["7", "7"]
    assert result.sets[0].strikethrough
    assert result.sets[1].strikethrough == {}


def test_note_continuation_is_attached_without_creating_a_component() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #7 - ENTRY", x0=0.05),
            line(1, 2, "1 OH Concealed Closer 2031 LCN 689"),
            line(1, 3, "Note: NYS standards do not approve closers in High Risk areas"),
            line(1, 4, "Closer removed."),
        ),
    )

    components = extract_heuristic([page]).sets[0].components

    assert len(components) == 1
    assert components[0].notes == (
        "NYS standards do not approve closers in High Risk areas; Closer removed."
    )


def test_incidental_standalone_na_does_not_clear_prior_rows() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #4", x0=0.05),
            line(1, 2, "1 Hinge T4A3386"),
            line(1, 3, "N/A"),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].status == "active"
    assert len(result.sets[0].components) == 1


def test_standalone_not_used_before_components_marks_the_set() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #4", x0=0.05),
            line(1, 2, "N/A"),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].status == "not_used"
    assert result.sets[0].components == []


def test_not_used_status_can_follow_the_set_number_without_a_delimiter() -> None:
    for heading in ("SET #4 NOT USED", "SET #4 (NOT USED)"):
        page = PageText(
            page=1,
            lines=(
                line(1, 1, heading, x0=0.05),
                line(1, 2, "GENERAL REQUIREMENTS"),
                line(1, 3, "END OF SECTION"),
            ),
        )

        result = extract_heuristic([page])

        assert [item.set_number for item in result.sets] == ["4"]
        assert result.sets[0].status == "not_used"
        assert result.sets[0].components == []


def test_accepts_real_world_set_heading_variants() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "Hardware Group No. 025", x0=0.05),
            line(1, 2, "1 Hinge T4A3386 MK US26D"),
            line(1, 3, "Hardware Set No. 3A", x0=0.05),
            line(1, 4, "1 Closer 4040XP LCN 689"),
            line(1, 5, "Set #AL 01 - ACCESS CONTROL", x0=0.05),
            line(1, 6, "1 Electric Lock ND80 SCH 626"),
        ),
    )

    result = extract_heuristic([page])

    assert [item.set_number for item in result.sets] == ["025", "3A", "AL 01"]
    assert result.sets[2].description == "ACCESS CONTROL"


def test_direct_hw_heading_and_moved_set_are_recognized() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "HW 06A Moved to Exterior Set HW E11", x0=0.05),
            line(1, 2, "HW 07 Interior Single - Privacy", x0=0.05),
            line(1, 3, "1 OH Concealed Closer 2031 LCN 689"),
        ),
    )

    result = extract_heuristic([page])

    assert [item.set_number for item in result.sets] == ["06A", "07"]
    assert result.sets[0].status == "not_used"
    assert result.sets[1].description == "Interior Single - Privacy"


def test_set_column_changes_split_sets_without_a_set_keyword() -> None:
    page = PageText(
        page=1,
        lines=(
            row(
                1,
                1,
                (
                    (0.04, "SET"),
                    (0.16, "HARDWARE TYPE"),
                    (0.46, "MANUFACTURER-PRODUCT"),
                    (0.70, "QTY"),
                    (0.79, "FINISH"),
                    (0.90, "NOTES"),
                ),
                block=2,
            ),
            row(
                1,
                2,
                (
                    (0.04, "1.1"),
                    (0.16, "Hinge"),
                    (0.46, "MK T4A3386"),
                    (0.70, "3"),
                    (0.79, "US26D"),
                ),
                block=2,
            ),
            row(
                1,
                3,
                ((0.16, "Closer"), (0.46, "LCN 4040XP"), (0.70, "1"), (0.79, "689")),
                block=2,
            ),
            row(
                1,
                4,
                ((0.04, "1.2"), (0.16, "Threshold"), (0.46, "PE 2005"), (0.79, "630")),
                block=2,
            ),
        ),
    )

    result = extract_heuristic([page])

    assert [item.set_number for item in result.sets] == ["1.1", "1.2"]
    assert [len(item.components) for item in result.sets] == [2, 1]
    assert result.sets[0].components[0].catalog_number == "T4A3386"
    assert result.sets[1].components[0].qty is None


def test_combined_column_preserves_multiple_manufacturers_before_product() -> None:
    page = PageText(
        page=1,
        lines=(
            row(
                1,
                1,
                (
                    (0.04, "SET"),
                    (0.16, "HARDWARE TYPE"),
                    (0.40, "MANUFACTURER-PRODUCT"),
                    (0.90, "QTY"),
                    (0.95, "FINISH"),
                ),
                block=2,
            ),
            row(
                1,
                2,
                (
                    (0.04, "1.1"),
                    (0.16, "GASKETING / SWEEP"),
                    (0.40, "PEMKO / NGP / ZERO - WEATHER GASKETING & SWEEP"),
                    (0.90, "--"),
                    (0.95, "BLACK"),
                ),
                block=2,
            ),
        ),
    )

    result = extract_heuristic([page])

    component = result.sets[0].components[0]
    assert component.qty is None
    assert component.mfr == "PEMKO / NGP / ZERO"
    assert component.catalog_number == "WEATHER GASKETING & SWEEP"
    assert component.finish == "BLACK"


def test_two_word_hardware_set_header_is_one_column() -> None:
    page = PageText(
        page=1,
        lines=(
            row(
                1,
                1,
                (
                    (0.04, "HARDWARE SET"),
                    (0.20, "QTY"),
                    (0.33, "DESCRIPTION"),
                    (0.72, "CATALOG"),
                ),
                block=3,
            ),
            row(
                1,
                2,
                ((0.04, "6A"), (0.20, "1"), (0.33, "Closer"), (0.72, "4040XP")),
                block=3,
            ),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].set_number == "6A"
    assert result.sets[0].components[0].description == "Closer"


def test_blank_gap_supports_a_bare_set_boundary() -> None:
    page = PageText(
        page=2,
        lines=(
            row(2, 1, ((0.05, "SET #1 - ENTRY"),), block=1),
            row(2, 2, ((0.12, "1 Hinge T4A3386 MK US26D"),), block=1),
            row(2, 3, ((0.05, "2 SERVICE"),), block=1, gap_before=0.08),
            row(2, 4, ((0.12, "1 Closer 4040XP LCN 689"),), block=1),
        ),
    )

    result = extract_heuristic([page])

    assert [item.set_number for item in result.sets] == ["1", "2"]
    assert result.sets[1].description == "SERVICE"


def test_status_is_exact_and_does_not_match_an_incidental_note() -> None:
    page = PageText(
        page=1,
        lines=(
            row(
                1,
                1,
                ((0.04, "SET"), (0.16, "DESCRIPTION"), (0.60, "QTY"), (0.74, "NOTES")),
                block=4,
            ),
            row(
                1,
                2,
                (
                    (0.04, "4.1"),
                    (0.16, "Electric Lock"),
                    (0.60, "N/A"),
                    (0.74, "N/A when electrified"),
                ),
                block=4,
            ),
            row(1, 3, ((0.04, "4.2"), (0.16, "NOT USED")), block=4),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].status == "active"
    assert result.sets[0].components[0].qty is None
    assert result.sets[0].components[0].notes == "N/A when electrified"
    assert result.sets[1].status == "not_used"
    assert result.sets[1].components == []


def test_reordered_columns_and_missing_columns_are_supported() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #8 - SERVICE", x0=0.05),
            row(
                1,
                2,
                (
                    (0.05, "FINISH"),
                    (0.18, "ITEM"),
                    (0.50, "QTY"),
                    (0.62, "PRODUCT"),
                    (0.82, "MFR"),
                ),
                block=7,
            ),
            row(
                1,
                3,
                (
                    (0.05, "US26D"),
                    (0.18, "Standard Hinge"),
                    (0.50, "BY OTHERS"),
                    (0.62, "T4A3386"),
                    (0.82, "MK"),
                ),
                block=7,
            ),
        ),
    )

    component = extract_heuristic([page]).sets[0].components[0]

    assert component.qty is None
    assert component.description == "Standard Hinge"
    assert component.catalog_number == "T4A3386"
    assert component.mfr == "MK"
    assert component.finish == "US26D"


def test_manf_header_alias_keeps_manufacturer_out_of_finish() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #8 - SERVICE", x0=0.05),
            row(
                1,
                2,
                (
                    (0.05, "QUANTITY"),
                    (0.18, "DESCRIPTION"),
                    (0.50, "MODEL"),
                    (0.72, "FINISH"),
                    (0.86, "MANF"),
                ),
                block=8,
            ),
            row(
                1,
                3,
                (
                    (0.05, "1"),
                    (0.18, "Door Stop"),
                    (0.50, "1841"),
                    (0.72, "630"),
                    (0.86, "ABH"),
                ),
                block=8,
            ),
        ),
    )

    component = extract_heuristic([page]).sets[0].components[0]

    assert component.mfr == "ABH"
    assert component.finish == "630"


def test_wrapped_rows_merge_but_a_missing_quantity_starts_a_component() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #8 - SERVICE", x0=0.05),
            row(
                1,
                2,
                (
                    (0.06, "QTY"),
                    (0.18, "DESCRIPTION"),
                    (0.57, "CATALOG"),
                    (0.76, "MFR"),
                    (0.87, "NOTES"),
                ),
                block=9,
            ),
            row(
                1,
                3,
                ((0.06, "1"), (0.18, "Door Closer"), (0.57, "4040XP"), (0.76, "LCN")),
                block=9,
            ),
            row(
                1,
                4,
                ((0.18, "with delayed action"), (0.87, "Mount on pull side")),
                block=9,
                gap_before=0.003,
            ),
            row(
                1,
                5,
                ((0.18, "Threshold"), (0.57, "2005"), (0.76, "PE")),
                block=9,
            ),
        ),
    )

    components = extract_heuristic([page]).sets[0].components

    assert len(components) == 2
    assert components[0].description == "Door Closer with delayed action"
    assert components[0].notes == "Mount on pull side"
    assert components[0].confidence.notes is not None
    assert components[1].description == "Threshold"
    assert components[1].qty is None
    assert components[1].confidence.qty is None


def test_ambiguous_codes_are_resolved_per_local_table_block() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #1 - ENTRY", x0=0.05),
            row(1, 2, ((0.10, "DESCRIPTION"), (0.70, "CODE")), block=10),
            row(1, 3, ((0.10, "Hinge"), (0.70, "MK")), block=101),
            row(1, 4, ((0.10, "Threshold"), (0.70, "PE")), block=102),
            row(1, 5, ((0.10, "Closer"), (0.70, "NO")), block=103),
            line(1, 6, "SET #2 - SERVICE", x0=0.05),
            row(1, 7, ((0.10, "DESCRIPTION"), (0.70, "CODE")), block=11),
            row(1, 8, ((0.10, "Hinge"), (0.70, "US26D")), block=111),
            row(1, 9, ((0.10, "Threshold"), (0.70, "PE")), block=112),
            row(1, 10, ((0.10, "Plate"), (0.70, "630")), block=113),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].components[1].mfr == "PE"
    assert result.sets[0].components[1].finish is None
    assert result.sets[0].components[2].mfr == "NO"
    assert result.sets[1].components[1].finish == "PE"
    assert result.sets[1].components[1].mfr is None


def test_no_in_description_is_not_norton_without_column_context() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #1 - ENTRY", x0=0.05),
            row(1, 2, ((0.10, "DESCRIPTION"), (0.70, "CODE")), block=60),
            row(1, 3, ((0.10, "Hinge"), (0.70, "MK")), block=61),
            row(1, 4, ((0.10, "Label No. 12"), (0.70, "PE")), block=62),
            row(1, 5, ((0.10, "Closer"), (0.70, "LCN")), block=63),
        ),
    )

    component = extract_heuristic([page]).sets[0].components[1]

    assert component.description == "Label No. 12"
    assert component.mfr == "PE"
    assert component.finish is None


def test_adjacent_page_continuation_carries_the_table_schema() -> None:
    pages = [
        PageText(
            page=5,
            lines=(
                line(5, 1, "SET #9 - ENTRY", x0=0.05),
                row(
                    5,
                    25,
                    ((0.08, "QTY"), (0.20, "DESCRIPTION"), (0.55, "CATALOG"), (0.78, "MFR")),
                    block=3,
                ),
                row(
                    5,
                    26,
                    ((0.08, "2"), (0.20, "Hinge"), (0.55, "T4A3386"), (0.78, "MK")),
                    block=3,
                ),
            ),
        ),
        PageText(
            page=6,
            lines=(
                row(6, 1, ((0.20, "Closer"), (0.55, "4040XP"), (0.78, "LCN")), block=8),
                line(6, 2, "SET #10 - EXIT", x0=0.05),
                row(
                    6,
                    3,
                    ((0.08, "1"), (0.20, "Exit Device"), (0.55, "99L"), (0.78, "VD")),
                    block=8,
                ),
            ),
        ),
    ]

    result = extract_heuristic(pages)

    assert [item.set_number for item in result.sets] == ["9", "10"]
    assert [region.page for region in result.sets[0].location.regions] == [5, 6]
    assert result.sets[0].components[1].qty is None
    assert result.sets[0].components[1].catalog_number == "4040XP"


def test_same_page_code_lookup_resolves_before_and_after_the_set() -> None:
    page = PageText(
        page=1,
        lines=(
            row(1, 1, ((0.05, "SPEC CODE LOOKUP TABLE"),), block=20),
            row(
                1,
                2,
                (
                    (0.05, "CODE"),
                    (0.15, "DESCRIPTION"),
                    (0.48, "CATALOG"),
                    (0.67, "MFR"),
                    (0.80, "FINISH"),
                ),
                block=20,
            ),
            row(
                1,
                3,
                (
                    (0.05, "A"),
                    (0.15, "Hinge"),
                    (0.48, "T4A3386"),
                    (0.67, "MK"),
                    (0.80, "US26D"),
                ),
                block=20,
            ),
            line(1, 4, "SET #12 - ENTRY", x0=0.05),
            line(1, 5, "2 A"),
            line(1, 6, "1 Z"),
            row(1, 7, ((0.05, "COMPONENT CODE"),), block=21),
            row(1, 8, ((0.05, "B = Closer | 4040XP | LCN | 689"),), block=21),
            line(1, 9, "1 B"),
        ),
    )

    result = extract_heuristic([page])
    components = result.sets[0].components

    assert components[0].qty == "2"
    assert components[0].description == "Hinge"
    assert components[0].catalog_number == "T4A3386"
    assert components[0].notes == "Spec code A"
    assert components[1].catalog_number == "Z"
    assert components[1].notes == "Unresolved spec code Z"
    assert components[2].description == "Closer"
    assert components[2].catalog_number == "4040XP"


def test_lookup_collection_stops_at_a_set_column_schedule() -> None:
    page = PageText(
        page=1,
        lines=(
            row(1, 1, ((0.05, "SPEC CODE"),), block=40),
            row(1, 2, ((0.05, "A = Hinge | T4A3386 | MK | US26D"),), block=40),
            row(
                1,
                3,
                ((0.04, "SET"), (0.18, "QTY"), (0.32, "DESCRIPTION"), (0.72, "CATALOG")),
                block=41,
            ),
            row(
                1,
                4,
                ((0.04, "14"), (0.18, "1"), (0.32, "Closer"), (0.72, "4040XP")),
                block=41,
            ),
        ),
    )

    result = extract_heuristic([page])

    assert result.sets[0].set_number == "14"
    assert result.sets[0].components[0].catalog_number == "4040XP"


def test_duplicate_lookup_code_uses_the_nearest_definition() -> None:
    page = PageText(
        page=1,
        lines=(
            row(1, 1, ((0.05, "SPEC CODE"),), block=30),
            row(1, 2, ((0.05, "A = Hinge | OLD | MK | US26D"),), block=30),
            line(1, 10, "SET #2", x0=0.05),
            line(1, 11, "1 A"),
            row(1, 12, ((0.05, "SPEC CODE"),), block=31),
            row(1, 13, ((0.05, "A = Hinge | NEW | MK | US26D"),), block=31),
        ),
    )

    component = extract_heuristic([page]).sets[0].components[0]

    assert component.catalog_number == "NEW"


def test_long_known_lookup_code_is_not_treated_as_a_bare_set_heading() -> None:
    page = PageText(
        page=1,
        lines=(
            row(1, 1, ((0.05, "SPEC CODE"),), block=50),
            row(1, 2, ((0.05, "ABCD = Closer | 4040XP | LCN | 689"),), block=50),
            line(1, 3, "SET #3", x0=0.05),
            row(1, 4, ((0.05, "2 ABCD"),), block=51, gap_before=0.08),
            row(1, 5, ((0.05, "1 WXYZ"),), block=51, gap_before=0.08),
        ),
    )

    result = extract_heuristic([page])

    assert [item.set_number for item in result.sets] == ["3"]
    assert result.sets[0].components[0].qty == "2"
    assert result.sets[0].components[0].catalog_number == "4040XP"
    assert result.sets[0].components[1].catalog_number == "WXYZ"
    assert result.sets[0].components[1].notes == "Unresolved spec code WXYZ"


def test_unresolved_code_column_is_preserved_with_a_warning() -> None:
    page = PageText(
        page=1,
        lines=(
            line(1, 1, "SET #8 - ENTRY", x0=0.05),
            row(
                1,
                2,
                ((0.10, "DESCRIPTION"), (0.72, "CODE")),
                block=70,
            ),
            row(1, 3, ((0.10, "Hinge"), (0.72, "A")), block=70),
        ),
    )

    result = extract_heuristic([page])
    component = result.sets[0].components[0]

    assert component.catalog_number == "A"
    assert component.notes == "Unresolved spec code A"
    assert any("preserved without expansion: A" in warning for warning in result.warnings)


def test_unheaded_rows_before_a_later_set_make_the_result_needs_review() -> None:
    page = PageText(
        page=1,
        lines=tuple(
            [line(1, number, f"1 Hinge T4A{number} MK US26D") for number in range(1, 7)]
            + [
                line(1, 8, "SET #2 - EXIT", x0=0.05),
                line(1, 9, "1 Closer 4040XP LCN 689"),
            ]
        ),
    )

    result = extract_heuristic([page])

    assert result.outcome == "needs_review"
    assert [item.set_number for item in result.sets] == ["2"]
    assert any("no recoverable hardware set identifier" in warning for warning in result.warnings)

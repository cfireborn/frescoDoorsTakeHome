from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from statistics import median
from typing import Literal

from .layout import Column, ColumnField, ColumnSchema, schema_from_header
from .models import (
    BBox,
    Component,
    ComponentStrikethrough,
    FieldConfidence,
    HardwareSet,
    Location,
    ModelExtraction,
    PageRegion,
    SetStrikethrough,
    TextRange,
)
from .pdf import PageText, TextLine, Word

SET_NUMBER_PATTERN = (
    r"(?:[A-Z]{1,4}(?:[ .-]\d+[A-Z]?)+|\d+[A-Z]?(?:[.-][A-Z0-9]+)*|[A-Z]+\d+[A-Z]?)"
)
SET_HEADER = re.compile(
    rf"^\s*(?:(?:HW|HARDWARE)\s+)?(?:SET|HEADING|GROUP)"
    rf"(?:\s+(?:NO\.?|NUMBER))?\s*#?\s*[:.-]?\s*(?P<number>{SET_NUMBER_PATTERN})"
    r"(?:\s*(?:[-–—:]|\s{2,})\s*(?P<description>.*?)"
    r"|\s+(?P<status_description>\(?\s*(?:NOT\s+USED|N\s*/?\s*A|"
    r"CONT(?:INUED|'?D|\.))\s*\)?))?"
    r"(?:\s+\[[^\]]+\])?$",
    re.IGNORECASE,
)
DIRECT_HW_SET_HEADER = re.compile(
    rf"^\s*(?:HW|HARDWARE)\s+(?P<number>{SET_NUMBER_PATTERN})"
    r"(?:\s+(?P<description>.*?))?(?:\s+\[[^\]]+\])?\s*$",
    re.IGNORECASE,
)
SET_CELL = re.compile(
    rf"^\s*(?:(?:HW|HARDWARE)\s+)?(?:SET|HEADING|GROUP)?"
    rf"(?:\s+(?:NO\.?|NUMBER))?\s*#?\s*[:.-]?\s*(?P<number>{SET_NUMBER_PATTERN})\s*$",
    re.IGNORECASE,
)
BARE_SET_HEADER = re.compile(
    rf"^\s*#?(?P<number>{SET_NUMBER_PATTERN})(?:\s+(?P<description>.+))?$",
    re.IGNORECASE,
)
QTY_PREFIX = re.compile(r"^\s*(?P<qty>\d+(?:\.\d+)?|\d+\s*/\s*\d+)\s+(?P<body>.+)$")
QUANTITY_VALUE = re.compile(
    r"^(?P<value>\d+(?:\.\d+)?|\d+\s*/\s*\d+)"
    r"(?:\s+(?:EA|EACH|LOT|PAIR|PR|SET))?$",
    re.IGNORECASE,
)
UNIT_VALUE = re.compile(r"^(?:EA(?:-R)?|EACH|LOT|PAIR|PR|SET)$", re.IGNORECASE)
DIMENSION_ROW = re.compile(r'^\s*\d+\s+x\s+\d+\s+x\s+\d+\b', re.IGNORECASE)
HARDWARE_TERM = re.compile(
    r"\b(?:accessory|actuator|astragal|bolt|closer|contact|coordinator|core|credential|"
    r"cylinder|device|door\s+pull|exit\s+device|gasket|hardware|harness|hinges?|holder|"
    r"intercom|key(?:pad|way|ing)?|kick\s+plate|latch|lock(?:set)?s?|mullion|operator|panic|sfics?|"
    r"button|drip|pivot|plate|power\s+supply|pull|push|reader|rod|seal|silencer|stop|strike|"
    r"sweep|switch|threshold|transfer|trim|weatherstripp?ing|wiring)\b",
    re.IGNORECASE,
)
NOT_USED = re.compile(r"\b(?:NOT\s+USED|N\s*/?\s*A)\b", re.IGNORECASE)
MOVED_SET = re.compile(r"\bMOVED\s+TO\b.*\bSET\b", re.IGNORECASE)
STATUS_ONLY = re.compile(r"^\s*(?:NOT\s+USED|N\s*/?\s*A)\s*[.!]?\s*$", re.IGNORECASE)
IGNORED_LINE = re.compile(
    r"^(?:PAGE\s+\d+(?:\s+OF\s+\d+)?|DOOR\s+HARDWARE\b|HARDWARE\s+SETS?|"
    r"SECTION\s+08|END\s+OF\s+SECTION|EACH\s+TO\s+HAVE\s*:?|PROVIDE\s+EACH\b|"
    r"FOR\s+USE\s+ON\s+DOOR\b|DOORS?\s*:)\b",
    re.IGNORECASE,
)
LOOKUP_HEADING = re.compile(
    r"\b(?:(?:SPEC|CATALOG|HARDWARE|COMPONENT)\s+CODE|CODE\s+LEGEND|LOOKUP\s+TABLE|"
    r"OPTION\s+LIST|FINISH\s+LIST|MANUFACTURER\s+LIST)\b",
    re.IGNORECASE,
)
LOOKUP_ASSIGNMENT = re.compile(
    r"^\s*(?P<code>[A-Z][A-Z0-9.-]{0,7})\s*(?:=|:|->)\s*(?P<body>.+)$",
    re.IGNORECASE,
)
LOOKUP_REFERENCE = re.compile(
    r"^\s*(?:(?P<qty>\d+(?:\.\d+)?)\s+)?(?P<code>[A-Z][A-Z0-9.-]{0,7})\s*$",
    re.IGNORECASE,
)
SCHEDULE_PROSE = re.compile(
    r"^(?:HDR\s+PROJECT\b|REFER\s+TO\s+(?:DIVISION|SECTION)\b|"
    r"OPERATIONAL\s+DESCRIPTION\b|MODE\s+OF\s+OPERATION\b|"
    r"DOORS?\s+(?:ARE|IS)\b|CARD\s+READER\s+OR\s+KEYPAD\b|"
    r"PROVIDE\s+EACH\b|REPLACE\b|ADD\b|RE-USE\b|ENSURE\b)",
    re.IGNORECASE,
)

AMBIGUOUS_CODES = {"NO", "PE"}
MANUFACTURER_CODES = {
    "AD",
    "ABH",
    "BES",
    "BEST",
    "BE",
    "BRN",
    "C-R",
    "CMND",
    "CON",
    "DE",
    "EDW",
    "GLY",
    "GLYNN-JOHNSON",
    "GS",
    "HAG",
    "HA",
    "IVE",
    "IVES",
    "LCN",
    "MC",
    "MED1",
    "MK",
    "MCKINNEY",
    "NO",
    "NORTON",
    "NGP",
    "PE",
    "PEMKO",
    "PRE",
    "RCI",
    "RO",
    "RU",
    "SA",
    "SCE",
    "SCH",
    "SCHLAGE",
    "VD",
    "VON",
    "VON DUPRIN",
    "ZER",
    "ZERO",
    "UNK",
}
FINISH_CODES = {
    "26D",
    "26",
    "32D",
    "313",
    "315",
    "626",
    "628",
    "630",
    "606",
    "612",
    "613",
    "622",
    "639",
    "691",
    "695",
    "711",
    "780",
    "689",
    "BSP",
    "BLACK",
    "BLK",
    "BLU",
    "BK",
    "C26D",
    "C28",
    "C32D",
    "PE",
    "AL",
    "ALM",
    "ANCL",
    "CLR",
    "GREY",
    "GRAY",
    "LGR",
    "LS",
    "MIL",
    "WHT",
    "US10B",
    "10BE",
    "US15",
    "US26D",
    "US28",
    "US32D",
}


@dataclass
class _SetBuilder:
    number: str
    description: str | None
    status: Literal["active", "not_used"]
    strikethrough: SetStrikethrough
    regions: dict[int, list[TextLine]]
    components: list[Component]

    def add_line(self, line: TextLine) -> None:
        page_lines = self.regions.setdefault(line.page, [])
        if line not in page_lines:
            page_lines.append(line)

    def build(self) -> HardwareSet:
        page_regions: list[PageRegion] = []
        for page, lines in sorted(self.regions.items()):
            page_regions.append(
                PageRegion(
                    page=page,
                    bbox=BBox(
                        x0=min(line.bbox.x0 for line in lines),
                        y0=min(line.bbox.y0 for line in lines),
                        x1=max(line.bbox.x1 for line in lines),
                        y1=max(line.bbox.y1 for line in lines),
                    ),
                    line_start=min(line.number for line in lines),
                    line_end=max(line.number for line in lines),
                )
            )
        if self.status == "not_used":
            confidence = 0.98
        elif not self.components:
            confidence = 0.25
        else:
            component_scores = [
                score
                for component in self.components
                for score in component.confidence.model_dump().values()
                if score is not None
            ]
            confidence = sum(component_scores) / len(component_scores)
        return HardwareSet(
            set_number=self.number,
            description=self.description,
            status=self.status,
            strikethrough=self.strikethrough,
            location=Location(regions=page_regions),
            components=[] if self.status == "not_used" else self.components,
            confidence=round(confidence, 3),
        )


@dataclass(frozen=True)
class _LookupEntry:
    code: str
    y: float
    component: Component
    kind: Literal["component", "option", "finish", "manufacturer"] = "component"


def resolve_code_role(values: list[str], header: str | None = None) -> str | None:
    """Classify a code column using its header and full local population."""

    header_text = (header or "").strip().lower()
    if any(token in header_text for token in ("mfr", "manufacturer", "vendor", "make")):
        return "mfr"
    if any(token in header_text for token in ("finish", "fin.")):
        return "finish"

    normalized = [_normalize_code(value) for value in values if value.strip()]
    manufacturer_score = sum(
        value in MANUFACTURER_CODES - AMBIGUOUS_CODES for value in normalized
    )
    finish_score = sum(
        _is_finish_code(value) and value not in AMBIGUOUS_CODES for value in normalized
    )
    if manufacturer_score > finish_score:
        return "mfr"
    if finish_score > manufacturer_score:
        return "finish"
    return None


def _match_set_header(value: str) -> re.Match[str] | None:
    return SET_HEADER.match(value) or DIRECT_HW_SET_HEADER.match(value)


def extract_heuristic(
    pages: list[PageText], *, document_page_count: int | None = None
) -> ModelExtraction:
    """Geometry-aware offline extraction for text PDFs."""

    builders: list[_SetBuilder] = []
    current: _SetBuilder | None = None
    warnings: list[str] = []
    previous_page: int | None = None
    carried_schema: ColumnSchema | None = None
    orphan_rows = 0
    orphan_evidence_score = 0
    unresolved_codes: list[str] = []
    repeated_boilerplate = _repeated_boilerplate(pages)
    pending_note: tuple[_SetBuilder, int, TextLine] | None = None

    for page in pages:
        pending_note = None
        adjacent = previous_page is None or page.page == previous_page + 1
        if not adjacent:
            current = None
            carried_schema = None
        crossed_page = previous_page is not None and page.page != previous_page
        page_break_pending = crossed_page and current is not None
        continuation_evidence = bool(
            page_break_pending
            and current is not None
            and (
                not current.components
                or _builder_reaches_page_end(current, previous_page)
            )
        )

        code_roles = _code_roles_for_page(page)
        lookups, lookup_lines = _collect_page_lookups(page, code_roles)
        schemas: dict[int, ColumnSchema] = {}
        blank_threshold = _blank_gap_threshold(page)
        ignored_blocks: set[int] = set()

        for index, line in enumerate(page.lines):
            text = " ".join(line.text.split())
            if not text or line.number in lookup_lines:
                continue
            if _normalize_boilerplate(text) in repeated_boilerplate:
                continue
            if line.bbox.y0 >= 0.92:
                continue

            explicit = _match_set_header(text)
            if explicit is not None:
                pending_note = None
                ignored_blocks.discard(line.block)
                number = _normalize_set_number(explicit.group("number"))
                groups = explicit.groupdict()
                description = _clean_value(
                    groups.get("description") or groups.get("status_description")
                )
                status = (
                    "not_used"
                    if description
                    and (
                        STATUS_ONLY.match(description.strip("() "))
                        or MOVED_SET.search(description)
                    )
                    else "active"
                )
                previous_current = current
                current = _open_set(
                    builders,
                    current,
                    number,
                    description,
                    status,
                    line,
                    _set_strikethrough(number, description, line),
                    heading_kind="explicit",
                )
                if current is not previous_current:
                    carried_schema = None
                    schemas.clear()
                page_break_pending = False
                continue
            if SCHEDULE_PROSE.match(text):
                ignored_blocks.add(line.block)
                continue
            if line.block in ignored_blocks:
                continue

            detected_schema = schema_from_header(line)
            if detected_schema is not None:
                detected_schema = _schema_with_neighbor_quantity(
                    detected_schema, page.lines, index
                )
                schemas[line.block] = detected_schema
                carried_schema = detected_schema
                continuation_evidence = True
                continue
            if IGNORED_LINE.match(text):
                continue

            schema = schemas.get(line.block, carried_schema)
            cells = schema.cells(line) if schema is not None else {}
            table_number = _set_number_from_cell(cells.get("set_number"))
            next_line = page.lines[index + 1] if index + 1 < len(page.lines) else None
            reference = LOOKUP_REFERENCE.match(text)
            lookup_reference = (
                bool(lookups)
                and reference is not None
                and reference.group("qty") is not None
            )
            bare = (
                None
                if table_number
                or lookup_reference
                or (current is None and carried_schema is None and not schemas)
                else _bare_set_header(line, next_line, blank_threshold)
            )

            if table_number or bare is not None:
                pending_note = None
                number = table_number or _normalize_set_number(bare.group("number"))
                has_component = _cells_have_component(cells)
                if table_number:
                    description = None if has_component else _clean_value(cells.get("description"))
                else:
                    description = _clean_value(bare.group("description"))
                status = "not_used" if _cells_mark_not_used(cells) else "active"
                if description and STATUS_ONLY.match(description):
                    status = "not_used"
                current = _open_set(
                    builders,
                    current,
                    number,
                    description,
                    status,
                    line,
                    _set_strikethrough(number, description, line, schema),
                    heading_kind="table" if table_number else "bare",
                )
                page_break_pending = False
                if status == "not_used" or not has_component:
                    continue

            if current is None:
                if _looks_like_component(line, cells):
                    orphan_rows += 1
                    orphan_evidence_score += _orphan_component_evidence(line, cells)
                continue

            if page_break_pending and not continuation_evidence:
                if _looks_like_component(line, cells):
                    orphan_rows += 1
                    orphan_evidence_score += _orphan_component_evidence(line, cells)
                continue

            status_marker = bool(STATUS_ONLY.match(text) or _cells_mark_not_used(cells))
            incidental_opening_na = bool(
                STATUS_ONLY.match(text)
                and "NOT USED" not in text.upper()
                and any(
                    "OPENING DESCRIPTION" in candidate.text.upper()
                    for candidate in page.lines[max(0, index - 2) : index]
                )
            )
            if incidental_opening_na:
                continue
            if status_marker and not current.components:
                current.add_line(line)
                current.status = "not_used"
                current.components.clear()
                page_break_pending = False
                continue
            if status_marker:
                # Standalone N/A values frequently describe an opening or one field in an
                # otherwise active set. Only status evidence before the first component can
                # classify the complete set as not used.
                continue
            if re.match(r"^(?:NOTE\s*:|-)\s*", text, re.I) and current.components:
                note = re.sub(r"^(?:NOTE\s*:|-)\s*", "", text, flags=re.I)
                note = note.lstrip("- ").strip()
                component_index = _component_for_note(current.components, note)
                _append_component_note(current, component_index, note, line)
                current.add_line(line)
                pending_note = (current, component_index, line)
                continue
            if (
                pending_note is not None
                and pending_note[0] is current
                and line.gap_before <= 0.02
                and _is_note_continuation(cells, line, pending_note[2])
            ):
                note = text.lstrip("- ").strip()
                if note:
                    _append_component_note(current, pending_note[1], note, line)
                    current.add_line(line)
                    pending_note = (current, pending_note[1], line)
                    continue
            pending_note = None
            roles = code_roles.get(line.number, [])
            if schema is not None and cells:
                if _is_wrapped_component(cells, line) and current.components:
                    _merge_component_continuation(current, line, cells, schema)
                    continue
                component = _component_from_cells(
                    cells,
                    line,
                    roles,
                    lookups,
                    unresolved_codes=unresolved_codes,
                    schema=schema,
                )
            else:
                component = _component_from_lookup_reference(
                    line, lookups, unresolved_codes=unresolved_codes
                )
                if component is None:
                    component = _component_from_line(line, roles, lookups)

            if component is not None and current.status != "not_used":
                current.add_line(line)
                current.components.append(component)
                page_break_pending = False

        previous_page = page.page

    text_line_count = sum(len(page.lines) for page in pages)
    unidentified_schedule_rows = orphan_evidence_score >= 2
    if unidentified_schedule_rows:
        warnings.append(
            "Component-like schedule rows were found, but no recoverable hardware set "
            "identifier was found for them. Review the selected pages or use the OpenAI backend."
        )
    if not builders:
        if text_line_count < 3:
            outcome: Literal["extracted", "no_hardware_sets", "needs_review"] = "needs_review"
            warnings.append(
                "The selected pages contain too little extractable text for the offline parser; "
                "use the vision backend or review the PDF."
            )
        elif unidentified_schedule_rows:
            outcome = "needs_review"
        else:
            outcome = "no_hardware_sets"
            warnings.append("No hardware set identifiers were found on the selected pages.")
    if 0 < orphan_rows <= 5:
        warnings.append(
            f"Ignored {orphan_rows} component-like row(s) before a recoverable set identifier."
        )
    if unresolved_codes:
        codes = ", ".join(dict.fromkeys(unresolved_codes))
        warnings.append(
            f"Unresolved spec/catalog code(s) preserved without expansion: {codes}. "
            "Review the same-page lookup table."
        )
    empty = [
        builder.number
        for builder in builders
        if builder.status == "active" and not builder.components
    ]
    if empty:
        warnings.append(f"Active sets with no parsed components: {', '.join(empty)}")
    selected_text = " ".join(line.text for page in pages for line in page.lines)
    external_schedule_missing = bool(
        re.search(r"\bREFER\w*\b.{0,100}\b(?:08\s*06\s*71|080671)\b", selected_text, re.I)
    )
    if external_schedule_missing:
        warnings.append(
            "The selected section refers to an external hardware schedule that is not present; "
            "any extracted sets are partial."
        )
    final_page = pages[-1] if pages else None
    selection_may_truncate = bool(
        builders
        and final_page is not None
        and builders[-1].status == "active"
        and _builder_reaches_selection_edge(builders[-1], final_page.page)
        and (document_page_count is None or final_page.page < document_page_count)
        and not any(
            IGNORED_LINE.match(line.text) and "END OF SECTION" in line.text.upper()
            for line in final_page.lines
        )
    )
    if selection_may_truncate:
        warnings.append(
            "The final set reaches the bottom of the last selected page and may continue beyond "
            "the selected range."
        )
    if builders:
        outcome = (
            "needs_review"
            if (
                empty
                or external_schedule_missing
                or selection_may_truncate
                or unidentified_schedule_rows
            )
            else "extracted"
        )
    return ModelExtraction(
        outcome=outcome,
        sets=[builder.build() for builder in builders],
        warnings=warnings,
    )


def _open_set(
    builders: list[_SetBuilder],
    current: _SetBuilder | None,
    number: str,
    description: str | None,
    status: Literal["active", "not_used"],
    line: TextLine,
    strikethrough: SetStrikethrough,
    *,
    heading_kind: Literal["explicit", "table", "bare"],
) -> _SetBuilder:
    if (
        current is not None
        and current.number == number
        and _same_set_occurrence(
            current, description, line, heading_kind, strikethrough
        )
    ):
        current.description = current.description or description
        current.strikethrough = _merge_strikethrough(
            current.strikethrough,
            strikethrough,
            {"set_number": current.number, "description": current.description},
        )
        if status == "not_used":
            current.status = status
            current.components.clear()
        current.add_line(line)
        return current

    created_description = None if status == "not_used" else description
    created_strikethrough = {
        field: ranges
        for field, ranges in strikethrough.items()
        if field != "description" or created_description is not None
    }
    created = _SetBuilder(
        number=number,
        description=created_description,
        status=status,
        strikethrough=SetStrikethrough.model_validate(created_strikethrough),
        regions={},
        components=[],
    )
    created.add_line(line)
    builders.append(created)
    return created


def _same_set_occurrence(
    current: _SetBuilder,
    description: str | None,
    line: TextLine,
    heading_kind: Literal["explicit", "table", "bare"],
    strikethrough: SetStrikethrough,
) -> bool:
    """Use page and row geometry to distinguish continuations from duplicate IDs."""

    last_page = max(current.regions)
    current_description = _base_set_description(current.description)
    next_description = _base_set_description(description)
    if bool(current.strikethrough) != bool(strikethrough):
        return False
    if current_description and next_description and current_description != next_description:
        return False

    if line.page == last_page:
        if heading_kind == "table":
            return not (current.components and line.gap_before >= 0.02)
        if current.components or current.status == "not_used":
            return False
        prior_lines = current.regions[last_page]
        prior_bottom = max(candidate.bbox.y1 for candidate in prior_lines)
        return line.bbox.y0 - prior_bottom <= 0.03

    if line.page != last_page + 1 or line.bbox.y0 > 0.2:
        return False
    next_marks_continuation = bool(
        description and re.search(r"\bCONT(?:INUED|'?D|\.)\)?\s*$", description, re.I)
    )
    if next_marks_continuation:
        return True
    return not current.components or _builder_reaches_page_end(current, last_page)


def _base_set_description(value: str | None) -> str:
    normalized = _normalize_boilerplate(value or "")
    return re.sub(
        r"\s*(?:[-:,(]\s*)?CONT(?:INUED|'?D|\.)(?:\s*\))?\s*$",
        "",
        normalized,
    ).strip()


def _builder_reaches_page_end(builder: _SetBuilder, page: int | None) -> bool:
    if page is None:
        return False
    return any(line.bbox.y1 >= 0.8 for line in builder.regions.get(page, []))


def _builder_reaches_selection_edge(builder: _SetBuilder, page: int) -> bool:
    return any(line.bbox.y1 >= 0.88 for line in builder.regions.get(page, []))


def _normalize_boilerplate(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().upper()


def _repeated_boilerplate(pages: list[PageText]) -> set[str]:
    page_occurrences: dict[str, set[int]] = {}
    for page in pages:
        for line in page.lines:
            if line.bbox.y0 > 0.12 and line.bbox.y1 < 0.9:
                continue
            if _match_set_header(" ".join(line.text.split())):
                continue
            if schema_from_header(line) is not None:
                continue
            normalized = _normalize_boilerplate(line.text)
            if normalized:
                page_occurrences.setdefault(normalized, set()).add(page.page)
    return {
        text for text, page_numbers in page_occurrences.items() if len(page_numbers) >= 2
    }


def _schema_with_neighbor_quantity(
    schema: ColumnSchema, lines: tuple[TextLine, ...], index: int
) -> ColumnSchema:
    if any(column.field == "qty" for column in schema.columns):
        return schema
    line = lines[index]
    neighbors = lines[max(0, index - 2) : min(len(lines), index + 3)]
    for neighbor in neighbors:
        if abs(neighbor.bbox.y0 - line.bbox.y0) > 0.02:
            continue
        for word in neighbor.words:
            if _normalize_code(word.text) not in {"QT", "QTY", "QUANTITY"}:
                continue
            return ColumnSchema(columns=(*schema.columns, Column("qty", word.bbox.x0)))
    return schema


def _set_strikethrough(
    number: str,
    description: str | None,
    line: TextLine,
    schema: ColumnSchema | None = None,
) -> SetStrikethrough:
    source = " ".join(word.text for word in line.words)
    header = _match_set_header(source)
    if header is not None:
        values = {"set_number": number, "description": description}
        ranges: dict[str, list[TextRange]] = {}
        groups = header.groupdict()
        source_fields = {
            "set_number": "number",
            "description": (
                "description"
                if groups.get("description") is not None
                else "status_description"
            ),
        }
        for field, group in source_fields.items():
            value = values[field]
            if not value or group not in groups or groups.get(group) is None:
                continue
            start, end = header.span(group)
            field_ranges = _strikethrough_for_source_words(
                value, _words_in_source_span(line.words, start, end)
            )
            if field_ranges:
                ranges[field] = field_ranges
        return SetStrikethrough.model_validate(ranges)
    return SetStrikethrough.model_validate(
        _strikethrough_for_fields(
            {"set_number": number, "description": description}, line, schema
        )
    )


def _words_in_source_span(
    words: tuple[Word, ...], start: int, end: int
) -> tuple[Word, ...]:
    selected: list[Word] = []
    offset = 0
    for word in words:
        word_start = offset
        word_end = word_start + len(word.text)
        if word_end > start and word_start < end:
            selected.append(word)
        offset = word_end + 1
    return tuple(selected)


def _strikethrough_for_source_words(
    value: str, words: tuple[Word, ...]
) -> list[TextRange]:
    struck_tokens = {
        _source_word_key(word.text) for word in words if word.is_struck
    }
    consumed: list[TextRange] = []
    ranges: list[TextRange] = []
    for word in words:
        if _source_word_key(word.text) not in struck_tokens:
            continue
        text_range = _find_unused_word_range(value, word.text, consumed)
        if text_range is None:
            continue
        consumed.append(text_range)
        if word.is_struck:
            ranges.append(text_range)
    return _merge_text_ranges(value, ranges)


def _with_component_strikethrough(
    component: Component,
    line: TextLine,
    schema: ColumnSchema | None = None,
) -> Component:
    strikethrough = _strikethrough_for_fields(
        {
            "qty": component.qty,
            "description": component.description,
            "catalog_number": component.catalog_number,
            "mfr": component.mfr,
            "finish": component.finish,
            "notes": component.notes,
        },
        line,
        schema,
        component.strikethrough,
    )
    return component.model_copy(
        update={
            "strikethrough": ComponentStrikethrough.model_validate(strikethrough)
        }
    )


def _strikethrough_for_fields(
    values: dict[str, str | None],
    line: TextLine,
    schema: ColumnSchema | None = None,
    existing: ComponentStrikethrough | SetStrikethrough | None = None,
) -> dict[str, list[TextRange]]:
    ranges = {field: list(field_ranges) for field, field_ranges in (existing or {}).items()}
    consumed = {field: list(field_ranges) for field, field_ranges in ranges.items()}
    fields = [field for field, value in values.items() if isinstance(value, str)]
    struck_tokens = {
        _source_word_key(word.text) for word in line.words if word.is_struck
    }
    for word in line.words:
        if _source_word_key(word.text) not in struck_tokens:
            continue
        preferred = (
            _output_fields_for_column(_column_for_word(schema, word)) if schema else []
        )
        candidates = list(dict.fromkeys([*preferred, *fields]))
        for field in candidates:
            value = values.get(field)
            if not value:
                continue
            text_range = _find_unused_word_range(
                value, word.text, consumed.get(field, [])
            )
            if text_range is None:
                continue
            consumed.setdefault(field, []).append(text_range)
            if word.is_struck and not any(
                text_range.start < item.end and text_range.end > item.start
                for item in ranges.get(field, [])
            ):
                ranges.setdefault(field, []).append(text_range)
            break
    return {
        field: _merge_text_ranges(values[field] or "", field_ranges)
        for field, field_ranges in ranges.items()
        if values.get(field) and field_ranges
    }


def _source_word_key(value: str) -> str:
    return re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", value).lower()


def _column_for_word(schema: ColumnSchema, word: Word) -> ColumnField | None:
    ordered = sorted(schema.columns, key=lambda column: column.x)
    if not ordered:
        return None
    boundaries = [
        max(left.x + 0.004, right.x - 0.01)
        for left, right in zip(ordered, ordered[1:], strict=False)
    ]
    index = 0
    while index < len(boundaries) and word.bbox.x0 >= boundaries[index]:
        index += 1
    return ordered[index].field


def _output_fields_for_column(field: ColumnField | None) -> list[str]:
    if field == "mfr_catalog":
        return ["mfr", "catalog_number"]
    if field == "lookup_code":
        return ["catalog_number"]
    if field in {
        "set_number",
        "qty",
        "description",
        "catalog_number",
        "mfr",
        "finish",
        "notes",
    }:
        return [field]
    return []


def _find_unused_word_range(
    value: str, source_word: str, used: list[TextRange]
) -> TextRange | None:
    stripped = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", source_word)
    variants = list(dict.fromkeys(candidate for candidate in (source_word, stripped) if candidate))
    lower_value = value.lower()
    for variant in variants:
        lower_word = variant.lower()
        start = lower_value.find(lower_word)
        while start >= 0:
            end = start + len(variant)
            alphanumeric = re.fullmatch(r"[A-Za-z0-9]+", variant) is not None
            bounded = not alphanumeric or (
                (start == 0 or not value[start - 1].isalnum())
                and (end == len(value) or not value[end].isalnum())
            )
            overlaps = any(start < item.end and end > item.start for item in used)
            if bounded and not overlaps:
                return TextRange(start=start, end=end)
            start = lower_value.find(lower_word, start + 1)
    return None


def _merge_text_ranges(value: str, ranges: list[TextRange]) -> list[TextRange]:
    merged: list[TextRange] = []
    for text_range in sorted(ranges, key=lambda item: (item.start, item.end)):
        if text_range.end > len(value):
            continue
        previous = merged[-1] if merged else None
        if previous and (
            text_range.start <= previous.end
            or not value[previous.end : text_range.start].strip()
        ):
            merged[-1] = TextRange(
                start=previous.start,
                end=max(previous.end, text_range.end),
            )
        else:
            merged.append(text_range)
    return merged


def _merge_strikethrough(
    current: SetStrikethrough,
    additional: SetStrikethrough,
    values: dict[str, str | None],
) -> SetStrikethrough:
    merged: dict[str, list[TextRange]] = {
        field: [*ranges] for field, ranges in current.items()
    }
    for field, ranges in additional.items():
        merged.setdefault(field, []).extend(ranges)
    return SetStrikethrough.model_validate(
        {
            field: _merge_text_ranges(values[field] or "", ranges)
            for field, ranges in merged.items()
            if values.get(field)
        }
    )


def _component_for_note(components: list[Component], note: str) -> int:
    nouns = (
        "closer",
        "hinge",
        "lock",
        "cylinder",
        "stop",
        "gasketing",
        "strike",
        "operator",
        "reader",
        "switch",
        "supply",
        "threshold",
        "seal",
        "bolt",
        "device",
    )
    note_text = note.lower()
    best_index = len(components) - 1
    best_score = 0
    for index, component in enumerate(components):
        description = (component.description or "").lower()
        score = sum(noun in note_text and noun in description for noun in nouns) * 2
        if component.strikethrough and re.search(r"\b(?:removed|deleted|omitted?)\b", note, re.I):
            score += 1
        if score >= best_score and score > 0:
            best_index = index
            best_score = score
    return best_index


def _append_component_note(
    current: _SetBuilder,
    component_index: int,
    note: str,
    line: TextLine,
) -> None:
    previous = current.components[component_index]
    notes = _join_notes(previous.notes, note)
    note_offset = len(previous.notes) + 2 if previous.notes else 0
    note_ranges = _strikethrough_for_fields({"notes": note}, line).get("notes", [])
    strikethrough: dict[str, list[TextRange]] = {
        field: [*ranges] for field, ranges in previous.strikethrough.items()
    }
    if note_ranges:
        shifted = [
            TextRange(start=item.start + note_offset, end=item.end + note_offset)
            for item in note_ranges
        ]
        strikethrough["notes"] = _merge_text_ranges(
            notes or "", [*strikethrough.get("notes", []), *shifted]
        )
    confidence = previous.confidence.model_copy(deep=True)
    confidence.notes = 0.8
    current.components[component_index] = previous.model_copy(
        update={
            "notes": notes,
            "strikethrough": ComponentStrikethrough.model_validate(strikethrough),
            "confidence": confidence,
        }
    )


def _is_note_continuation(
    cells: dict[ColumnField, str], line: TextLine, previous_line: TextLine
) -> bool:
    if cells:
        return bool(
            (cells.get("description") or cells.get("notes"))
            and _quantity(cells.get("qty")) is None
            and not any(
                cells.get(field)
                for field in ("catalog_number", "mfr", "finish", "lookup_code")
            )
        )
    text = " ".join(line.text.split())
    return bool(
        line.block == previous_line.block
        and line.bbox.x0 >= previous_line.bbox.x0 - 0.02
        and QTY_PREFIX.match(text) is None
        and _match_set_header(text) is None
        and re.search(r"[.!;:]$", text)
    )


def _component_from_cells(
    cells: dict[ColumnField, str],
    line: TextLine,
    code_roles: list[tuple[float, str]],
    lookups: list[_LookupEntry],
    *,
    unresolved_codes: list[str] | None = None,
    schema: ColumnSchema | None = None,
) -> Component | None:
    raw_values = list(cells.values())
    electrified = any("\uf07e" in value for value in raw_values)
    qty = _quantity(cells.get("qty"))
    description = _clean_value(cells.get("description"))
    catalog_number = _clean_value(cells.get("catalog_number"))
    mfr = _clean_value(cells.get("mfr"))
    finish = _clean_value(cells.get("finish"))
    notes = _clean_value(cells.get("notes"))

    combined = _clean_value(cells.get("mfr_catalog"))
    if combined:
        combined_mfr, combined_catalog = _split_mfr_catalog(combined)
        mfr = mfr or combined_mfr
        catalog_number = catalog_number or combined_catalog

    lookup_code = _clean_value(cells.get("lookup_code"))
    unresolved_lookup_code: str | None = None
    if lookup_code:
        resolved = _lookup_component(lookups, lookup_code, line, qty)
        if resolved is not None:
            description = description or resolved.description
            catalog_number = catalog_number or resolved.catalog_number
            mfr = mfr or resolved.mfr
            finish = finish or resolved.finish
            notes = _join_notes(notes, resolved.notes)
        else:
            unresolved_lookup_code = lookup_code

    inferred_mfr, inferred_finish = _infer_codes(line, list(cells.values()), code_roles)
    mfr = mfr or inferred_mfr
    finish = finish or inferred_finish
    if unresolved_lookup_code and _normalize_code(unresolved_lookup_code) not in {
        _normalize_code(value) for value in (mfr, finish) if value
    }:
        catalog_number = catalog_number or unresolved_lookup_code
        notes = _join_notes(notes, f"Unresolved spec code {unresolved_lookup_code}")
    if electrified:
        notes = _join_notes(notes, "Electrified opening")
    notes = _join_notes(
        notes, _resolution_notes(lookups, raw_values, mfr=mfr, finish=finish)
    )
    if not any((description, catalog_number, mfr, finish, lookup_code)):
        return None
    evidence = " ".join(
        value for value in (description, catalog_number, mfr, finish) if value
    )
    if description and SCHEDULE_PROSE.match(description):
        return None
    if qty is None and HARDWARE_TERM.search(evidence) is None and not any(
        (catalog_number, mfr, finish, lookup_code)
    ):
        return None
    if qty is not None:
        if not description or re.search(r"[A-Za-z]", description) is None:
            return None
        if HARDWARE_TERM.search(evidence) is None and not any(
            (catalog_number, mfr, finish, lookup_code)
        ):
            return None
    if (
        unresolved_lookup_code
        and "Unresolved spec code" in (notes or "")
        and unresolved_codes is not None
    ):
        unresolved_codes.append(unresolved_lookup_code)

    component = Component(
        qty=qty,
        description=description,
        catalog_number=catalog_number,
        mfr=mfr,
        finish=finish,
        notes=notes,
        confidence=FieldConfidence(
            qty=0.96 if qty is not None else None,
            description=0.9 if description else None,
            catalog_number=0.88 if catalog_number else None,
            mfr=0.94 if cells.get("mfr") or combined else (0.7 if mfr else None),
            finish=0.94 if cells.get("finish") else (0.7 if finish else None),
            notes=0.8 if notes else None,
        ),
    )
    return _with_component_strikethrough(component, line, schema)


def _component_from_line(
    line: TextLine,
    code_roles: list[tuple[float, str]] | None = None,
    lookups: list[_LookupEntry] | None = None,
) -> Component | None:
    text = " ".join(line.text.split())
    if DIMENSION_ROW.match(text):
        return None
    qty_match = QTY_PREFIX.match(text)
    qty = qty_match.group("qty").replace(" ", "") if qty_match else None
    body = qty_match.group("body") if qty_match else text
    electrified = "\uf07e" in body
    body = _clean_value(body) or ""

    if qty is None and (line.bbox.x0 < 0.08 or HARDWARE_TERM.search(body) is None):
        return None
    if len(body) < 3 or body.isdigit():
        return None

    tokens = body.split()
    mfr, finish = _infer_codes(line, tokens, code_roles or [])
    groups = _word_groups(line, has_quantity=qty is not None)
    table_row = len(groups) >= 2
    catalog_number: str | None = None
    notes: str | None = None
    if table_row:
        description = " ".join(word.text for word in groups[0])
        detail_groups = groups[1:]
        assigned_codes = {
            _normalize_code(value) for value in (mfr, finish) if value is not None
        }
        if detail_groups and not _group_is_codes(detail_groups[0], assigned_codes):
            catalog_number = " ".join(word.text for word in detail_groups.pop(0))
        remaining = [
            " ".join(word.text for word in group)
            for group in detail_groups
            if not _group_is_codes(group, assigned_codes)
        ]
        notes = " ".join(remaining) or None
    else:
        description = None

    catalog_number = _strip_trailing_catalog_codes(catalog_number, mfr, finish)

    consumed = Counter(_normalize_code(value) for value in (mfr, finish) if value)
    description_tokens: list[str] = []
    if description is None:
        for token in tokens:
            normalized = _normalize_code(token)
            if consumed[normalized]:
                consumed[normalized] -= 1
            else:
                description_tokens.append(token)
        description = " ".join(description_tokens) or None

    evidence = " ".join(value for value in (description, catalog_number, mfr, finish) if value)
    if qty is not None:
        if not description or re.search(r"[A-Za-z]", description) is None:
            return None
        if HARDWARE_TERM.search(evidence) is None and not any((mfr, finish)):
            return None
    notes = _join_notes(notes, "Electrified opening" if electrified else None)
    notes = _join_notes(
        notes,
        _resolution_notes(lookups or [], [text], mfr=mfr, finish=finish),
    )

    component = Component(
        qty=qty,
        description=description,
        catalog_number=catalog_number,
        mfr=mfr,
        finish=finish,
        notes=notes,
        confidence=FieldConfidence(
            qty=0.95 if qty else 0.75,
            description=0.78 if table_row else 0.65,
            catalog_number=0.7 if catalog_number else None,
            mfr=0.65 if mfr else None,
            finish=0.65 if finish else None,
            notes=0.55 if notes else None,
        ),
    )
    return _with_component_strikethrough(component, line)


def _component_from_lookup_reference(
    line: TextLine,
    lookups: list[_LookupEntry],
    *,
    unresolved_codes: list[str] | None = None,
) -> Component | None:
    if not lookups:
        return None
    match = LOOKUP_REFERENCE.match(" ".join(line.text.split()))
    if match is None:
        return None
    code = match.group("code").upper()
    qty = match.group("qty")
    resolved = _lookup_component(lookups, code, line, qty)
    if resolved is not None:
        return _with_component_strikethrough(resolved, line)
    if unresolved_codes is not None:
        unresolved_codes.append(code)
    component = Component(
        qty=qty,
        description=None,
        catalog_number=code,
        mfr=None,
        finish=None,
        notes=f"Unresolved spec code {code}",
        confidence=FieldConfidence(catalog_number=0.35, notes=0.95),
    )
    return _with_component_strikethrough(component, line)


def _collect_page_lookups(
    page: PageText, code_roles: dict[int, list[tuple[float, str]]]
) -> tuple[list[_LookupEntry], set[int]]:
    entries: list[_LookupEntry] = []
    ignored: set[int] = set()
    active = False
    schema: ColumnSchema | None = None
    legend_kind: Literal["component", "option", "finish", "manufacturer"] = "component"

    for line in page.lines:
        text = " ".join(line.text.split())
        if LOOKUP_HEADING.search(text):
            active = True
            schema = None
            upper = text.upper()
            if "OPTION LIST" in upper:
                legend_kind = "option"
            elif "FINISH LIST" in upper:
                legend_kind = "finish"
            elif "MANUFACTURER LIST" in upper:
                legend_kind = "manufacturer"
            else:
                legend_kind = "component"
            ignored.add(line.number)
            continue
        if active and _match_set_header(text):
            active = False
            schema = None
        if not active:
            continue

        if re.fullmatch(r"\s*CODE\s*:?[ ]+(?:NAME|DESCRIPTION)\s*:?[ ]*", text, re.I):
            ignored.add(line.number)
            continue

        detected = schema_from_header(line)
        if detected is not None:
            if detected.is_lookup:
                schema = detected
                ignored.add(line.number)
                continue
            active = False
            schema = None
            continue

        assignment = LOOKUP_ASSIGNMENT.match(text)
        if assignment is not None:
            code = assignment.group("code").upper()
            body = assignment.group("body").strip()
            if legend_kind == "component":
                component = _component_from_lookup_body(body)
            else:
                label = {
                    "option": "Option",
                    "finish": "Finish",
                    "manufacturer": "Manufacturer",
                }[legend_kind]
                component = Component(
                    qty=None,
                    description=None,
                    catalog_number=None,
                    mfr=None,
                    finish=None,
                    notes=f"{label} {code} = {body}",
                    confidence=FieldConfidence(notes=0.98),
                )
            entries.append(
                _LookupEntry(
                    code=code,
                    y=line.bbox.y0,
                    component=component,
                    kind=legend_kind,
                )
            )
            ignored.add(line.number)
            continue

        if schema is None:
            legend = _simple_legend_entry(line, legend_kind)
            if legend is not None:
                entries.append(legend)
                ignored.add(line.number)
            continue
        cells = schema.cells(line)
        code = _clean_value(cells.get("lookup_code"))
        if code is None:
            continue
        details = dict(cells)
        details.pop("lookup_code", None)
        component = _component_from_cells(
            details,
            line,
            code_roles.get(line.number, []),
            [],
            schema=schema,
        )
        if component is not None:
            entries.append(
                _LookupEntry(
                    code=code.upper(),
                    y=line.bbox.y0,
                    component=component,
                    kind="component",
                )
            )
            ignored.add(line.number)
    return entries, ignored


def _component_from_lookup_body(body: str) -> Component:
    parts = [part.strip() for part in body.split("|") if part.strip()]
    description: str | None = None
    catalog_number: str | None = None
    mfr: str | None = None
    finish: str | None = None
    if len(parts) >= 4:
        description, catalog_number, mfr, finish = parts[:4]
    elif len(parts) == 3:
        catalog_number, mfr, finish = parts
    elif len(parts) == 2:
        description, catalog_number = parts
    else:
        catalog_number = parts[0] if parts else body.strip()
    return Component(
        qty=None,
        description=description,
        catalog_number=catalog_number,
        mfr=mfr,
        finish=finish,
        notes=None,
        confidence=FieldConfidence(
            description=0.9 if description else None,
            catalog_number=0.9 if catalog_number else None,
            mfr=0.9 if mfr else None,
            finish=0.9 if finish else None,
        ),
    )


def _simple_legend_entry(
    line: TextLine,
    kind: Literal["component", "option", "finish", "manufacturer"],
) -> _LookupEntry | None:
    if kind == "component" or len(line.words) < 2:
        return None
    upper = _normalize_boilerplate(line.text)
    if upper in {"CODE NAME", "CODE NAME:", "CODE DESCRIPTION", "CODE: NAME:"}:
        return None
    gaps = [
        (right.bbox.x0 - left.bbox.x1, index)
        for index, (left, right) in enumerate(zip(line.words, line.words[1:], strict=False))
    ]
    gap, split_index = max(gaps, default=(0.0, -1))
    if gap < 0.06:
        return None
    code = " ".join(word.text for word in line.words[: split_index + 1]).strip(" :")
    body = " ".join(word.text for word in line.words[split_index + 1 :]).strip()
    if not code or not body or len(code) > 20:
        return None
    label = {
        "option": "Option",
        "finish": "Finish",
        "manufacturer": "Manufacturer",
    }[kind]
    component = Component(
        qty=None,
        description=None,
        catalog_number=None,
        mfr=None,
        finish=None,
        notes=f"{label} {code} = {body}",
        confidence=FieldConfidence(notes=0.98),
    )
    return _LookupEntry(code=code.upper(), y=line.bbox.y0, component=component, kind=kind)


def _resolution_notes(
    entries: list[_LookupEntry],
    values: list[str],
    *,
    mfr: str | None = None,
    finish: str | None = None,
) -> str | None:
    tokens = {
        _normalize_code(token)
        for value in values
        for token in value.split()
        if token.strip()
    }
    field_tokens = {
        "manufacturer": {_normalize_code(mfr)} if mfr else set(),
        "finish": {_normalize_code(finish)} if finish else set(),
    }
    notes: list[str] = []
    for entry in entries:
        if entry.kind == "component":
            continue
        relevant_tokens = field_tokens.get(entry.kind, tokens)
        if _normalize_code(entry.code) not in relevant_tokens:
            continue
        if entry.component.notes and entry.component.notes not in notes:
            notes.append(entry.component.notes)
    return "; ".join(notes) or None


def _lookup_component(
    entries: list[_LookupEntry], code: str, line: TextLine, qty: str | None
) -> Component | None:
    matches = [
        entry
        for entry in entries
        if entry.kind == "component" and entry.code == code.upper()
    ]
    if not matches:
        return None
    entry = min(matches, key=lambda candidate: abs(candidate.y - line.bbox.y0))
    component = entry.component.model_copy(deep=True)
    component.strikethrough = ComponentStrikethrough()
    component.qty = qty
    component.notes = _join_notes(component.notes, f"Spec code {code.upper()}")
    component.confidence.qty = 0.95 if qty else None
    component.confidence.notes = 0.95
    return component


def _merge_component_continuation(
    current: _SetBuilder,
    line: TextLine,
    cells: dict[ColumnField, str],
    schema: ColumnSchema,
) -> None:
    previous = current.components[-1]
    updates: dict[str, object] = {}
    quantity = _quantity(cells.get("qty"))
    if previous.qty is None and quantity is not None:
        updates["qty"] = quantity
    for field in ("description", "catalog_number", "notes"):
        value = _clean_value(cells.get(field))  # type: ignore[arg-type]
        if value:
            updates[field] = _join_text(getattr(previous, field), value)
    combined = _clean_value(cells.get("mfr_catalog"))
    if combined:
        if combined.lstrip().startswith("("):
            updates["notes"] = _join_notes(
                updates.get("notes", previous.notes), combined.strip("()")
            )
        else:
            combined_mfr, combined_catalog = _split_mfr_catalog(combined)
            if previous.mfr is None and combined_mfr:
                updates["mfr"] = combined_mfr
            if combined_catalog:
                updates["catalog_number"] = _join_text(
                    updates.get("catalog_number", previous.catalog_number), combined_catalog
                )
    for field in ("mfr", "finish"):
        value = _clean_value(cells.get(field))  # type: ignore[arg-type]
        if getattr(previous, field) is None and value:
            updates[field] = value
    if updates:
        confidence = previous.confidence.model_copy(deep=True)
        continuation_scores = {
            "qty": 0.9,
            "description": 0.82,
            "catalog_number": 0.82,
            "mfr": 0.88,
            "finish": 0.88,
            "notes": 0.8,
        }
        for field, score in continuation_scores.items():
            if field in updates and getattr(confidence, field) is None:
                setattr(confidence, field, score)
        updates["confidence"] = confidence
        updated = previous.model_copy(update=updates)
        current.components[-1] = _with_component_strikethrough(updated, line, schema)
        current.add_line(line)


def _is_wrapped_component(cells: dict[ColumnField, str], line: TextLine) -> bool:
    if _set_number_from_cell(cells.get("set_number")) or cells.get("lookup_code"):
        return False
    description = cells.get("description", "")
    if not description:
        return any(
            cells.get(field)
            for field in ("catalog_number", "mfr", "finish", "notes", "mfr_catalog")
        )
    if _quantity(cells.get("qty")) is not None:
        return False
    only_description = not any(
        cells.get(field)
        for field in ("catalog_number", "mfr", "finish", "lookup_code", "mfr_catalog")
    )
    normalized = " ".join(description.upper().split())
    coordination_continuation = bool(
        normalized == "MORTISE LOCKSET"
        and (cells.get("mfr_catalog") or "").lstrip().startswith("(")
    )
    explicit_continuation = re.match(
        r"^(?:CONTROL DEVICES|DEVICE|HARDWARE|RODS?\b|ELEC\.?(?:TRIC)?\s+UNLOCKING\b|"
        r"ESCUTCHEON\b|FSIC PRIMUS\b|IN-GROUND\b|DOOR BOTTOM\b|"
        r"THUMBTURN\s+-\s+FSIC\b|POWER SUPPLY\s+-\s+FSIC\b)",
        normalized,
    ) is not None
    return line.gap_before <= 0.008 and (
        coordination_continuation
        or explicit_continuation
        or (only_description and HARDWARE_TERM.search(description) is None)
    )


def _cells_have_component(cells: dict[ColumnField, str]) -> bool:
    if any(
        cells.get(field)
        for field in (
            "qty",
            "catalog_number",
            "mfr",
            "finish",
            "notes",
            "lookup_code",
            "mfr_catalog",
        )
    ):
        return True
    description = cells.get("description", "")
    return HARDWARE_TERM.search(description) is not None


def _looks_like_component(line: TextLine, cells: dict[ColumnField, str]) -> bool:
    if cells:
        return _cells_have_component(cells)
    text = " ".join(line.text.split())
    return QTY_PREFIX.match(text) is not None or HARDWARE_TERM.search(text) is not None


def _orphan_component_evidence(
    line: TextLine, cells: dict[ColumnField, str]
) -> int:
    """Score only strong schedule evidence so ordinary hardware prose is not escalated."""

    if cells:
        description = cells.get("description", "")
        structured_value = any(
            cells.get(field)
            for field in (
                "catalog_number",
                "mfr",
                "finish",
                "lookup_code",
                "mfr_catalog",
            )
        )
        quantity = _quantity(cells.get("qty")) is not None
        if structured_value and (description or quantity):
            return 2
        if quantity and HARDWARE_TERM.search(description):
            return 2
        return 0

    text = " ".join(line.text.split())
    match = QTY_PREFIX.match(text)
    if match is None or HARDWARE_TERM.search(match.group("body")) is None:
        return 0
    tokens = [_normalize_code(token) for token in match.group("body").split()]
    has_product_code = any(
        token in MANUFACTURER_CODES
        or _is_finish_code(token)
        or (re.search(r"[A-Z]", token) is not None and re.search(r"\d", token) is not None)
        for token in tokens
    )
    return 2 if has_product_code else 0


def _bare_set_header(
    line: TextLine, next_line: TextLine | None, blank_threshold: float
) -> re.Match[str] | None:
    text = " ".join(line.text.split())
    match = BARE_SET_HEADER.match(text)
    if match is None:
        return None
    number = _normalize_set_number(match.group("number"))
    first_token = number.split()[0].split(".")[0].split("-")[0]
    if first_token in {"DOOR", "ITEM", "PAGE", "PART", "SECTION"}:
        return None
    if number.isdigit() and len(number) > 4:
        return None
    if line.bbox.x0 > 0.12:
        return None
    description = _clean_value(match.group("description"))
    if description and HARDWARE_TERM.search(description):
        return None
    next_is_component = next_line is not None and _looks_like_component(next_line, {})
    has_blank_gap = line.gap_before >= blank_threshold
    if not next_is_component or not has_blank_gap:
        return None
    heading_style = (
        description is not None
        and description == description.upper()
        and re.search(r"[A-Z]{2,}", description) is not None
        and re.match(r"^(?:EA|EACH|LOT|PAIR|PR|SET|X)\b", description) is None
    )
    at_page_start = line.number <= 3
    if description:
        return match if heading_style else None
    return match if at_page_start or has_blank_gap else None


def _blank_gap_threshold(page: PageText) -> float:
    gaps = [line.gap_before for line in page.lines if line.gap_before > 0.001]
    return max(0.012, median(gaps) * 2.2) if gaps else 0.012


def _set_number_from_cell(value: str | None) -> str | None:
    if value is None:
        return None
    match = SET_CELL.match(value)
    return _normalize_set_number(match.group("number")) if match else None


def _normalize_set_number(value: str) -> str:
    return " ".join(value.upper().split())


def _cells_mark_not_used(cells: dict[ColumnField, str]) -> bool:
    description = cells.get("description")
    if description and STATUS_ONLY.match(description):
        return True
    component_values = [
        value
        for field, value in cells.items()
        if field not in {"set_number", "qty"} and not STATUS_ONLY.match(value)
    ]
    if component_values:
        return False
    return any(STATUS_ONLY.match(value) for value in cells.values())


def _quantity(value: str | None) -> str | None:
    cleaned = _clean_value(value)
    if cleaned is None or cleaned.upper() in {"--", "N/A", "NA", "NONE"}:
        return None
    match = QUANTITY_VALUE.fullmatch(cleaned)
    return match.group("value").replace(" ", "") if match else None


def _clean_value(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"[\ue000-\uf8ff]", "", value)
    cleaned = " ".join(cleaned.split()).strip(" |")
    return cleaned or None


def _split_mfr_catalog(value: str) -> tuple[str | None, str | None]:
    separated = re.fullmatch(r"(.+?)\s+-\s+(.+)", value)
    if separated:
        manufacturer = separated.group(1).strip()
        manufacturer_parts = [part.strip() for part in manufacturer.split("/")]
        if manufacturer_parts and all(
            _normalize_code(part) in MANUFACTURER_CODES for part in manufacturer_parts
        ):
            return manufacturer, separated.group(2).strip()
    upper = value.upper()
    for manufacturer in sorted(MANUFACTURER_CODES, key=len, reverse=True):
        if upper == manufacturer:
            return manufacturer, None
        if upper.startswith(f"{manufacturer} "):
            return manufacturer, value[len(manufacturer) :].strip() or None
    return None, value


def _word_groups(line: TextLine, *, has_quantity: bool) -> list[list[Word]]:
    words = list(line.words)
    if has_quantity and words:
        words = words[1:]
    if words and UNIT_VALUE.fullmatch(_normalize_code(words[0].text)):
        words = words[1:]
    if not words:
        return []

    groups = [[words[0]]]
    for word in words[1:]:
        if word.bbox.x0 - groups[-1][-1].bbox.x1 >= 0.025:
            groups.append([word])
        else:
            groups[-1].append(word)
    return groups


def _group_is_codes(words: list[Word], assigned_codes: set[str] | None = None) -> bool:
    assigned_codes = assigned_codes or set()
    return all(
        (normalized := _normalize_code(word.text)) in assigned_codes
        or normalized in MANUFACTURER_CODES
        or normalized in FINISH_CODES
        for word in words
    )


def _infer_codes(
    line: TextLine, values: list[str], code_roles: list[tuple[float, str]]
) -> tuple[str | None, str | None]:
    tokens = [token for value in values for token in value.split()]
    mfr, finish = _infer_trailing_codes(tokens)
    for word in line.words:
        value = _normalize_code(word.text)
        if value not in AMBIGUOUS_CODES:
            continue
        nearby = min(code_roles, key=lambda item: abs(item[0] - word.bbox.x0), default=None)
        if nearby is None or abs(nearby[0] - word.bbox.x0) > 0.035:
            continue
        if nearby[1] == "mfr":
            mfr = value
        elif nearby[1] == "finish":
            finish = value
    return mfr, finish


def _code_roles_for_page(page: PageText) -> dict[int, list[tuple[float, str]]]:
    line_contexts: dict[int, int] = {}
    context = 0
    for line in page.lines:
        if schema_from_header(line) is not None:
            context += 1
        line_contexts[line.number] = context

    columns: dict[int, list[tuple[float, list[str]]]] = {}
    headers: dict[int, list[tuple[float, str]]] = {}
    for line in page.lines:
        line_context = line_contexts[line.number]
        if _match_set_header(" ".join(line.text.split())):
            continue
        for word in line.words:
            value = _normalize_code(word.text)
            if value in {
                "MFR",
                "MANF",
                "MFG",
                "MFGR",
                "MANUFACTURER",
                "VENDOR",
                "MAKE",
            }:
                headers.setdefault(line_context, []).append((word.bbox.x0, "mfr"))
            elif value in {"FINISH", "FIN"}:
                headers.setdefault(line_context, []).append((word.bbox.x0, "finish"))
            if value not in MANUFACTURER_CODES and not _is_finish_code(value):
                continue
            context_columns = columns.setdefault(line_context, [])
            column = next(
                (item for item in context_columns if abs(item[0] - word.bbox.x0) <= 0.025),
                None,
            )
            if column is None:
                context_columns.append((word.bbox.x0, [value]))
            else:
                column[1].append(value)

    roles_by_context: dict[int, list[tuple[float, str]]] = {}
    for line_context, context_columns in columns.items():
        for x0, values in context_columns:
            nearby = min(
                headers.get(line_context, []),
                key=lambda item: abs(item[0] - x0),
                default=None,
            )
            if nearby is not None and abs(nearby[0] - x0) <= 0.05:
                role = nearby[1]
            else:
                role = resolve_code_role(values)
            if role is not None:
                roles_by_context.setdefault(line_context, []).append((x0, role))

    return {
        line.number: roles_by_context.get(line_contexts[line.number], [])
        for line in page.lines
    }


def _infer_trailing_codes(tokens: list[str]) -> tuple[str | None, str | None]:
    candidates = [_normalize_code(token) for token in tokens[-3:]]
    unambiguous_mfr = [
        value for value in candidates if value in MANUFACTURER_CODES - AMBIGUOUS_CODES
    ]
    unambiguous_finish = [
        value for value in candidates if value in FINISH_CODES - AMBIGUOUS_CODES
    ]
    return (
        unambiguous_mfr[-1] if unambiguous_mfr else None,
        unambiguous_finish[-1] if unambiguous_finish else None,
    )


def _normalize_code(value: str) -> str:
    return value.upper().strip().strip(".,;:#()[]")


def _strip_trailing_catalog_codes(
    catalog_number: str | None, mfr: str | None, finish: str | None
) -> str | None:
    """Remove field codes pulled into a catalog group by a narrow column gap."""

    cleaned = catalog_number
    for code in (mfr, finish):
        if cleaned is None or code is None:
            continue
        normalized_catalog = cleaned.upper()
        normalized_code = code.upper()
        if normalized_catalog == normalized_code:
            cleaned = None
        elif normalized_catalog.endswith(f" {normalized_code}"):
            cleaned = cleaned[: -(len(code) + 1)].rstrip() or None
    return cleaned


def _is_finish_code(value: str) -> bool:
    if value in FINISH_CODES:
        return True
    finish = r"(?:(?:US|C)\d{2,3}[A-Z]?|\d{3}[A-Z]?|\d{2}[A-Z])"
    return re.fullmatch(rf"{finish}(?:/{finish})*", value) is not None


def _join_text(existing: str | None, addition: str) -> str:
    return f"{existing} {addition}".strip() if existing else addition


def _join_notes(existing: str | None, addition: str | None) -> str | None:
    if not addition:
        return existing
    return f"{existing}; {addition}" if existing else addition

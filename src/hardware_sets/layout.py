from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .pdf import TextLine

ColumnField = Literal[
    "set_number",
    "qty",
    "description",
    "catalog_number",
    "mfr",
    "finish",
    "notes",
    "lookup_code",
    "mfr_catalog",
    "unit",
]

_LABELS: dict[str, ColumnField] = {
    "set": "set_number",
    "heading": "set_number",
    "qty": "qty",
    "quantity": "qty",
    "q'ty": "qty",
    "description": "description",
    "desc": "description",
    "item": "description",
    "hardware": "description",
    "catalog": "catalog_number",
    "product": "catalog_number",
    "model": "catalog_number",
    "part": "catalog_number",
    "mfr": "mfr",
    "manf": "mfr",
    "mfg": "mfr",
    "mfgr": "mfr",
    "manufacturer": "mfr",
    "vendor": "mfr",
    "make": "mfr",
    "finish": "finish",
    "fin": "finish",
    "notes": "notes",
    "note": "notes",
    "remarks": "notes",
    "remark": "notes",
    "comments": "notes",
    "comment": "notes",
    "code": "lookup_code",
    "unit": "unit",
}
_LABEL_CLEANUP = re.compile(r"^[^a-z0-9']+|[^a-z0-9']+$")


@dataclass(frozen=True)
class Column:
    field: ColumnField
    x: float


@dataclass(frozen=True)
class ColumnSchema:
    columns: tuple[Column, ...]

    def cells(self, line: TextLine) -> dict[ColumnField, str]:
        ordered = sorted(self.columns, key=lambda column: column.x)
        # Header x positions mark the left edge of each column more reliably than
        # midpoint boundaries. Long catalog values often run almost to the next
        # column before a narrow quantity or finish cell begins.
        boundaries = [
            max(left.x + 0.004, right.x - 0.01)
            for left, right in zip(ordered, ordered[1:], strict=False)
        ]
        values: dict[ColumnField, list[str]] = {column.field: [] for column in ordered}
        for word in line.words:
            index = 0
            while index < len(boundaries) and word.bbox.x0 >= boundaries[index]:
                index += 1
            values[ordered[index].field].append(word.text)
        return {
            field: " ".join(parts).strip()
            for field, parts in values.items()
            if parts and " ".join(parts).strip()
        }

    @property
    def is_lookup(self) -> bool:
        fields = {column.field for column in self.columns}
        return "lookup_code" in fields and "set_number" not in fields


def schema_from_header(line: TextLine) -> ColumnSchema | None:
    labeled_words = [
        (_LABEL_CLEANUP.sub("", word.text.lower()), word.bbox.x0) for word in line.words
    ]
    found: dict[ColumnField, float] = {}
    consumed: set[int] = set()
    significant = [
        (index, label, x) for index, (label, x) in enumerate(labeled_words) if label
    ]
    for pair_index, (index, label, x) in enumerate(significant[:-1]):
        next_index, next_label, next_x = significant[pair_index + 1]
        if next_x - x > 0.12:
            continue
        if label in {"hardware", "hw"} and next_label in {"set", "group", "heading"}:
            found.setdefault("set_number", x)
            consumed.update((index, next_index))
        elif label in {"hardware", "hw"} and next_label in {
            "description",
            "item",
            "type",
        }:
            found.setdefault("description", x)
            consumed.update((index, next_index))
        elif label in {
            "manufacturer",
            "mfr",
            "manf",
            "mfg",
            "mfgr",
            "vendor",
            "make",
        } and next_label in {
            "catalog",
            "model",
            "part",
            "product",
        }:
            found.setdefault("mfr_catalog", x)
            consumed.update((index, next_index))

    for index, (label, x) in enumerate(labeled_words):
        if index in consumed:
            continue
        if "manufacturer" in label and any(
            token in label for token in ("product", "catalog", "model", "part")
        ):
            field: ColumnField | None = "mfr_catalog"
        else:
            field = _LABELS.get(label)
        if field is not None:
            found.setdefault(field, x)

    fields = set(found)
    meaningful_words = [label for label, _x in labeled_words if label]
    alphabetic_words = [word.text for word in line.words if re.search(r"[A-Za-z]", word.text)]
    uppercase_ratio = sum(
        word.strip(" .:'\"") == word.strip(" .:'\"").upper()
        for word in alphabetic_words
    ) / max(len(alphabetic_words), 1)
    structural = fields & {
        "qty",
        "catalog_number",
        "mfr",
        "finish",
        "notes",
        "lookup_code",
        "mfr_catalog",
        "unit",
    }
    if len(fields) < 2 or (not structural and len(fields) < 3):
        return None
    if len(fields) / max(len(meaningful_words), 1) < 0.35:
        return None
    if (len(meaningful_words) > 5 or "," in line.text) and uppercase_ratio < 0.6:
        return None
    return ColumnSchema(
        columns=tuple(Column(field=field, x=x) for field, x in found.items())
    )

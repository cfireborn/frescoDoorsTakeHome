from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator

ExtractionOutcome = Literal["extracted", "no_hardware_sets", "needs_review"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BBox(StrictModel):
    """Normalized page coordinates with a top-left origin."""

    x0: float = Field(ge=0, le=1)
    y0: float = Field(ge=0, le=1)
    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def ordered(self) -> BBox:
        if self.x1 <= self.x0 or self.y1 <= self.y0:
            raise ValueError("bbox must have positive area in x0, y0, x1, y1 order")
        return self


class PageRegion(StrictModel):
    page: int = Field(
        ge=1,
        description="One-based page number in the current PDF; final results use source pages",
    )
    bbox: BBox
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def ordered_lines(self) -> PageRegion:
        if (
            self.line_start is not None
            and self.line_end is not None
            and self.line_end < self.line_start
        ):
            raise ValueError("line_end must be greater than or equal to line_start")
        return self


class Location(StrictModel):
    regions: list[PageRegion] = Field(min_length=1)


class FieldConfidence(StrictModel):
    qty: float | None = Field(default=None, ge=0, le=1)
    description: float | None = Field(default=None, ge=0, le=1)
    catalog_number: float | None = Field(default=None, ge=0, le=1)
    mfr: float | None = Field(default=None, ge=0, le=1)
    finish: float | None = Field(default=None, ge=0, le=1)
    notes: float | None = Field(default=None, ge=0, le=1)


class TextRange(StrictModel):
    """Zero-based, end-exclusive character range in an extracted field."""

    start: int = Field(ge=0)
    end: int = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self) -> TextRange:
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


TextRanges: TypeAlias = Annotated[list[TextRange], Field(min_length=1)]


class _StrikethroughFields(StrictModel):
    """Fixed-schema source formatting with a compact mapping interface."""

    def items(self) -> Iterator[tuple[str, TextRanges]]:
        for field in type(self).model_fields:
            ranges = getattr(self, field)
            if ranges is not None:
                yield field, ranges

    def get(self, field: str, default: TextRanges | None = None) -> TextRanges | None:
        ranges = getattr(self, field, None)
        return ranges if ranges is not None else default

    def __getitem__(self, field: str) -> TextRanges:
        ranges = self.get(field)
        if ranges is None:
            raise KeyError(field)
        return ranges

    def __bool__(self) -> bool:
        return any(True for _field, _ranges in self.items())

    def __eq__(self, other: object) -> bool:
        if isinstance(other, dict):
            return dict(self.items()) == other
        return super().__eq__(other)

    @model_serializer(mode="wrap")
    def compact(self, handler: object) -> dict[str, object]:
        serialized = handler(self)  # type: ignore[operator]
        return {field: value for field, value in serialized.items() if value is not None}


class ComponentStrikethrough(_StrikethroughFields):
    qty: TextRanges | None = None
    description: TextRanges | None = None
    catalog_number: TextRanges | None = None
    mfr: TextRanges | None = None
    finish: TextRanges | None = None
    notes: TextRanges | None = None


class SetStrikethrough(_StrikethroughFields):
    set_number: TextRanges | None = None
    description: TextRanges | None = None


class Component(StrictModel):
    qty: str | None
    description: str | None
    catalog_number: str | None
    mfr: str | None
    finish: str | None
    notes: str | None
    strikethrough: ComponentStrikethrough = Field(default_factory=ComponentStrikethrough)
    confidence: FieldConfidence

    @model_validator(mode="after")
    def strikethrough_matches_fields(self) -> Component:
        _validate_strikethrough(self.strikethrough, self)
        return self


class HardwareSet(StrictModel):
    set_number: str = Field(min_length=1)
    description: str | None
    status: Literal["active", "not_used"]
    strikethrough: SetStrikethrough = Field(default_factory=SetStrikethrough)
    location: Location
    components: list[Component]
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def status_matches_components(self) -> HardwareSet:
        if self.status == "not_used" and self.components:
            raise ValueError("status=not_used requires an empty components list")
        _validate_strikethrough(self.strikethrough, self)
        return self


class ModelExtraction(StrictModel):
    outcome: ExtractionOutcome
    sets: list[HardwareSet]
    warnings: list[str]

    @model_validator(mode="after")
    def outcome_matches_content(self) -> ModelExtraction:
        _validate_outcome(self.outcome, self.sets, self.warnings)
        return self


class ExtractionResult(StrictModel):
    source_file: str
    selected_pages: list[int] = Field(min_length=1)
    backend: Literal["heuristic", "openai"]
    outcome: ExtractionOutcome
    sets: list[HardwareSet]
    warnings: list[str]

    @model_validator(mode="after")
    def locations_are_selected(self) -> ExtractionResult:
        _validate_outcome(self.outcome, self.sets, self.warnings)
        selected = set(self.selected_pages)
        if len(selected) != len(self.selected_pages):
            raise ValueError("selected_pages must not contain duplicates")
        for hardware_set in self.sets:
            outside = sorted(
                region.page
                for region in hardware_set.location.regions
                if region.page not in selected
            )
            if outside:
                raise ValueError(
                    f"set {hardware_set.set_number} references unselected pages: {outside}"
                )
        return self


def _validate_outcome(
    outcome: ExtractionOutcome,
    sets: list[HardwareSet],
    warnings: list[str],
) -> None:
    if outcome == "extracted" and not sets:
        raise ValueError("outcome=extracted requires at least one hardware set")
    if outcome == "extracted":
        empty_active = [
            item.set_number
            for item in sets
            if item.status == "active" and not item.components
        ]
        if empty_active:
            raise ValueError(
                "outcome=extracted requires every active set to contain a component: "
                + ", ".join(empty_active)
            )
    if outcome == "no_hardware_sets" and sets:
        raise ValueError("outcome=no_hardware_sets requires an empty sets list")
    if outcome == "needs_review" and not warnings:
        raise ValueError("outcome=needs_review requires an actionable warning")


def _validate_strikethrough(
    strikethrough: ComponentStrikethrough | SetStrikethrough,
    target: Component | HardwareSet,
) -> None:
    for field, ranges in strikethrough.items():
        value = getattr(target, field)
        if not isinstance(value, str):
            raise ValueError(f"strikethrough.{field} requires a string source field")
        previous_end = 0
        for index, text_range in enumerate(ranges):
            if text_range.end > len(value):
                raise ValueError(f"strikethrough.{field}[{index}] exceeds the source field")
            if text_range.start < previous_end:
                raise ValueError(
                    f"strikethrough.{field}[{index}] must be sorted and non-overlapping"
                )
            previous_end = text_range.end

from __future__ import annotations

import base64
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

import pymupdf

from .models import BBox


@dataclass(frozen=True)
class Word:
    text: str
    bbox: BBox
    block: int = 0
    is_struck: bool = False


@dataclass(frozen=True)
class TextLine:
    page: int
    number: int
    text: str
    bbox: BBox
    words: tuple[Word, ...]
    gap_before: float = 0.0
    block: int = 0


@dataclass(frozen=True)
class PageText:
    page: int
    lines: tuple[TextLine, ...]


def page_count(path: Path) -> int:
    with pymupdf.open(path) as document:
        return document.page_count


def extract_page_text(path: Path, pages: list[int]) -> list[PageText]:
    extracted: list[PageText] = []
    with pymupdf.open(path) as document:
        for page_number in pages:
            page = document[page_number - 1]
            width, height = page.rect.width, page.rect.height
            raw_words = page.get_text("words", sort=True)
            source_marks = _source_strikethrough_marks(page)
            rows: list[list[tuple[float, float, float, float, str, int]]] = []
            for x0, y0, x1, y1, text, block_no, _line_no, _word_no in sorted(
                raw_words, key=lambda word: ((word[1] + word[3]) / 2, word[0])
            ):
                center = (y0 + y1) / 2
                if rows:
                    row_center = sum((word[1] + word[3]) / 2 for word in rows[-1]) / len(
                        rows[-1]
                    )
                else:
                    row_center = -100.0
                if rows and abs(center - row_center) <= 2.0:
                    rows[-1].append((x0, y0, x1, y1, text, block_no))
                else:
                    rows.append([(x0, y0, x1, y1, text, block_no)])

            lines: list[TextLine] = []
            previous_bottom: float | None = None
            for line_number, items in enumerate(rows, start=1):
                items.sort(key=lambda item: item[0])
                block_no = items[0][5]
                words = tuple(
                    Word(
                        text=text,
                        bbox=BBox(x0=x0 / width, y0=y0 / height, x1=x1 / width, y1=y1 / height),
                        block=word_block,
                        is_struck=any(
                            _mark_strikes_word(mark, x0=x0, y0=y0, x1=x1, y1=y1)
                            for mark in source_marks
                        ),
                    )
                    for x0, y0, x1, y1, text, word_block in items
                )
                bbox = BBox(
                    x0=min(word.bbox.x0 for word in words),
                    y0=min(word.bbox.y0 for word in words),
                    x1=max(word.bbox.x1 for word in words),
                    y1=max(word.bbox.y1 for word in words),
                )
                gap_before = (
                    0.0 if previous_bottom is None else max(0.0, bbox.y0 - previous_bottom)
                )
                lines.append(
                    TextLine(
                        page=page_number,
                        number=line_number,
                        text=" ".join(word.text for word in words),
                        bbox=bbox,
                        words=words,
                        gap_before=gap_before,
                        block=block_no,
                    )
                )
                previous_bottom = bbox.y1
            extracted.append(PageText(page=page_number, lines=tuple(lines)))
    return extracted


@dataclass(frozen=True)
class _SourceMark:
    x0: float
    y0: float
    x1: float
    y1: float


def _source_strikethrough_marks(page: pymupdf.Page) -> tuple[_SourceMark, ...]:
    marks: list[_SourceMark] = []
    max_height = page.rect.height * 0.003
    min_width = page.rect.width * 0.003

    # Revised schedules often flatten strikeouts into filled rectangles or stroked
    # horizontal lines. Vertical position distinguishes them from underlines and rules.
    for drawing in page.get_drawings():
        for item in drawing.get("items", ()):  # type: ignore[union-attr]
            if not item:
                continue
            if item[0] == "re":
                rectangle = pymupdf.Rect(item[1])
                width = abs(rectangle.width)
                height = abs(rectangle.height)
                if (
                    height <= 0
                    or height > max_height
                    or width < min_width
                    or width / height < 4
                ):
                    continue
                marks.append(_mark_from_rect(rectangle))
            elif item[0] == "l":
                start, end = item[1], item[2]
                run = abs(end.x - start.x)
                rise = abs(end.y - start.y)
                stroke_width = max(float(drawing.get("width") or 0.1), 0.1)
                if (
                    run < min_width
                    or stroke_width > max_height
                    or rise > max(stroke_width, 0.5)
                ):
                    continue
                center = (start.y + end.y) / 2
                marks.append(
                    _SourceMark(
                        x0=min(start.x, end.x),
                        y0=center - stroke_width / 2,
                        x1=max(start.x, end.x),
                        y1=center + stroke_width / 2,
                    )
                )

    annotations = page.annots(types=(pymupdf.PDF_ANNOT_STRIKE_OUT,))
    for annotation in annotations or ():
        vertices = annotation.vertices or ()
        if len(vertices) >= 4 and len(vertices) % 4 == 0:
            for index in range(0, len(vertices), 4):
                quad = vertices[index : index + 4]
                marks.append(
                    _SourceMark(
                        x0=min(point[0] for point in quad),
                        y0=min(point[1] for point in quad),
                        x1=max(point[0] for point in quad),
                        y1=max(point[1] for point in quad),
                    )
                )
        else:
            marks.append(_mark_from_rect(annotation.rect))
    return tuple(marks)


def _mark_from_rect(rectangle: pymupdf.Rect) -> _SourceMark:
    return _SourceMark(
        x0=min(rectangle.x0, rectangle.x1),
        y0=min(rectangle.y0, rectangle.y1),
        x1=max(rectangle.x0, rectangle.x1),
        y1=max(rectangle.y0, rectangle.y1),
    )


def _mark_strikes_word(
    mark: _SourceMark,
    *,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
) -> bool:
    word_height = y1 - y0
    mark_center = (mark.y0 + mark.y1) / 2
    if mark_center < y0 + word_height * 0.25 or mark_center > y0 + word_height * 0.78:
        return False
    overlap = max(0.0, min(x1, mark.x1) - max(x0, mark.x0))
    return overlap >= max(1.0, (x1 - x0) * 0.6)


def selected_pdf_data_url(path: Path, pages: list[int]) -> str:
    source = pymupdf.open(path)
    selected = pymupdf.open()
    try:
        for page_number in pages:
            selected.insert_pdf(source, from_page=page_number - 1, to_page=page_number - 1)
        encoded = base64.b64encode(selected.tobytes(garbage=4, deflate=True)).decode("ascii")
        return f"data:application/pdf;base64,{encoded}"
    finally:
        selected.close()
        source.close()


PdfSource: TypeAlias = Path | bytes


def render_page(source: PdfSource, page_number: int, scale: float = 1.5) -> bytes:
    document = (
        pymupdf.open(stream=source, filetype="pdf")
        if isinstance(source, bytes)
        else pymupdf.open(source)
    )
    with document:
        page = document[page_number - 1]
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
        return pixmap.tobytes("png")

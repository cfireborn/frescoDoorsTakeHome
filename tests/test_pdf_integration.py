from pathlib import Path

import pymupdf

from hardware_sets.pdf import extract_page_text
from hardware_sets.service import extract


def test_extracts_from_a_real_pdf(tmp_path: Path) -> None:
    path = tmp_path / "fixture.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((48, 72), "SET #7 - SERVICE DOOR")
    page.insert_text((72, 96), "3 Hinge T4A3386 MK US26D")
    document.save(path)
    document.close()

    result = extract(path, "1", backend="heuristic")

    assert result.selected_pages == [1]
    assert result.sets[0].set_number == "7"
    assert result.sets[0].components[0].mfr == "MK"
    assert result.sets[0].components[0].finish == "US26D"


def test_reconstructs_a_table_row_and_catalog_column(tmp_path: Path) -> None:
    path = tmp_path / "table.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((48, 72), "HEADING #3A")
    page.insert_text((100, 96), "3")
    page.insert_text((140, 96), "Standard Hinge")
    page.insert_text((280, 96), "T4A3386 5in x 4in")
    page.insert_text((500, 96), "US26D")
    document.save(path)
    document.close()

    result = extract(path, "1", backend="heuristic")

    component = result.sets[0].components[0]
    assert component.qty == "3"
    assert component.description == "Standard Hinge"
    assert component.catalog_number == "T4A3386 5in x 4in"
    assert component.finish == "US26D"


def test_flattened_midline_marks_are_preserved_but_underlines_are_not(
    tmp_path: Path,
) -> None:
    path = tmp_path / "source-edits.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((48, 72), "SET #7 - ENTRY")
    page.insert_text((72, 96), "1 OH Concealed Closer 2031 LCN 689")
    page.insert_text((72, 120), "1 Hinge T4A3386 MK US26D")
    struck = page.search_for("OH Concealed Closer")[0]
    underline = page.search_for("Hinge")[0]
    page.draw_rect(
        pymupdf.Rect(
            struck.x0,
            struck.y0 + struck.height * 0.52,
            struck.x1,
            struck.y0 + struck.height * 0.52 + 0.6,
        ),
        color=None,
        fill=(0, 0, 0),
        width=0,
    )
    page.draw_rect(
        pymupdf.Rect(underline.x0, underline.y1 - 0.5, underline.x1, underline.y1),
        color=None,
        fill=(0, 0, 0),
        width=0,
    )
    document.save(path)
    document.close()

    page_text = extract_page_text(path, [1])[0]
    struck_words = {
        word.text for line in page_text.lines for word in line.words if word.is_struck
    }
    result = extract(path, "1", backend="heuristic")
    components = result.sets[0].components
    closer = next(
        component for component in components if "Closer" in (component.description or "")
    )
    hinge = next(component for component in components if "Hinge" in (component.description or ""))

    assert struck_words == {"OH", "Concealed", "Closer"}
    assert [item.model_dump() for item in closer.strikethrough["description"]] == [
        {"start": 0, "end": 19}
    ]
    assert hinge.strikethrough == {}


def test_explicit_strikeout_annotation_marks_covered_words(tmp_path: Path) -> None:
    path = tmp_path / "annotated.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 96), "OH Concealed Closer")
    annotation = page.add_strikeout_annot(page.search_for("OH Concealed Closer"))
    annotation.update()
    document.save(path)
    document.close()

    words = [word for line in extract_page_text(path, [1])[0].lines for word in line.words]

    assert {word.text for word in words if word.is_struck} == {
        "OH",
        "Concealed",
        "Closer",
    }


def test_stroked_horizontal_midline_marks_covered_words(tmp_path: Path) -> None:
    path = tmp_path / "stroked-line.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 96), "OH Concealed Closer")
    struck = page.search_for("OH Concealed Closer")[0]
    center = struck.y0 + struck.height * 0.52
    page.draw_line(
        pymupdf.Point(struck.x0, center),
        pymupdf.Point(struck.x1, center),
        color=(0, 0, 0),
        width=0.7,
    )
    document.save(path)
    document.close()

    words = [word for line in extract_page_text(path, [1])[0].lines for word in line.words]

    assert {word.text for word in words if word.is_struck} == {
        "OH",
        "Concealed",
        "Closer",
    }

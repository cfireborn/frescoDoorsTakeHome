from __future__ import annotations

import json
import tempfile
from io import BytesIO
from pathlib import Path

import streamlit as st
from PIL import Image, ImageDraw

from hardware_sets.models import Component, ExtractionResult
from hardware_sets.pdf import render_page
from hardware_sets.service import extract


def run() -> None:
    st.set_page_config(page_title="Fresco Hardware Sets", layout="wide")
    st.markdown(
        """
        <style>
        .block-container {max-width: 1500px; padding-top: 2rem;}
        [data-testid="stMetric"] {background: rgba(127, 127, 127, 0.08);
            border: 1px solid rgba(127, 127, 127, 0.25);
            border-radius: 10px; padding: 0.7rem 1rem;}
        </style>
        """,
        unsafe_allow_html=True,
    )
    st.title("Fresco Hardware Sets")
    st.caption(
        "Extract selected Division 08 pages, verify each result against its source, and export "
        "validated JSON."
    )

    input_column, settings_column = st.columns([2, 1])
    uploaded = input_column.file_uploader("Specification PDF", type="pdf")
    pages = input_column.text_input(
        "Pages",
        placeholder="42-48,51",
        help="One-based PDF pages. Only these pages are sent to the selected backend.",
    )
    backend = settings_column.selectbox("Backend", ["heuristic", "openai"])
    model = settings_column.text_input(
        "Model", value="gpt-6-astra", disabled=backend != "openai"
    )
    with settings_column.expander("Advanced"):
        max_pages = st.number_input(
            "Page safety limit",
            min_value=1,
            max_value=250,
            value=30,
            help="Raise this explicitly for a known long schedule.",
        )

    if uploaded and pages and st.button("Extract", type="primary"):
        for key in ("result", "pdf_bytes", "editable_json"):
            st.session_state.pop(key, None)
        pdf_bytes = uploaded.getvalue()
        try:
            with tempfile.TemporaryDirectory(prefix="hardware-sets-") as private_dir:
                pdf_path = Path(private_dir) / Path(uploaded.name).name
                pdf_path.write_bytes(pdf_bytes)
                st.session_state.result = extract(
                    pdf_path,
                    pages,
                    backend=backend,
                    model=model,
                    max_pages=int(max_pages),
                )
            st.session_state.pdf_bytes = pdf_bytes
            st.session_state.editable_json = st.session_state.result.model_dump_json(indent=2)
        except Exception as exc:  # Streamlit should show actionable provider/PDF errors.
            st.error(str(exc))

    result: ExtractionResult | None = st.session_state.get("result")
    pdf_bytes_value: bytes | None = st.session_state.get("pdf_bytes")
    if result is None or pdf_bytes_value is None:
        st.info("Upload a PDF and enter the pages that contain the hardware schedule.")
        return

    editable = st.session_state.get("editable_json", result.model_dump_json(indent=2))
    try:
        corrected = ExtractionResult.model_validate_json(editable)
    except Exception as exc:
        st.error(f"Edited JSON does not match the output schema. {_validation_message(exc)}")
        corrected = result
    else:
        if (
            corrected.source_file != result.source_file
            or corrected.selected_pages != result.selected_pages
            or corrected.backend != result.backend
        ):
            st.error(
                "source_file, selected_pages, and backend are fixed for this review session."
            )
            corrected = result

    if corrected.outcome == "extracted":
        st.success("Extraction complete. Review the source highlights before export.")
    elif corrected.outcome == "no_hardware_sets":
        st.info("No hardware sets were found on the selected pages.")
    else:
        st.warning("The result needs review. Partial sets are preserved below.")
    for warning in corrected.warnings:
        st.warning(warning)

    components = sum(len(item.components) for item in corrected.sets)
    not_used = sum(item.status == "not_used" for item in corrected.sets)
    metric_columns = st.columns(4)
    metric_columns[0].metric("Hardware sets", len(corrected.sets))
    metric_columns[1].metric("Components", components)
    metric_columns[2].metric("Not used", not_used)
    metric_columns[3].metric("Source pages", len(corrected.selected_pages))

    source_column, data_column = st.columns([1, 1.15], gap="large")
    focused_index: int | None = None
    if corrected.sets:
        labels = _set_labels(corrected)
        focused_index = source_column.selectbox(
            "Focus hardware set",
            range(len(corrected.sets)),
            format_func=lambda index: labels[index],
        )
        focus_pages = {
            region.page for region in corrected.sets[focused_index].location.regions
        }
    else:
        focus_pages = set()
    selected_page = source_column.selectbox(
        "Source page",
        corrected.selected_pages,
        index=next(
            (
                index
                for index, page in enumerate(corrected.selected_pages)
                if page in focus_pages
            ),
            0,
        ),
    )
    source_column.image(
        _annotated_page(pdf_bytes_value, selected_page, corrected, focused_index),
        width="stretch",
    )

    data_column.subheader("Extracted sets")
    if not corrected.sets:
        data_column.caption("There are no set records to review.")
    for index, hardware_set in enumerate(corrected.sets):
        pages_label = ", ".join(
            str(region.page) for region in hardware_set.location.regions
        )
        status = "NOT USED" if hardware_set.status == "not_used" else "active"
        title = (
            f"Set {hardware_set.set_number} · {status} · "
            f"{len(hardware_set.components)} components"
        )
        with data_column.expander(title, expanded=index == focused_index):
            if hardware_set.description:
                st.markdown(f"**{hardware_set.description}**")
            st.caption(
                f"Source page(s): {pages_label} · set confidence: "
                f"{hardware_set.confidence:.0%}"
            )
            if hardware_set.components:
                st.dataframe(
                    _component_rows(hardware_set.components),
                    hide_index=True,
                    width="stretch",
                )
            else:
                st.caption("No components. This set is explicitly marked not used.")

    with st.expander("Advanced JSON correction", expanded=False):
        st.caption(
            "Edit any extracted field. Download is available only when the full result passes "
            "the output schema."
        )
        editable_value = st.text_area("Extraction JSON", height=520, key="editable_json")
        try:
            downloadable = ExtractionResult.model_validate_json(editable_value)
            locked_fields_changed = (
                downloadable.source_file != result.source_file
                or downloadable.selected_pages != result.selected_pages
                or downloadable.backend != result.backend
            )
            if locked_fields_changed:
                st.error(
                    "source_file, selected_pages, and backend are fixed for this review session."
                )
            else:
                st.success("JSON is valid.")
                st.download_button(
                    "Download corrected JSON",
                    data=json.dumps(downloadable.model_dump(mode="json"), indent=2) + "\n",
                    file_name=f"{Path(result.source_file).stem}.hardware-sets.json",
                    mime="application/json",
                )
        except Exception as exc:
            st.error(f"JSON does not match the output schema. {_validation_message(exc)}")


def _set_labels(result: ExtractionResult) -> list[str]:
    total_occurrences = {
        item.set_number: sum(other.set_number == item.set_number for other in result.sets)
        for item in result.sets
    }
    seen: dict[str, int] = {}
    labels: list[str] = []
    for hardware_set in result.sets:
        seen[hardware_set.set_number] = seen.get(hardware_set.set_number, 0) + 1
        pages = ", ".join(str(region.page) for region in hardware_set.location.regions)
        suffix = (
            f" · occurrence {seen[hardware_set.set_number]}"
            if total_occurrences[hardware_set.set_number] > 1
            else ""
        )
        labels.append(f"Set {hardware_set.set_number} · p. {pages}{suffix}")
    return labels


def _component_rows(components: list[Component]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for component in components:
        values = component.model_dump()
        confidence_values = [
            value for value in values.pop("confidence").values() if value is not None
        ]
        values["confidence"] = (
            f"{sum(confidence_values) / len(confidence_values):.0%}"
            if confidence_values
            else None
        )
        rows.append(values)
    return rows


def _validation_message(exc: Exception) -> str:
    if not hasattr(exc, "errors"):
        return str(exc)
    errors = exc.errors()  # type: ignore[attr-defined]
    details = []
    for error in errors[:3]:
        location = ".".join(str(part) for part in error.get("loc", ())) or "result"
        details.append(f"{location}: {error.get('msg', 'invalid value')}")
    remaining = len(errors) - len(details)
    suffix = f"; plus {remaining} more error(s)" if remaining else ""
    return "; ".join(details) + suffix


def _annotated_page(
    pdf_bytes: bytes,
    page_number: int,
    result: ExtractionResult,
    focused_index: int | None = None,
) -> bytes:
    image = Image.open(BytesIO(render_page(pdf_bytes, page_number))).convert("RGB")
    draw = ImageDraw.Draw(image)
    for index, hardware_set in enumerate(result.sets):
        for region in hardware_set.location.regions:
            if region.page != page_number:
                continue
            box = region.bbox
            coordinates = (
                int(box.x0 * image.width),
                int(box.y0 * image.height),
                int(box.x1 * image.width),
                int(box.y1 * image.height),
            )
            color = "#157f72" if index == focused_index else "#e24a33"
            width = 6 if index == focused_index else 3
            draw.rectangle(coordinates, outline=color, width=width)
            label_position = (coordinates[0] + 4, max(0, coordinates[1] - 14))
            draw.text(label_position, hardware_set.set_number, fill=color)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


if __name__ == "__main__":
    run()

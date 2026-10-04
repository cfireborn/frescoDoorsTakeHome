from __future__ import annotations

from pathlib import Path

from .heuristic import extract_heuristic
from .models import ExtractionResult
from .openai_backend import extract_openai
from .page_ranges import parse_page_range
from .pdf import extract_page_text, page_count


def extract(
    path: Path,
    page_spec: str,
    *,
    backend: str = "openai",
    model: str = "gpt-6-astra",
    max_pages: int = 30,
) -> ExtractionResult:
    path = path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    document_page_count = page_count(path)
    pages = parse_page_range(page_spec, document_page_count)
    if len(pages) > max_pages:
        raise ValueError(
            f"Selected {len(pages)} pages; the safety limit is {max_pages}. "
            "Narrow --pages or raise --max-pages explicitly."
        )

    if backend == "heuristic":
        parsed = extract_heuristic(
            extract_page_text(path, pages),
            document_page_count=document_page_count,
        )
    elif backend == "openai":
        parsed = extract_openai(path, pages, model=model)
    else:
        raise ValueError(f"unknown backend: {backend}")

    return ExtractionResult(
        source_file=path.name,
        selected_pages=pages,
        backend=backend,  # type: ignore[arg-type]
        outcome=parsed.outcome,
        sets=parsed.sets,
        warnings=parsed.warnings,
    )

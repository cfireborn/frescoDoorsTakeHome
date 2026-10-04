from __future__ import annotations


def parse_page_range(value: str, page_count: int) -> list[int]:
    """Parse a one-based range such as ``3-6,9`` into sorted page numbers."""

    if page_count < 1:
        raise ValueError("PDF has no pages")

    normalized = value.strip().lower()
    if normalized == "all":
        return list(range(1, page_count + 1))
    if not normalized:
        raise ValueError("page range cannot be empty")

    pages: set[int] = set()
    for part in normalized.split(","):
        part = part.strip()
        if not part:
            raise ValueError(f"invalid page range: {value!r}")
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            if not start_text.isdigit() or not end_text.isdigit():
                raise ValueError(f"invalid page range segment: {part!r}")
            start, end = int(start_text), int(end_text)
            if end < start:
                raise ValueError(f"descending page range: {part!r}")
            pages.update(range(start, end + 1))
        else:
            if not part.isdigit():
                raise ValueError(f"invalid page number: {part!r}")
            pages.add(int(part))

    invalid = sorted(page for page in pages if page < 1 or page > page_count)
    if invalid:
        raise ValueError(f"page numbers outside 1-{page_count}: {invalid}")
    return sorted(pages)


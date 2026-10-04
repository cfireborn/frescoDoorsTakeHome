# Agent Instructions

## Minimum effective change

Make the smallest change that fully addresses the task. Read the relevant code and tests first.
Do not refactor adjacent code, add speculative abstractions, or expand dependencies without a concrete
need.

## Project boundaries

- The Python CLI and Streamlit paths accept explicit Division 08 page selections and keep their
  configurable page-count safeguard.
- The hosted browser path scans the complete text PDF, selects likely hardware schedule pages, and
  keeps manual page selection as an optional advanced override. Do not restore a fixed 30-page cap.
- Never commit source specbooks. They may contain project or client information.
- `samples/private/` and generated `output/` stay ignored.
- Keep `evaluation/corpus_sources.local.json` ignored. The committed manifest uses anonymous source
  ids so private filenames and project names do not leak.
- GIF and MP4 demos belong in `media/` and are tracked through Git LFS.
- The hosted extractor must process PDF bytes in the browser. Do not add document upload, storage,
  analytics, or a server extraction route without an explicit product decision and privacy review.

## Extraction invariants

- Preserve one-based source page numbers and normalized `(x0, y0, x1, y1)` boxes with a top-left
  origin.
- Keep NOT USED and N/A sets.
- Missing quantities are `null`; do not infer them.
- A set that crosses a page break remains one set with multiple location regions.
- Resolve manufacturer versus finish codes from headers and the surrounding column population.
- Expand shorthand spec/catalog codes from same-page lookup tables when evidence is available.
- Validate every output through the Pydantic schema before writing it.
- Do not claim accuracy without a labeled evaluation set.

The canonical JSON example and compact test command list live in
[`docs/agents/output-contract.md`](docs/agents/output-contract.md).

## Commands

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[all]"
pytest
ruff check .
```

The OpenAI backend is stubbed and has not been tested against the live API. Its command is retained
for implementation work only:

```bash
hardware-sets extract path/to/spec.pdf --pages 42-48 --output output.json
```

Run the offline development baseline with:

```bash
hardware-sets extract path/to/spec.pdf --pages 42-48 --backend heuristic --output output.json
```

Build and test the hosted browser workflow with:

```bash
cd site
npm test
npm run lint
```

## Verification

Add or update the narrowest regression test for parser changes. Tests should assert field mapping and
provenance, not only set count. Before handoff, run `pytest`, `ruff check .`, and one CLI smoke test.
For Site changes, also run its test and lint commands plus one real PDF upload in a browser. A
longer-document smoke test must leave the manual page override blank and verify the automatically
selected pages against labeled ground truth.

## Documentation style

Keep the README concise and evidence-based. Avoid filler, exaggerated claims, em dashes, excessive
emoji, and repeated setup instructions. Record actual tradeoffs and known failures.

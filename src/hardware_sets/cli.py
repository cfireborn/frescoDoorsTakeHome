from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .models import ExtractionResult
from .service import extract


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hardware-sets")
    subparsers = parser.add_subparsers(dest="command", required=True)

    extract_parser = subparsers.add_parser("extract", help="extract hardware sets from PDF pages")
    extract_parser.add_argument("pdf", type=Path)
    extract_parser.add_argument(
        "--pages",
        required=True,
        help='one-based pages, for example "42-48,51"; use "all" explicitly for the full PDF',
    )
    extract_parser.add_argument(
        "--backend", choices=("openai", "heuristic"), default="openai"
    )
    extract_parser.add_argument("--model", default="gpt-6-astra")
    extract_parser.add_argument("--max-pages", type=int, default=30)
    extract_parser.add_argument("--output", type=Path, help="JSON path; defaults to stdout")

    validate_parser = subparsers.add_parser("validate", help="validate an extraction JSON file")
    validate_parser.add_argument("json_file", type=Path)
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "extract":
            result = extract(
                args.pdf,
                args.pages,
                backend=args.backend,
                model=args.model,
                max_pages=args.max_pages,
            )
            payload = result.model_dump_json(indent=2)
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(payload + "\n", encoding="utf-8")
                print(f"Wrote {len(result.sets)} sets to {args.output}")
            else:
                print(payload)
        elif args.command == "validate":
            result = ExtractionResult.model_validate_json(
                args.json_file.read_text(encoding="utf-8")
            )
            print(f"Valid: {len(result.sets)} sets across {len(result.selected_pages)} pages")
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()

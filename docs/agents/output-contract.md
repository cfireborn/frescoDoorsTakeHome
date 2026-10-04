# Extraction Output Contract

Pages are one-based. Bounding boxes are normalized to `0..1`, use a top-left origin, and follow
`(x0, y0, x1, y1)` order.

```json
{
  "source_file": "spec.pdf",
  "selected_pages": [42, 43],
  "backend": "heuristic",
  "outcome": "extracted",
  "sets": [
    {
      "set_number": "3A",
      "description": "ENTRANCE DOORS",
      "status": "active",
      "location": {
        "regions": [
          {
            "page": 42,
            "bbox": {"x0": 0.08, "y0": 0.21, "x1": 0.93, "y1": 0.86},
            "line_start": 14,
            "line_end": 27
          }
        ]
      },
      "components": [
        {
          "qty": null,
          "description": "Hinge",
          "catalog_number": "T4A3386",
          "mfr": "MK",
          "finish": "US26D",
          "notes": null,
          "strikethrough": {
            "catalog_number": [{"start": 0, "end": 7}]
          },
          "confidence": {
            "qty": null,
            "description": 0.9,
            "catalog_number": 0.88,
            "mfr": 0.94,
            "finish": 0.94,
            "notes": null
          }
        }
      ],
      "confidence": 0.92
    }
  ],
  "warnings": []
}
```

## Tests

```bash
pytest
ruff check .

cd site
npm ci
npm test
npm run lint
```

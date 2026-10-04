import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertResult } from "../app/result-schema.ts";

function validResult() {
  return {
    source_file: "spec.pdf",
    selected_pages: [2],
    backend: "heuristic",
    outcome: "extracted",
    sets: [
      {
        set_number: "3A",
        description: "ENTRY",
        status: "active",
        location: {
          regions: [
            {
              page: 2,
              bbox: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 },
              line_start: 4,
              line_end: 9,
            },
          ],
        },
        components: [
          {
            qty: null,
            description: "Hinge",
            catalog_number: "T4A3386",
            mfr: "MK",
            finish: "US26D",
            notes: null,
            confidence: {
              qty: null,
              description: 0.9,
              catalog_number: 0.88,
              mfr: 0.94,
              finish: 0.94,
              notes: null,
            },
          },
        ],
        confidence: 0.91,
      },
    ],
    warnings: [],
  };
}

test("accepts results that satisfy the extraction contract", () => {
  assert.doesNotThrow(() => assertResult(validResult()));
  const formatted = validResult();
  formatted.sets[0].strikethrough = { description: [{ start: 0, end: 5 }] };
  formatted.sets[0].components[0].strikethrough = {
    catalog_number: [{ start: 8, end: 11 }],
  };
  formatted.sets[0].components[0].catalog_number = "T4A3386 NRP";
  assert.doesNotThrow(() => assertResult(formatted));
  assert.doesNotThrow(() =>
    assertResult({
      ...validResult(),
      outcome: "no_hardware_sets",
      sets: [],
    }),
  );
});

test("accepts the shared canonical result with source strikethrough", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../../tests/fixtures/strikethrough-result.json", import.meta.url), "utf8"),
  );

  assert.doesNotThrow(() => assertResult(fixture));
});

test("rejects malformed nested set, location, component, and confidence values", () => {
  const cases = [
    {
      mutate: (result) => {
        result.sets[0].status = "pending";
      },
      message: /sets\[0\]\.status must be active or not_used/,
    },
    {
      mutate: (result) => {
        result.sets[0].location.regions[0].page = 3;
      },
      message: /sets\[0\]\.location\.regions\[0\]\.page must appear in selected_pages/,
    },
    {
      mutate: (result) => {
        result.sets[0].location.regions[0].bbox.x1 = 0.05;
      },
      message: /bbox must have positive area/,
    },
    {
      mutate: (result) => {
        result.sets[0].components[0].description = ["Hinge"];
      },
      message: /components\[0\]\.description must be a string or null/,
    },
    {
      mutate: (result) => {
        result.sets[0].components[0].confidence.finish = 1.1;
      },
      message: /components\[0\]\.confidence\.finish must be a finite number from 0 to 1/,
    },
    {
      mutate: (result) => {
        result.sets[0].confidence = "high";
      },
      message: /sets\[0\]\.confidence must be a finite number from 0 to 1/,
    },
    {
      mutate: (result) => {
        result.sets[0].components[0].strikethrough = {
          description: [{ start: 0, end: 99 }],
        };
      },
      message: /strikethrough\.description\[0\]\.end must fit the source field/,
    },
    {
      mutate: (result) => {
        result.sets[0].strikethrough = {
          description: [{ start: 4, end: 5 }, { start: 2, end: 3 }],
        };
      },
      message: /strikethrough\.description\[1\] must be sorted and non-overlapping/,
    },
    {
      mutate: (result) => {
        result.sets[0].components[0].strikethrough = {
          qty: [{ start: 0, end: 1 }],
        };
      },
      message: /strikethrough\.qty requires a string source field/,
    },
  ];

  for (const { mutate, message } of cases) {
    const result = structuredClone(validResult());
    mutate(result);
    assert.throws(() => assertResult(result), message);
  }
});

test("rejects contradictory outcomes before they can reach the UI", () => {
  assert.throws(
    () => assertResult({ ...validResult(), sets: [] }),
    /outcome=extracted requires at least one hardware set/,
  );
  assert.throws(
    () => assertResult({ ...validResult(), outcome: "no_hardware_sets" }),
    /outcome=no_hardware_sets requires an empty sets array/,
  );
  assert.throws(
    () => assertResult({ ...validResult(), outcome: "needs_review", sets: [], warnings: [] }),
    /outcome=needs_review requires at least one actionable warning/,
  );
  assert.throws(
    () => assertResult({ ...validResult(), outcome: "toString" }),
    /outcome must be extracted, no_hardware_sets, or needs_review/,
  );

  const notUsedWithComponents = validResult();
  notUsedWithComponents.sets[0].status = "not_used";
  assert.throws(
    () => assertResult(notUsedWithComponents),
    /components must be empty when status is not_used/,
  );

  const emptyActiveSet = validResult();
  emptyActiveSet.sets[0].components = [];
  assert.throws(
    () => assertResult(emptyActiveSet),
    /outcome=extracted cannot contain an active set without components/,
  );
});

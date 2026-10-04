import assert from "node:assert/strict";
import test from "node:test";

import {
  groupRegionsByPage,
  normalizedRegionStyle,
  sourcePdfMatches,
} from "../app/pdf-preview-model.ts";

const region = (page, x0, y0, x1, y1) => ({
  page,
  bbox: { x0, y0, x1, y1 },
  line_start: 2,
  line_end: 4,
});

test("groups multiple provenance regions by one-based source page", () => {
  const grouped = groupRegionsByPage([
    region(8, 0.1, 0.2, 0.7, 0.4),
    region(7, 0.2, 0.3, 0.8, 0.5),
    region(8, 0.15, 0.6, 0.75, 0.8),
  ]);

  assert.deepEqual(grouped.map(({ page, regions }) => [page, regions.length]), [[7, 1], [8, 2]]);
});

test("maps normalized top-left PDF coordinates to exact overlay percentages", () => {
  assert.deepEqual(normalizedRegionStyle(region(3, 0.125, 0.2, 0.875, 0.65)), {
    left: "12.5%",
    top: "20%",
    width: "75%",
    height: "45%",
  });
});

test("only renders provenance when the attached PDF matches the result source", () => {
  const matching = new File([], "SPEC.PDF", { type: "application/pdf" });
  assert.equal(sourcePdfMatches("private/path/spec.pdf", matching), true);
  assert.equal(sourcePdfMatches("different.pdf", matching), false);
  assert.equal(sourcePdfMatches("spec.pdf", null), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComponentScheduleCsv,
  componentSourceDisposition,
  componentScheduleFilename,
  flattenComponentSchedule,
} from "../app/component-schedule.ts";

test("distinguishes full-row removals from partial source edits", () => {
  const full = {
    qty: "1",
    description: "Closer",
    catalog_number: "4040XP",
    mfr: "LCN",
    finish: "689",
    notes: null,
    strikethrough: {
      description: [{ start: 0, end: 6 }],
      catalog_number: [{ start: 0, end: 6 }],
      mfr: [{ start: 0, end: 3 }],
      finish: [{ start: 0, end: 3 }],
    },
    confidence: {},
  };
  assert.equal(componentSourceDisposition(full), "EXCLUDE - FULL SOURCE STRIKE");
  assert.equal(
    componentSourceDisposition({ ...full, strikethrough: { catalog_number: [{ start: 4, end: 6 }] } }),
    "REVIEW - PARTIAL SOURCE STRIKE",
  );
  const struckSet = { strikethrough: { set_number: [{ start: 0, end: 3 }] } };
  assert.equal(
    componentSourceDisposition({ ...full, strikethrough: undefined }, struckSet),
    "REVIEW - PARTIAL SOURCE STRIKE",
  );
  assert.equal(
    componentSourceDisposition(full, struckSet),
    "EXCLUDE - FULL SOURCE STRIKE",
  );
  assert.equal(
    componentSourceDisposition({
      ...full,
      description: "OH Closer",
      strikethrough: {
        ...full.strikethrough,
        description: [{ start: 0, end: 2 }, { start: 3, end: 9 }],
      },
    }),
    "EXCLUDE - FULL SOURCE STRIKE",
  );
});

function result() {
  return {
    source_file: "folder/Project Schedule.pdf",
    selected_pages: [4, 5],
    backend: "heuristic",
    outcome: "extracted",
    warnings: [],
    sets: [
      {
        set_number: "3A",
        description: "ENTRY, NORTH",
        status: "active",
        strikethrough: { description: [{ start: 0, end: 5 }] },
        confidence: 0.9,
        location: {
          regions: [
            { page: 5, bbox: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.4 } },
            { page: 4, bbox: { x0: 0.1, y0: 0.6, x1: 0.8, y1: 0.9 } },
          ],
        },
        components: [
          {
            qty: null,
            description: "Hinge",
            catalog_number: "=CMD()",
            mfr: "MK",
            finish: "US26D",
            notes: "Five knuckle, \"heavy duty\"\nExterior",
            strikethrough: { catalog_number: [{ start: 0, end: 6 }] },
            confidence: { description: 0.9, catalog_number: 0.8 },
          },
          {
            qty: "+2",
            description: "-Closer",
            catalog_number: "@REMOTE",
            mfr: " \t=MAKER",
            finish: "@FINISH",
            notes: "\t-CELL\u0000",
            confidence: { description: 0.8 },
          },
        ],
      },
      {
        set_number: "4",
        description: "FUTURE STORAGE",
        status: "not_used",
        confidence: 0.98,
        location: {
          regions: [{ page: 5, bbox: { x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.15 } }],
        },
        components: [],
      },
      {
        set_number: "3A",
        description: null,
        status: "active",
        confidence: 0.7,
        location: {
          regions: [{ page: 7, bbox: { x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.15 } }],
        },
        components: [
          {
            qty: "1",
            description: "Door stop",
            catalog_number: null,
            mfr: null,
            finish: null,
            notes: null,
            confidence: {},
          },
        ],
      },
    ],
  };
}

test("flattens every component and preserves NOT USED sets and null quantities", () => {
  const rows = flattenComponentSchedule(result());

  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].sourcePages, [4, 5]);
  assert.equal(rows[0].setOrder, 1);
  assert.equal(rows[0].componentOrder, 1);
  assert.equal(rows[0].qty, null);
  assert.equal(rows[0].catalogNumber, "=CMD()");
  assert.equal(rows[0].setStruckText, "description: ENTRY");
  assert.equal(rows[0].componentStruckText, "catalog_number: =CMD()");
  assert.equal(rows[0].orderHandling, "REVIEW - PARTIAL SOURCE STRIKE");
  assert.equal(rows[1].componentStruckText, "");
  assert.equal(rows[1].orderHandling, "REVIEW - PARTIAL SOURCE STRIKE");
  assert.equal(rows[0].componentConfidence, 0.85);
  assert.deepEqual(
    rows.map((row) => [row.setOrder, row.setNumber, row.componentOrder]),
    [[1, "3A", 1], [1, "3A", 2], [2, "4", null], [3, "3A", 1]],
  );
  assert.equal(rows[2].status, "not_used");
  assert.equal(rows[2].orderHandling, "UNCHANGED");
  assert.equal(rows[2].description, null);
  assert.deepEqual(rows[2].sourcePages, [5]);
});

test("exports an Excel-friendly CSV with escaping, blank nulls, and formula protection", () => {
  const csv = buildComponentScheduleCsv(flattenComponentSchedule(result()));
  const lines = csv.split("\r\n");

  assert.match(lines[0], /^\uFEFF"Source File","Result Outcome","Result Warnings"/);
  assert.match(lines[0], /"Set Struck Text"/);
  assert.match(lines[0], /"Component Struck Text"/);
  assert.match(lines[0], /"Order Handling"/);
  assert.match(csv, /"description: ENTRY"/);
  assert.match(csv, /"catalog_number: =CMD\(\)"/);
  assert.match(csv, /"REVIEW - PARTIAL SOURCE STRIKE"/);
  assert.match(csv, /"ENTRY, NORTH"/);
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /"'\+2"/);
  assert.match(csv, /"'-Closer"/);
  assert.match(csv, /"'@REMOTE"/);
  assert.match(csv, /"' \t=MAKER"/);
  assert.match(csv, /"'@FINISH"/);
  assert.match(csv, /"'\t-CELL"/);
  assert.doesNotMatch(csv, /\u0000/);
  assert.match(csv, /"Five knuckle, ""heavy duty""\nExterior"/);
  assert.match(csv, /"1","3A".*"1","4; 5","".*"Hinge"/);
  assert.match(csv, /"2","4","FUTURE STORAGE","NOT USED".*"","5","",""/);
});

test("builds a safe source-derived CSV filename", () => {
  assert.equal(
    componentScheduleFilename("folder/Project Schedule.pdf"),
    "Project-Schedule-component-schedule.csv",
  );
  assert.equal(componentScheduleFilename("///.pdf"), "hardware-sets-component-schedule.csv");
  assert.equal(
    componentScheduleFilename("../../..\n=orders.pdf"),
    "orders-component-schedule.csv",
  );
  assert.ok(componentScheduleFilename(`${"a".repeat(200)}.pdf`).length <= 143);
});

test("exports a deterministic header-only CSV when no sets are present", () => {
  const empty = { ...result(), outcome: "no_hardware_sets", sets: [] };
  const csv = buildComponentScheduleCsv(flattenComponentSchedule(empty));

  assert.equal(csv.split("\r\n").length, 1);
  assert.match(csv, /^\uFEFF"Source File","Result Outcome"/);
});

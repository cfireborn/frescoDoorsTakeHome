import assert from "node:assert/strict";
import test from "node:test";

import {
  applySourceMarks,
  classifyUndiscoveredSchedule,
  discoverHardwareSchedulePages,
  extractTextPages,
  parseOptionalPageSelection,
  parsePageSelection,
  sourceMarksFromPdf,
} from "../app/browser-extractor.ts";
import { assertResult } from "../app/result-schema.ts";

function line(page, number, y, entries) {
  const words = entries.map(([text, x, isStruck]) => ({
    text,
    x0: x,
    y0: y,
    x1: Math.min(0.98, x + Math.max(0.012, text.length * 0.008)),
    y1: y + 0.018,
    ...(isStruck ? { is_struck: true } : {}),
  }));
  return {
    page,
    number,
    text: words.map((word) => word.text).join(" "),
    words,
    bbox: {
      x0: Math.min(...words.map((word) => word.x0)),
      y0: y,
      x1: Math.max(...words.map((word) => word.x1)),
      y1: y + 0.018,
    },
    gapBefore: number === 1 ? 0 : 0.012,
  };
}

test("maps midline marks to words but rejects underlines, borders, and short overlaps", () => {
  const source = page(1, [line(1, 1, 0.2, [["Closer", 0.1]])]);
  const struck = applySourceMarks(source, [
    { x0: 0.1, y0: 0.208, x1: 0.15, y1: 0.209 },
  ]);
  const underlined = applySourceMarks(source, [
    { x0: 0.1, y0: 0.217, x1: 0.15, y1: 0.218 },
  ]);
  const short = applySourceMarks(source, [
    { x0: 0.1, y0: 0.208, x1: 0.105, y1: 0.209 },
  ]);
  const wideBorder = applySourceMarks(source, [
    { x0: 0.01, y0: 0.217, x1: 0.99, y1: 0.218 },
  ]);

  assert.equal(struck.lines[0].words[0].is_struck, true);
  assert.equal(underlined.lines[0].words[0].is_struck, false);
  assert.equal(short.lines[0].words[0].is_struck, false);
  assert.equal(wideBorder.lines[0].words[0].is_struck, false);
});

test("replays PDF transforms, retains long strikes, rejects repeated rules, and splits annotation quads", async () => {
  const ops = {
    save: 1, restore: 2, transform: 3, constructPath: 4,
    stroke: 5, closeStroke: 6, fill: 7, eoFill: 8, fillStroke: 9,
    eoFillStroke: 10, closeFillStroke: 11, closeEOFillStroke: 12,
  };
  const pdfPage = {
    getViewport: () => ({
      width: 100,
      height: 100,
      convertToViewportRectangle: (rectangle) => rectangle,
    }),
    getOperatorList: async () => ({
      fnArray: [
        ops.save, ops.transform,
        ops.constructPath, ops.constructPath,
        ops.constructPath, ops.constructPath, ops.constructPath,
        ops.restore,
      ],
      argsArray: [
        null,
        [2, 0, 0, 2, 10, 20],
        [ops.eoFill, [], [1, 2, 20, 2.1]],
        [ops.eoFill, [], [0, 3, 40, 3.1]],
        [ops.fill, [], [0, 4, 40, 4.1]],
        [ops.fill, [], [0, 5, 40, 5.1]],
        [ops.fill, [], [0, 6, 40, 6.1]],
        null,
      ],
    }),
    getAnnotations: async () => [{
      subtype: "StrikeOut",
      quadPoints: [10, 40, 20, 40, 10, 42, 20, 42, 30, 50, 40, 50, 30, 52, 40, 52],
    }],
  };

  const marks = await sourceMarksFromPdf(pdfPage, ops);

  assert.deepEqual(marks, [
    { x0: 0.12, y0: 0.24, x1: 0.5, y1: 0.242 },
    { x0: 0.1, y0: 0.26, x1: 0.9, y1: 0.262 },
    { x0: 0.1, y0: 0.4, x1: 0.2, y1: 0.42 },
    { x0: 0.3, y0: 0.5, x1: 0.4, y1: 0.52 },
  ]);
});

function page(pageNumber, lines) {
  return { page: pageNumber, lines };
}

test("parses and validates one-based page selections without an arbitrary page cap", () => {
  assert.deepEqual(parsePageSelection("3-5, 2, 5", 9), [2, 3, 4, 5]);
  assert.deepEqual(parsePageSelection("all", 3), [1, 2, 3]);
  assert.equal(parsePageSelection("all", 75).length, 75);
  assert.equal(parsePageSelection("1-75", 75).length, 75);
  assert.throws(() => parsePageSelection("5-3", 8), /Descending page range/);
  assert.throws(() => parsePageSelection("0,2", 8), /between 1 and 8/);
  assert.throws(() => parsePageSelection("1-1000000000", 40), /between 1 and 40/);
});

test("treats an empty optional page override as automatic discovery", () => {
  assert.equal(parseOptionalPageSelection("", 17), null);
  assert.equal(parseOptionalPageSelection("   ", 17), null);
  assert.deepEqual(parseOptionalPageSelection("15-17", 17), [15, 16, 17]);
  assert.throws(() => parseOptionalPageSelection(",", 17), /Invalid page selection/);
});

test("finds a three-page hardware schedule near the end of a 17-page spec", () => {
  const prosePages = Array.from({ length: 13 }, (_value, index) =>
    page(index + 1, [
      line(index + 1, 1, 0.1, [["GENERAL", 0.08], ["REQUIREMENTS", 0.2]]),
      line(index + 1, 2, 0.16, [["Submittals", 0.08], ["and", 0.2], ["quality", 0.28], ["control", 0.38]]),
    ]),
  );
  const attachmentPage = page(14, [
    line(14, 1, 0.1, [["1.46", 0.08], ["DOOR", 0.2], ["HARDWARE", 0.28], ["SCHEDULE", 0.4]]),
    line(14, 2, 0.16, [["ATTACHED", 0.08], ["IN", 0.2], ["FOLLOWING", 0.26], ["PAGES", 0.4]]),
  ]);
  const schedulePage = (pageNumber, setNumber) => page(pageNumber, [
    line(pageNumber, 1, 0.08, [["DOOR", 0.08], ["HARDWARE", 0.16], ["SCHEDULE", 0.3]]),
    line(pageNumber, 2, 0.13, [
      ["SET", 0.05], ["HARDWARE", 0.18], ["TYPE", 0.29], ["MANUFACTURER", 0.43],
      ["PRODUCT", 0.58], ["QTY.", 0.72], ["FINISH", 0.8], ["NOTES", 0.9],
    ]),
    line(pageNumber, 3, 0.2, [
      [setNumber, 0.05], ["MORTISE", 0.18], ["HINGE", 0.28], ["IVES", 0.43],
      ["5BB1", 0.58], ["3", 0.72], ["613", 0.8],
    ]),
    line(pageNumber, 4, 0.26, [
      ["SURFACE", 0.18], ["CLOSER", 0.28], ["LCN", 0.43], ["4040XP", 0.58],
      ["1", 0.72], ["691", 0.8],
    ]),
  ]);

  assert.deepEqual(
    discoverHardwareSchedulePages([
      ...prosePages,
      attachmentPage,
      schedulePage(15, "1.1"),
      schedulePage(16, "3.3"),
      schedulePage(17, "5.1"),
    ]),
    [15, 16, 17],
  );
});

test("discovers a headerless continuation and keeps a numeric catalog out of finish", () => {
  const firstPage = page(262, [
    line(262, 1, 0.7, [["SET", 0.06], ["#1", 0.12], ["-", 0.18], ["ENTRY", 0.22]]),
    line(262, 2, 0.78, [
      ["3.0", 0.06], ["Hinges", 0.16], ["FBB179", 0.48], ["26D", 0.74], ["BES", 0.84],
    ]),
    line(262, 3, 0.84, [
      ["1.0", 0.06], ["Mortise", 0.16], ["Lock", 0.23], ["L9080", 0.48],
      ["626", 0.74], ["C-R", 0.84],
    ]),
  ]);
  const continuation = page(263, [
    line(263, 1, 0.12, [
      ["1.0", 0.06], ["Cylinder", 0.16], ["20-021", 0.48], ["626", 0.74], ["C-R", 0.84],
    ]),
    line(263, 2, 0.18, [
      ["1.0", 0.06], ["Overhead", 0.16], ["Stop", 0.25], ["100S", 0.48],
      ["US32D", 0.74], ["ABH", 0.84],
    ]),
    line(263, 3, 0.24, [
      ["3.0", 0.06], ["Silencers", 0.16], ["500", 0.48], ["GRAY", 0.74], ["BRN", 0.84],
    ]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([firstPage, continuation]), [262, 263]);
  const result = extractTextPages([firstPage, continuation], "continuation.pdf", 344);
  assertResult(result);
  assert.equal(result.sets.length, 1);
  assert.equal(result.sets[0].components.length, 5);
  assert.deepEqual(result.sets[0].location.regions.map((region) => region.page), [262, 263]);
  assert.deepEqual(
    result.sets[0].components.at(-1),
    {
      qty: "3.0",
      description: "Silencers",
      catalog_number: "500",
      mfr: "BRN",
      finish: "GRAY",
      notes: null,
      confidence: {
        qty: 0.77,
        description: 0.74,
        catalog_number: 0.72,
        mfr: 0.74,
        finish: 0.74,
        notes: null,
      },
    },
  );
});

test("rejects prose that sparsely mentions hardware, finish, set, and a numeric range", () => {
  const prose = page(336, [
    line(336, 1, 0.1, [
      ["Coordinate", 0.06], ["the", 0.16], ["hardware", 0.21], ["finish", 0.31],
      ["with", 0.4], ["the", 0.46], ["selected", 0.51], ["casework", 0.63], ["set", 0.75],
    ]),
    line(336, 2, 0.17, [
      ["Provide", 0.06], ["adjustable", 0.16], ["shelves", 0.28], ["from", 0.38],
      ["2", 0.46], ["to", 0.5], ["6", 0.55], ["as", 0.59], ["indicated", 0.64],
    ]),
    line(336, 3, 0.24, [
      ["Coordinate", 0.06], ["dimensions", 0.18], ["with", 0.31], ["the", 0.38],
      ["architectural", 0.44], ["drawings", 0.6],
    ]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([prose]), []);
  const result = extractTextPages([prose], "prose.pdf", 336);
  assert.equal(result.outcome, "no_hardware_sets");
  assert.equal(result.sets.length, 0);
});

test("finds a single-set list page but rejects prose-only schedule references", () => {
  const listPage = page(4, [
    line(4, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["ENTRY", 0.25]]),
    line(4, 2, 0.18, [["3", 0.08], ["Hinge", 0.16], ["5BB1", 0.48], ["IVES", 0.7], ["613", 0.82]]),
    line(4, 3, 0.24, [["1", 0.08], ["Surface", 0.16], ["Closer", 0.24], ["4040XP", 0.48], ["LCN", 0.7], ["691", 0.82]]),
  ]);
  const prosePage = page(3, [
    line(3, 1, 0.1, [["DOOR", 0.08], ["HARDWARE", 0.16], ["SCHEDULE", 0.3]]),
    line(3, 2, 0.18, [["Refer", 0.08], ["to", 0.16], ["the", 0.2], ["hardware", 0.25], ["schedule", 0.36], ["for", 0.5], ["requirements", 0.56]]),
    line(3, 3, 0.24, [["Coordinate", 0.08], ["with", 0.22], ["door", 0.3], ["supplier", 0.38]]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([prosePage, listPage]), [4]);
  assert.deepEqual(discoverHardwareSchedulePages([prosePage]), []);
  assert.equal(extractTextPages([prosePage], "prose.pdf", 3).outcome, "no_hardware_sets");
});

test("discovers a finish-less list from anchored component rows without accepting numbered prose", () => {
  const listPage = page(8, [
    line(8, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["ENTRY", 0.25]]),
    line(8, 2, 0.18, [["3", 0.08], ["Hinge", 0.16], ["5BB1", 0.48], ["IVES", 0.7]]),
    line(8, 3, 0.24, [["1", 0.08], ["Closer", 0.16], ["4040XP", 0.48], ["LCN", 0.7]]),
  ]);
  const numberedProse = page(9, [
    line(9, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["GENERAL", 0.25]]),
    line(9, 2, 0.18, [["1", 0.08], ["Hinge", 0.16], ["doors", 0.3], ["where", 0.4], ["shown", 0.5]]),
    line(9, 3, 0.24, [["2", 0.08], ["Closer", 0.16], ["locations", 0.3], ["are", 0.44], ["typical", 0.5]]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([listPage]), [8]);
  assert.deepEqual(discoverHardwareSchedulePages([numberedProse]), []);
});

test("requires review for unrecognized or externally referenced schedules", () => {
  const unrecognized = page(5, [
    line(5, 1, 0.1, [["DOOR", 0.08], ["HARDWARE", 0.16], ["SCHEDULE", 0.3]]),
    line(5, 2, 0.16, [["Hinge", 0.08], ["T4A3386", 0.24], ["ABH", 0.5], ["630", 0.7]]),
    line(5, 3, 0.22, [["Schedule", 0.08], ["continues", 0.2], ["without", 0.34], ["set", 0.46], ["boundaries", 0.54]]),
  ]);
  const external = page(6, [
    line(6, 1, 0.1, [["SECTION", 0.08], ["08", 0.2], ["71", 0.26], ["00", 0.32]]),
    line(6, 2, 0.16, [["REFER", 0.08], ["TO", 0.18], ["SECTION", 0.24], ["08", 0.38], ["06", 0.44], ["71", 0.5]]),
    line(6, 3, 0.22, [["Door", 0.08], ["hardware", 0.18], ["requirements", 0.32], ["are", 0.5], ["external", 0.58]]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([unrecognized]), []);
  assert.equal(classifyUndiscoveredSchedule([unrecognized]).outcome, "needs_review");
  assert.match(classifyUndiscoveredSchedule([unrecognized]).warnings[0], /could not be recognized/);
  assert.deepEqual(discoverHardwareSchedulePages([external]), []);
  assert.equal(classifyUndiscoveredSchedule([external]).outcome, "needs_review");
  assert.match(classifyUndiscoveredSchedule([external]).warnings[0], /08 06 71/);
});

test("carries a full-document external-schedule warning into a local extraction", () => {
  const localSchedule = page(563, [
    line(563, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["GLASS", 0.25]]),
    line(563, 2, 0.18, [
      ["1", 0.08], ["Door", 0.16], ["Bottom", 0.23], ["Rail", 0.31],
      ["DR100", 0.48], ["CRL", 0.7], ["US32D", 0.82],
    ]),
    line(563, 3, 0.24, [
      ["1", 0.08], ["Door", 0.16], ["Top", 0.23], ["Rail", 0.29],
      ["TR100", 0.48], ["CRL", 0.7], ["US32D", 0.82],
    ]),
  ]);

  const result = extractTextPages(
    [localSchedule],
    "partial.pdf",
    600,
    { externalScheduleMissing: true },
  );
  assert.equal(result.outcome, "needs_review");
  assert.equal(result.sets[0].components.length, 2);
  assert.match(result.warnings.join(" "), /external hardware schedule/);
});

test("uses an authoritative full-document result when a selected page repeats a fulfilled reference", () => {
  const localSchedule = page(31, [
    line(31, 1, 0.08, [["REFER", 0.08], ["TO", 0.16], ["SECTION", 0.22], ["08", 0.34], ["06", 0.4], ["71", 0.46]]),
    line(31, 2, 0.14, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["ENTRY", 0.25]]),
    line(31, 3, 0.2, [["1", 0.08], ["Closer", 0.16], ["4040XP", 0.48], ["LCN", 0.7], ["689", 0.82]]),
  ]);

  const result = extractTextPages(
    [localSchedule],
    "fulfilled-reference.pdf",
    40,
    { externalScheduleMissing: false },
  );
  assert.doesNotMatch(result.warnings.join(" "), /external hardware schedule/);
});

test("does not call a cross-reference missing when Section 08 06 71 is present", () => {
  const reference = page(20, [
    line(20, 1, 0.1, [["REFER", 0.08], ["TO", 0.16], ["SECTION", 0.22], ["08", 0.34], ["06", 0.4], ["71", 0.46]]),
    line(20, 2, 0.18, [["Door", 0.08], ["hardware", 0.18], ["requirements", 0.32]]),
    line(20, 3, 0.24, [["Coordinate", 0.08], ["openings", 0.2]]),
  ]);
  const includedSection = page(30, [
    line(30, 1, 0.1, [["SECTION", 0.08], ["08", 0.2], ["06", 0.26], ["71", 0.32]]),
    line(30, 2, 0.18, [["DOOR", 0.08], ["HARDWARE", 0.18], ["SCHEDULE", 0.32]]),
    line(30, 3, 0.24, [["No", 0.08], ["sets", 0.15], ["apply", 0.22]]),
  ]);

  const classification = classifyUndiscoveredSchedule([reference, includedSection]);
  assert.equal(classification.outcome, "needs_review");
  assert.doesNotMatch(classification.warnings.join(" "), /not present|refers to Section 08 06 71/);
});

test("does not treat a table-of-contents row as the referenced external section", () => {
  const reference = page(20, [
    line(20, 1, 0.1, [["REFER", 0.08], ["TO", 0.16], ["SECTION", 0.22], ["08", 0.34], ["06", 0.4], ["71", 0.46]]),
    line(20, 2, 0.18, [["Door", 0.08], ["hardware", 0.18], ["requirements", 0.32]]),
    line(20, 3, 0.24, [["Coordinate", 0.08], ["openings", 0.2]]),
  ]);
  const contents = page(2, [
    line(2, 1, 0.1, [["TABLE", 0.08], ["OF", 0.18], ["CONTENTS", 0.24]]),
    line(2, 2, 0.18, [
      ["08", 0.08], ["06", 0.14], ["71", 0.2], ["DOOR", 0.3],
      ["HARDWARE", 0.38], ["SCHEDULE", 0.5], ["123", 0.72],
    ]),
    line(2, 3, 0.24, [["08", 0.08], ["71", 0.14], ["00", 0.2], ["DOOR", 0.3], ["HARDWARE", 0.38]]),
  ]);

  const classification = classifyUndiscoveredSchedule([contents, reference]);
  assert.equal(classification.outcome, "needs_review");
  assert.match(classification.warnings.join(" "), /not present/);
});

test("does not treat a prose mention of a door hardware schedule as a heading", () => {
  const prose = page(10, [
    line(10, 1, 0.1, [["SUBMITTALS", 0.08]]),
    line(10, 2, 0.16, [
      ["Shop", 0.08], ["Drawings", 0.16], ["-", 0.27], ["Door", 0.31],
      ["Hardware", 0.38], ["Schedule", 0.49],
    ]),
    line(10, 3, 0.22, [["Coordinate", 0.08], ["with", 0.2], ["openings", 0.28]]),
  ]);

  assert.equal(classifyUndiscoveredSchedule([prose]).outcome, "no_hardware_sets");
});

test("finds one-row and NOT USED-only list pages during automatic discovery", () => {
  const oneRowPage = page(7, [
    line(7, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["ENTRY", 0.25]]),
    line(7, 2, 0.18, [["1", 0.08], ["Hinge", 0.16], ["5BB1", 0.48], ["ABH", 0.7], ["630", 0.82]]),
  ]);
  const notUsedPage = page(8, [
    line(8, 1, 0.1, [["SET", 0.08], ["#2", 0.15], ["-", 0.21], ["FUTURE", 0.25]]),
    line(8, 2, 0.18, [["NOT", 0.08], ["USED", 0.16]]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([oneRowPage]), [7]);
  assert.deepEqual(discoverHardwareSchedulePages([notUsedPage]), [8]);
});

test("discovers and extracts direct HW headers with numeric and alphanumeric set numbers", () => {
  const directHeaderPage = page(712, [
    line(712, 1, 0.08, [
      ["HW", 0.06], ["04", 0.11], ["Interior", 0.2], ["Single", 0.29], ["Storeroom", 0.37],
    ]),
    line(712, 2, 0.13, [
      ["Quantity", 0.06], ["Description", 0.18], ["Model", 0.5], ["Number", 0.57],
      ["Finish", 0.8], ["Manf", 0.9],
    ]),
    line(712, 3, 0.18, [
      ["1", 0.06], ["Set", 0.09], ["Continuous", 0.18], ["Hinge", 0.28],
      ["AC500", 0.5], ["HT", 0.57], ["SEC", 0.61], ["630", 0.8], ["ABH", 0.9],
    ]),
    line(712, 4, 0.26, [
      ["HW", 0.06], ["04A", 0.11], ["Interior", 0.2], ["Single", 0.29], ["No", 0.37], ["Closer", 0.42],
    ]),
    line(712, 5, 0.31, [
      ["Quantity", 0.06], ["Description", 0.18], ["Model", 0.5], ["Number", 0.57],
      ["Finish", 0.8], ["Manf", 0.9],
    ]),
    line(712, 6, 0.36, [
      ["As", 0.06], ["Req", 0.1], ["Hinge-HT", 0.18], ["CB51", 0.5], ["HT", 0.56],
      ["630", 0.8], ["PBB", 0.9],
    ]),
    line(712, 7, 0.44, [["HW", 0.06], ["A03", 0.11], ["Patient", 0.2], ["Room", 0.29]]),
    line(712, 8, 0.49, [
      ["Quantity", 0.06], ["Description", 0.18], ["Model", 0.5], ["Number", 0.57],
      ["Finish", 0.8], ["Manf", 0.9],
    ]),
    line(712, 9, 0.54, [
      ["1", 0.06], ["Ea.", 0.09], ["Door", 0.18], ["Stop", 0.24], ["1841", 0.5],
      ["630", 0.8], ["ABH", 0.9],
    ]),
    line(712, 10, 0.62, [["HW", 0.06], ["E01", 0.11], ["Exterior", 0.2], ["Entry", 0.29]]),
    line(712, 11, 0.67, [
      ["Quantity", 0.06], ["Description", 0.18], ["Model", 0.5], ["Number", 0.57],
      ["Finish", 0.8], ["Manf", 0.9],
    ]),
    line(712, 12, 0.72, [
      ["1", 0.06], ["Ea.", 0.09], ["OH", 0.18], ["Surface", 0.23], ["Closer", 0.31],
      ["4040XP", 0.5], ["689", 0.8], ["LCN", 0.9],
    ]),
  ]);

  assert.deepEqual(discoverHardwareSchedulePages([directHeaderPage]), [712]);
  const result = extractTextPages([directHeaderPage], "direct-hw.pdf", 712);
  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.deepEqual(result.sets.map((set) => set.set_number), ["04", "04A", "A03", "E01"]);
  assert.equal(result.sets[0].description, "Interior Single Storeroom");
  assert.deepEqual(
    result.sets[0].components.map((component) => [
      component.qty,
      component.description,
      component.catalog_number,
      component.finish,
      component.mfr,
    ]),
    [["1", "Continuous Hinge", "AC500 HT SEC", "630", "ABH"]],
  );
  assert.equal(result.sets[1].components[0].qty, null);
  assert.equal(result.sets[1].components[0].finish, "630");
  assert.equal(result.sets[1].components[0].mfr, "PBB");
  assert.equal(result.sets[2].components[0].qty, "1");
  assert.equal(result.sets[3].components[0].qty, "1");
  assert.equal(result.sets[3].location.regions[0].page, 712);
  assert.equal(result.sets[3].location.regions[0].line_start, 10);
  assert.equal(result.sets[3].location.regions[0].line_end, 12);
});

test("preserves full and partial source strikeouts and attaches matching schedule notes", () => {
  const result = extractTextPages(
    [page(713, [
      line(713, 1, 0.1, [
        ["HW", 0.06], ["07", 0.11], ["Interior", 0.2], ["Single", 0.28],
      ]),
      line(713, 2, 0.14, [
        ["Quantity", 0.06], ["Description", 0.18], ["Model", 0.5], ["Number", 0.57],
        ["Finish", 0.8], ["Manf", 0.9],
      ]),
      line(713, 3, 0.2, [
        ["1", 0.06], ["Ea.", 0.09], ["OH", 0.18, true], ["Concealed", 0.23, true],
        ["Closer", 0.32, true], ["2031", 0.5, true], ["Torx", 0.57, true],
        ["689", 0.8, true], ["LCN", 0.9, true],
      ]),
      line(713, 4, 0.25, [
        ["1", 0.06], ["Ea.", 0.09], ["Door", 0.18], ["Stop", 0.24],
        ["1841", 0.5], ["630", 0.8], ["ABH", 0.9],
      ]),
      line(713, 5, 0.3, [
        ["Note:", 0.06], ["NYS", 0.12], ["OMH", 0.18], ["does", 0.24],
        ["not", 0.29], ["approve", 0.34], ["door", 0.43], ["closers", 0.5],
        ["Closer", 0.62], ["removed.", 0.7],
      ]),
      line(713, 6, 0.38, [
        ["HW", 0.06], ["08", 0.11], ["Office", 0.2],
      ]),
      line(713, 7, 0.42, [
        ["Quantity", 0.06], ["Description", 0.18], ["Model", 0.5], ["Number", 0.57],
        ["Finish", 0.8], ["Manf", 0.9],
      ]),
      line(713, 8, 0.48, [
        ["1", 0.06], ["Ea.", 0.09], ["Mortise", 0.18], ["Lock", 0.26],
        ["X-MRX-A-242C", 0.5], ["RQE", 0.68, true], ["630", 0.8], ["TOW", 0.9],
      ]),
      line(713, 9, 0.54, [
        ["1", 0.06], ["Ea.", 0.09], ["Lock", 0.18], ["Power", 0.24], ["Supply", 0.3],
        ["By", 0.5], ["Division", 0.55], ["28", 0.64],
      ]),
      line(713, 10, 0.59, [
        ["Note:", 0.18], ["Controlled", 0.26], ["opening", 0.36], ["Power", 0.43], ["Supply", 0.5],
      ]),
      {
        ...line(713, 11, 0.605, [
          ["Power", 0.18, true], ["Supply", 0.26, true], ["require", 0.34, true],
          ["120VAC.", 0.43, true],
        ]),
        gapBefore: 0.004,
      },
    ])],
    "revision.pdf",
    713,
  );

  assertResult(result);
  const closer = result.sets[0].components[0];
  assert.equal(closer.description, "OH Concealed Closer");
  assert.deepEqual(closer.strikethrough?.description, [{ start: 0, end: 19 }]);
  assert.deepEqual(closer.strikethrough?.catalog_number, [{ start: 0, end: 9 }]);
  assert.match(closer.notes ?? "", /Closer removed/);
  assert.equal(result.sets[0].components[1].strikethrough, undefined);

  const partial = result.sets[1].components[0];
  assert.equal(partial.catalog_number, "X-MRX-A-242C RQE");
  assert.equal(
    partial.catalog_number?.slice(
      partial.strikethrough?.catalog_number?.[0].start,
      partial.strikethrough?.catalog_number?.[0].end,
    ),
    "RQE",
  );
  assert.equal(result.sets[1].components.length, 2);
  const powerSupply = result.sets[1].components[1];
  assert.match(powerSupply.notes ?? "", /Controlled opening Power Supply; Power Supply require 120VAC/);
  const struckNote = powerSupply.strikethrough?.notes?.at(-1);
  assert.equal(
    powerSupply.notes?.slice(struckNote?.start, struckNote?.end),
    "Power Supply require 120VAC.",
  );
});

test("keeps a struck obsolete set separate from an unstruck replacement", () => {
  const result = extractTextPages(
    [page(717, [
      line(717, 1, 0.1, [["HW", 0.06, true], ["14B", 0.11, true], ["Old", 0.2, true], ["Room", 0.27, true]]),
      line(717, 2, 0.16, [["1", 0.06, true], ["Closer", 0.18, true], ["4040XP", 0.5, true], ["LCN", 0.9, true]]),
      line(717, 3, 0.3, [["HW", 0.06], ["14B", 0.11], ["New", 0.2], ["Room", 0.27]]),
      line(717, 4, 0.36, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.9]]),
    ])],
    "replacement.pdf",
    717,
  );

  assertResult(result);
  assert.equal(result.sets.length, 2);
  assert.equal(result.sets[0].strikethrough?.set_number?.[0].start, 0);
  assert.equal(result.sets[1].strikethrough, undefined);
});

test("maps repeated struck heading text to its exact source occurrence", () => {
  const result = extractTextPages(
    [page(7, [
      line(7, 1, 0.1, [
        ["SET", 0.06], ["#7", 0.13], ["-", 0.2], ["ENTRY", 0.24], ["ENTRY", 0.34, true],
      ]),
      line(7, 2, 0.18, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.72], ["689", 0.84]]),
    ])],
    "repeated-text.pdf",
    7,
  );

  assert.equal(result.sets[0].description, "ENTRY ENTRY");
  assert.deepEqual(result.sets[0].strikethrough?.description, [{ start: 6, end: 11 }]);
});

test("does not let a set-label token consume a description strike occurrence", () => {
  const result = extractTextPages(
    [page(7, [
      line(7, 1, 0.1, [
        ["SET", 0.06], ["#7", 0.13], ["-", 0.2], ["SET", 0.24], ["SET", 0.34, true],
      ]),
      line(7, 2, 0.18, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.72], ["689", 0.84]]),
    ])],
    "label-collision.pdf",
    7,
  );

  assert.equal(result.sets[0].description, "SET SET");
  assert.deepEqual(result.sets[0].strikethrough?.description, [{ start: 4, end: 7 }]);
});

test("merges strikethrough evidence from repeated cross-page set headings", () => {
  const result = extractTextPages(
    [
      page(1, [
        line(1, 1, 0.72, [["SET", 0.06], ["#3A", 0.13, true], ["-", 0.2], ["ENTRY", 0.24]]),
        line(1, 2, 0.84, [["1", 0.06], ["Hinge", 0.18], ["5BB1", 0.5], ["IVES", 0.72], ["630", 0.84]]),
      ]),
      page(2, [
        line(2, 1, 0.1, [
          ["SET", 0.06], ["#3A", 0.13], ["-", 0.2], ["ENTRY", 0.24, true], ["CONTINUED", 0.34],
        ]),
        line(2, 2, 0.16, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.72], ["689", 0.84]]),
      ]),
    ],
    "continued-strike.pdf",
    2,
  );

  assert.equal(result.sets.length, 1);
  assert.deepEqual(result.sets[0].strikethrough?.set_number, [{ start: 0, end: 2 }]);
  assert.deepEqual(result.sets[0].strikethrough?.description, [{ start: 0, end: 5 }]);
});

test("keeps repeated same-page set numbers as separate occurrences", () => {
  const result = extractTextPages(
    [page(3, [
      line(3, 1, 0.1, [["SET", 0.06], ["#1", 0.13], ["-", 0.2], ["ENTRY", 0.24]]),
      line(3, 2, 0.16, [["1", 0.06], ["Hinge", 0.18], ["T4A3386", 0.5], ["MK", 0.72], ["US26D", 0.84]]),
      { ...line(3, 3, 0.32, [["SET", 0.06], ["#1", 0.13], ["-", 0.2], ["ENTRY", 0.24]]), gapBefore: 0.14 },
      line(3, 4, 0.38, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.72], ["689", 0.84]]),
    ])],
    "duplicate-sets.pdf",
    3,
  );

  assertResult(result);
  assert.deepEqual(result.sets.map((set) => set.set_number), ["1", "1"]);
  assert.deepEqual(result.sets.map((set) => set.components.length), [1, 1]);
});

test("accepts exact status and continuation suffixes without a heading delimiter", () => {
  for (const heading of ["SET #4 NOT USED", "SET #4 (NOT USED)"]) {
    const result = extractTextPages(
      [page(1, [
        line(1, 1, 0.1, heading.split(" ").map((word, index) => [word, 0.06 + index * 0.08])),
      ])],
      "status-heading.pdf",
      1,
    );

    assertResult(result);
    assert.equal(result.sets[0].set_number, "4");
    assert.equal(result.sets[0].status, "not_used");
  }

  const continued = extractTextPages(
    [
      page(1, [
        line(1, 1, 0.72, [["SET", 0.06], ["#3A", 0.13], ["-", 0.2], ["ENTRY", 0.24]]),
        line(1, 2, 0.84, [["1", 0.06], ["Hinge", 0.18], ["T4A3386", 0.5], ["MK", 0.72], ["US26D", 0.84]]),
      ]),
      page(2, [
        line(2, 1, 0.1, [["SET", 0.06], ["#3A", 0.13], ["(CONTINUED)", 0.24]]),
        line(2, 2, 0.16, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.72], ["689", 0.84]]),
      ]),
    ],
    "continued.pdf",
    2,
  );

  assertResult(continued);
  assert.equal(continued.sets.length, 1);
  assert.deepEqual(continued.sets[0].location.regions.map((region) => region.page), [1, 2]);
});

test("does not consume colon-form set headers as lookup assignments", () => {
  const result = extractTextPages(
    [page(4, [
      line(4, 1, 0.1, [["Set:", 0.06], ["1.0", 0.14]]),
      line(4, 2, 0.18, [["1", 0.06], ["Closer", 0.18], ["4040XP", 0.5], ["LCN", 0.9]]),
    ])],
    "colon-set.pdf",
    4,
  );

  assertResult(result);
  assert.equal(result.sets[0].set_number, "1.0");
  assert.equal(result.sets[0].components.length, 1);
});

test("does not create direct sets from wrapped HARDWARE catalog fragments", () => {
  const result = extractTextPages(
    [page(4, [
      line(4, 1, 0.1, [["SET", 0.06], ["#1", 0.13], ["-", 0.2], ["ENTRY", 0.24]]),
      line(4, 2, 0.18, [["1", 0.06], ["Threshold", 0.18], ["2005", 0.5], ["PE", 0.72], ["630", 0.84]]),
      line(4, 3, 0.205, [["HARDWARE", 0.18], ["SNB24", 0.5]]),
    ])],
    "catalog-wrap.pdf",
    4,
  );

  assert.deepEqual(result.sets.map((set) => set.set_number), ["1"]);
});

test("skips door-list identifiers but preserves a missing-quantity unresolved code", () => {
  const result = extractTextPages(
    [page(5, [
      line(5, 1, 0.1, [["SET", 0.06], ["#2", 0.13], ["-", 0.2], ["SERVICE", 0.24]]),
      line(5, 2, 0.15, [["For", 0.06], ["use", 0.12], ["on", 0.17], ["Door(s):", 0.22]]),
      line(5, 3, 0.19, [["BUSINESS", 0.18]]),
      line(5, 4, 0.23, [["C-019", 0.18]]),
      line(5, 5, 0.27, [["S8-1", 0.18]]),
      line(5, 6, 0.31, [["Provide", 0.06], ["each", 0.15], ["door", 0.23]]),
      line(5, 7, 0.35, [["A", 0.18]]),
    ])],
    "door-ids.pdf",
    5,
  );

  assert.equal(result.sets[0].components.length, 1);
  assert.equal(result.sets[0].components[0].catalog_number, "A");
  assert.equal(result.sets[0].components[0].qty, null);
  assert.match(result.warnings.join(" "), /Unresolved spec\/catalog code\(s\).*A/);
});

test("retains a direct HW set that redirects to another set without treating prose as a header", () => {
  const result = extractTextPages(
    [page(25, [
      line(25, 1, 0.12, [
        ["HW", 0.06], ["06A", 0.11], ["Moved", 0.2], ["to", 0.27], ["Exterior", 0.31],
        ["Set", 0.42], ["HW", 0.47], ["E11", 0.52],
      ]),
      line(25, 2, 0.2, [
        ["Door", 0.06], ["06A", 0.13], ["was", 0.2], ["moved", 0.25], ["to", 0.33],
        ["Exterior", 0.37], ["Set", 0.48], ["HW", 0.54], ["E11", 0.59],
      ]),
    ])],
    "redirect.pdf",
    25,
  );

  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.equal(result.sets.length, 1);
  assert.equal(result.sets[0].set_number, "06A");
  assert.equal(result.sets[0].status, "not_used");
  assert.equal(result.sets[0].description, "Moved to Exterior Set HW E11");
  assert.deepEqual(result.sets[0].components, []);
});

test("captures a following-line HW description without swallowing a status marker", () => {
  const result = extractTextPages(
    [page(8, [
      line(8, 1, 0.1, [["HW", 0.06], ["08", 0.11]]),
      line(8, 2, 0.15, [["MAIN", 0.18], ["ENTRY", 0.27]]),
      line(8, 3, 0.2, [["1", 0.06], ["Hinge", 0.18], ["5BB1", 0.5], ["630", 0.8], ["ABH", 0.9]]),
      line(8, 4, 0.3, [["HW", 0.06], ["09", 0.11]]),
      line(8, 5, 0.35, [["NOT", 0.18], ["USED", 0.27]]),
    ])],
    "following-description.pdf",
    8,
  );

  assertResult(result);
  assert.equal(result.sets[0].description, "MAIN ENTRY");
  assert.equal(result.sets[0].location.regions[0].line_start, 1);
  assert.equal(result.sets[0].location.regions[0].line_end, 3);
  assert.equal(result.sets[1].description, null);
  assert.equal(result.sets[1].status, "not_used");
});

test("keeps an HW-prefixed set cell in the table parser and rejects incidental HW text", () => {
  const result = extractTextPages(
    [page(6, [
      line(6, 1, 0.1, [
        ["SET", 0.04], ["QTY", 0.15], ["DESCRIPTION", 0.25], ["CATALOG", 0.55],
        ["MFR", 0.7], ["FINISH", 0.82],
      ]),
      line(6, 2, 0.18, [
        ["HW", 0.04], ["04", 0.08], ["1", 0.15], ["Hinge", 0.25], ["5BB1", 0.55],
        ["ABH", 0.7], ["630", 0.82],
      ]),
      line(6, 3, 0.25, [
        ["Coordinate", 0.25], ["with", 0.36], ["HW", 0.43], ["E11", 0.48],
      ]),
      line(6, 4, 0.32, [["HW", 0.04], ["04Afoo", 0.08]]),
    ])],
    "table-hw-prefix.pdf",
    6,
  );

  assertResult(result);
  assert.equal(result.sets.length, 1);
  assert.equal(result.sets[0].set_number, "04");
  assert.equal(result.sets[0].components.length, 1);
  assert.equal(result.sets[0].components[0].catalog_number, "5BB1");
});

test("merges wrapped dense-table cells and splits combined manufacturer-product values", () => {
  const result = extractTextPages(
    [page(9, [
      line(9, 1, 0.08, [["ANONYMOUS", 0.04], ["DOOR", 0.12], ["HARDWARE", 0.2], ["SCHEDULE", 0.32]]),
      line(9, 2, 0.12, [
        ["SET", 0.04], ["HARDWARE", 0.14], ["TYPE", 0.22], ["MANUFACTURER", 0.36],
        ["-", 0.48], ["PRODUCT", 0.5], ["QTY.", 0.7], ["FINISH", 0.78], ["NOTES", 0.88],
      ]),
      line(9, 3, 0.18, [
        ["1.2", 0.04], ["MORTISE", 0.14], ["HINGE", 0.22], ["IVES", 0.36],
        ["-", 0.41], ["5BB1", 0.45], ["4.5\"", 0.51], ["x", 0.56], ["4.5\"", 0.59],
        ["3", 0.7], ["613", 0.78],
      ]),
      line(9, 4, 0.24, [
        ["CURTAINWALL", 0.04], ["PANIC", 0.14], ["HARDWARE", 0.21], ["VON", 0.36], ["DUPRIN", 0.4],
        ["-", 0.46], ["35A", 0.48], ["MORTISE", 0.52], ["DEVICE", 0.6],
        ["1", 0.7], ["613", 0.78],
      ]),
      line(9, 5, 0.26, [
        ["CONCEALED", 0.36], ["VERTICAL", 0.44], ["RODS", 0.52],
      ]),
      line(9, 6, 0.28, [
        ["18", 0.36], ["LEVER", 0.39], ["FSIC", 0.46], ["PRIMUS", 0.52],
      ]),
      line(9, 7, 0.34, [
        ["EXTR", 0.04], ["ENTR", 0.08], ["ELECTRIC", 0.14], ["STRIKE", 0.21], ["VON", 0.36], ["DUPRIN", 0.4],
        ["-", 0.46], ["6200", 0.48], ["SERIES", 0.54], ["1", 0.7], ["613", 0.78],
      ]),
      line(9, 8, 0.4, [
        ["SINGLE", 0.04], ["DOOR", 0.09], ["GASKETING", 0.14], ["/", 0.22], ["SWEEP", 0.25], ["PEMKO", 0.36],
        ["/", 0.42], ["NGP", 0.45], ["/", 0.48], ["ZERO", 0.51], ["-", 0.56],
        ["WEATHER", 0.58], ["GASKETING", 0.62], ["--", 0.7], ["BLACK", 0.78],
      ]),
      line(9, 9, 0.46, [
        ["CARD", 0.04], ["READER", 0.08], ["DOOR", 0.14], ["ACCESS", 0.19], ["CONTROL", 0.24], ["DEVICES", 0.3],
        ["CARD", 0.36], ["READER", 0.42], ["/", 0.48], ["DPS", 0.51],
        ["/", 0.55], ["POWER", 0.58], ["SUPPLY", 0.63], ["--", 0.7],
        ["TO", 0.88], ["BE", 0.91], ["PROVIDED", 0.94],
      ]),
      line(9, 10, 0.92, [["Anonymous", 0.08], ["Issue", 0.46], ["1000", 0.82], ["-", 0.86], ["9", 0.9]]),
    ])],
    "dense.pdf",
    9,
  );

  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.equal(result.sets.length, 1);
  assert.equal(result.sets[0].components.length, 5);
  assert.equal(result.sets[0].description, "CURTAINWALL / EXTR ENTR / SINGLE DOOR / CARD READER");
  assert.deepEqual(result.sets[0].location.regions.map((region) => region.page), [9]);
  assert.equal(result.sets[0].location.regions[0].line_end, 9);
  assert.equal(result.sets[0].components[0].mfr, "IVES");
  assert.equal(result.sets[0].components[0].catalog_number, "5BB1 4.5\" x 4.5\"");
  assert.equal(result.sets[0].components[1].description, "PANIC HARDWARE");
  assert.match(result.sets[0].components[1].catalog_number ?? "", /35A MORTISE DEVICE CONCEALED VERTICAL RODS 18 LEVER FSIC PRIMUS/);
  assert.equal(result.sets[0].components[1].confidence.catalog_number, 0.84);
  assert.equal(result.sets[0].components[2].mfr, "VON DUPRIN");
  assert.equal(result.sets[0].components[2].catalog_number, "6200 SERIES");
  assert.equal(result.sets[0].components[3].mfr, "PEMKO / NGP / ZERO");
  assert.equal(result.sets[0].components[3].catalog_number, "WEATHER GASKETING");
  assert.equal(result.sets[0].components[4].mfr, null);
  assert.equal(result.sets[0].components[4].catalog_number, "CARD READER / DPS / POWER SUPPLY");
});

test("suppresses operational prose and page furniture while retaining sealant and gasketing rows", () => {
  const result = extractTextPages(
    [
      page(174, [
        line(174, 1, 0.1, [["SET", 0.06], ["#1", 0.13], ["-", 0.2], ["ENTRY", 0.24]]),
        line(174, 2, 0.18, [
          ["1", 0.06], ["EA", 0.1], ["DOOR", 0.18], ["SEALANT", 0.25],
          ["GASKETING", 0.4], ["BY", 0.54], ["DR", 0.6], ["SUPPLIER", 0.66], ["UNK", 0.82],
        ]),
        line(174, 3, 0.26, [["MODE", 0.06], ["OF", 0.15], ["OPERATION", 0.2]]),
        line(174, 4, 0.31, [
          ["A", 0.06], ["PERSON", 0.11], ["CAN", 0.22], ["ENTER", 0.28], ["PRESSING", 0.37],
          ["THE", 0.5], ["ACTUATOR", 0.56], ["BUTTON", 0.68], ["WHICH", 0.78], ["WILL", 0.88],
        ]),
        line(174, 5, 0.36, [
          ["RETRACT", 0.06], ["KEEPER", 0.18], ["ON", 0.3], ["ELECTRIC", 0.36],
          ["STRIKE", 0.5], ["AND", 0.62], ["ALLOW", 0.7], ["THE", 0.8], ["DOOR", 0.87],
        ]),
      ]),
      page(175, [
        line(175, 1, 0.05, [
          ["Project", 0.04], ["DOOR", 0.24], ["HARDWARE", 0.32], ["SECTION", 0.52],
          ["08", 0.65], ["71", 0.7], ["10", 0.75],
        ]),
        line(175, 2, 0.15, [["Hardware", 0.06], ["Group", 0.16], ["No.", 0.25], ["02", 0.32], ["-", 0.38], ["SERVICE", 0.42]]),
        line(175, 3, 0.22, [
          ["1", 0.06], ["EA", 0.1], ["GASKETING", 0.18], ["312A-S", 0.48],
          ["x", 0.57], ["door", 0.61], ["width", 0.68], ["A", 0.78], ["ZER", 0.86],
        ]),
      ]),
    ],
    "narrative.pdf",
    175,
  );

  assert.deepEqual(result.sets.map((hardwareSet) => hardwareSet.components.length), [1, 1]);
  assert.match(result.sets[0].components[0].description ?? "", /DOOR SEALANT/);
  assert.match(result.sets[1].components[0].description ?? "", /GASKETING/);
});

test("merges close table continuations and shifts their strike ranges", () => {
  const continuation = {
    ...line(290, 3, 0.205, [["OUTSWING", 0.55], ["LOCKING", 0.61], ["DOORS)", 0.66]]),
    gapBefore: 0.007,
  };
  const struckContinuation = {
    ...line(290, 5, 0.325, [["INSIDE", 0.25], ["INDICATOR", 0.34, true]]),
    gapBefore: 0.007,
  };
  const result = extractTextPages(
    [page(290, [
      line(290, 1, 0.08, [
        ["SET", 0.04], ["QTY", 0.15], ["DESCRIPTION", 0.25], ["CATALOG", 0.55],
        ["MFR", 0.72], ["FINISH", 0.84],
      ]),
      line(290, 2, 0.18, [
        ["1", 0.04], ["3", 0.15], ["Hinge", 0.25], ["5BB1", 0.55],
        ["4.5", 0.61], ["X", 0.66], ["4.5", 0.69], ["(NRP", 0.75], ["AT", 0.79],
        ["IVES", 0.72], ["630", 0.84],
      ]),
      continuation,
      line(290, 4, 0.3, [
        ["1", 0.04], ["1", 0.15], ["Classroom", 0.25], ["Security", 0.35], ["Lock", 0.44],
        ["ND80", 0.55], ["SCH", 0.72], ["626", 0.84],
      ]),
      struckContinuation,
    ])],
    "continuations.pdf",
    290,
  );

  assert.match(result.sets[0].components[0].catalog_number ?? "", /OUTSWING LOCKING DOORS\)/);
  const lock = result.sets[0].components[1];
  assert.equal(lock.description, "Classroom Security Lock INSIDE INDICATOR");
  const strike = lock.strikethrough?.description?.[0];
  assert.equal(lock.description?.slice(strike?.start, strike?.end), "INDICATOR");
});

test("keeps a combined-column component with missing quantity and finish as a new row", () => {
  const result = extractTextPages(
    [page(4, [
      line(4, 1, 0.1, [
        ["SET", 0.04], ["HARDWARE", 0.14], ["TYPE", 0.22], ["MANUFACTURER", 0.36],
        ["-", 0.48], ["PRODUCT", 0.5], ["QTY.", 0.7], ["FINISH", 0.78],
      ]),
      line(4, 2, 0.18, [
        ["1.1", 0.04], ["HINGE", 0.14], ["IVES", 0.36], ["-", 0.42], ["5BB1", 0.46],
        ["3", 0.7], ["613", 0.78],
      ]),
      line(4, 3, 0.24, [
        ["WALL", 0.14], ["STOP", 0.19], ["IVES", 0.36], ["-", 0.42], ["WS401", 0.46],
      ]),
    ])],
    "missing-values.pdf",
    4,
  );

  assertResult(result);
  assert.equal(result.sets[0].components.length, 2);
  assert.equal(result.sets[0].components[1].description, "WALL STOP");
  assert.equal(result.sets[0].components[1].qty, null);
  assert.equal(result.sets[0].components[1].finish, null);
  assert.equal(result.sets[0].components[1].mfr, "IVES");
  assert.equal(result.sets[0].components[1].catalog_number, "WS401");
});

test("keeps an adjacent multi-page list set and resolves PE from column population", () => {
  const result = extractTextPages(
    [
      page(1, [
        line(1, 1, 0.72, [["SET", 0.08], ["#3A", 0.15], ["-", 0.22], ["MAIN", 0.27], ["ENTRY", 0.35]]),
        line(1, 2, 0.84, [["3", 0.08], ["Hinge", 0.16], ["T4A3386", 0.48], ["MK", 0.72], ["US26D", 0.84]]),
      ]),
      page(2, [
        line(2, 1, 0.12, [["1", 0.08], ["Surface", 0.16], ["Closer", 0.24], ["4040XP", 0.48], ["LCN", 0.72], ["689", 0.84]]),
        line(2, 2, 0.18, [["1", 0.08], ["Threshold", 0.16], ["2005", 0.48], ["PE", 0.72], ["630", 0.84]]),
      ]),
    ],
    "multipage.pdf",
    2,
  );

  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.equal(result.sets.length, 1);
  assert.deepEqual(result.sets[0].location.regions.map((region) => region.page), [1, 2]);
  assert.deepEqual(
    result.sets[0].location.regions.map((region) => [region.line_start, region.line_end]),
    [[1, 2], [1, 2]],
  );
  assert.equal(result.sets[0].components[2].mfr, "PE");
  assert.equal(result.sets[0].components[2].finish, "630");
});

test("keeps multiword list descriptions separate from catalogs and rejects schedule prose", () => {
  const result = extractTextPages(
    [page(1, [
      line(1, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["ENTRY", 0.25]]),
      line(1, 2, 0.18, [["1", 0.08], ["Surface", 0.16], ["Closer", 0.24], ["4040XP", 0.48], ["LCN", 0.7], ["689", 0.82]]),
      line(1, 3, 0.24, [["1", 0.08], ["Electric", 0.16], ["Lock", 0.24], ["ND80", 0.48], ["SCH", 0.7], ["626", 0.82]]),
      line(1, 4, 0.3, [["1", 0.08], ["4040XP", 0.16], ["Surface", 0.3], ["Closer", 0.4], ["LCN", 0.7], ["689", 0.82]]),
      line(1, 5, 0.36, [["CARD", 0.08], ["READER", 0.16], ["OR", 0.27], ["KEYPAD", 0.33], ["SHALL", 0.45], ["UNLOCK", 0.55], ["DOOR", 0.68]]),
    ])],
    "list-rows.pdf",
    1,
  );

  assertResult(result);
  assert.deepEqual(
    result.sets[0].components.map((component) => [component.description, component.catalog_number]),
    [
      ["Surface Closer", "4040XP"],
      ["Electric Lock", "ND80"],
      ["Surface Closer", "4040XP"],
    ],
  );
});

test("retains NOT USED and leaves an absent list quantity null", () => {
  const result = extractTextPages(
    [page(1, [
      line(1, 1, 0.12, [["SET", 0.08], ["#4", 0.15], ["-", 0.21], ["FUTURE", 0.25], ["STORAGE", 0.36]]),
      line(1, 2, 0.17, [["NOT", 0.12], ["USED", 0.19]]),
      line(1, 3, 0.28, [["SET", 0.08], ["#5", 0.15], ["-", 0.21], ["SERVICE", 0.25]]),
      line(1, 4, 0.34, [["Door", 0.16], ["Stop", 0.22], ["1200", 0.48], ["IVE", 0.72], ["626", 0.84]]),
      line(1, 5, 0.4, [["2005", 0.16], ["Threshold", 0.28], ["PE", 0.72], ["630", 0.84]]),
    ])],
    "status.pdf",
    1,
  );

  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.equal(result.sets[0].status, "not_used");
  assert.deepEqual(result.sets[0].components, []);
  assert.equal(result.sets[1].components[0].qty, null);
  assert.equal(result.sets[1].components[1].qty, null);
  assert.equal(result.sets[1].components[1].catalog_number, "2005");
  assert.equal(result.sets[1].components[1].description, "Threshold");
});

test("maps table columns contextually, including ambiguous PE values", () => {
  const result = extractTextPages(
    [page(1, [
      line(1, 1, 0.1, [["SET", 0.05], ["QTY", 0.15], ["DESCRIPTION", 0.25], ["CATALOG", 0.55], ["MFR", 0.7], ["FINISH", 0.82]]),
      line(1, 2, 0.16, [["1", 0.05], ["ENTRANCE", 0.25], ["DOORS", 0.36]]),
      line(1, 3, 0.22, [["1", 0.15], ["Hinge", 0.25], ["T4A3386", 0.55], ["MK", 0.7], ["PE", 0.82]]),
      line(1, 4, 0.28, [["1", 0.15], ["Threshold", 0.25], ["2005", 0.55], ["PE", 0.7], ["630", 0.82]]),
    ])],
    "table.pdf",
    1,
  );

  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.equal(result.sets[0].description, "ENTRANCE DOORS");
  assert.deepEqual(
    result.sets[0].components.map((component) => [component.mfr, component.finish]),
    [["MK", "PE"], ["PE", "630"]],
  );
});

test("expands a simple same-page component code assignment", () => {
  const result = extractTextPages(
    [page(1, [
      line(1, 1, 0.08, [["CODE", 0.08], ["DESCRIPTION", 0.2], ["CATALOG", 0.46], ["MFR", 0.66], ["FINISH", 0.8]]),
      line(1, 2, 0.13, [["A", 0.08], ["Hinge", 0.2], ["T4A3386", 0.46], ["MK", 0.66], ["US26D", 0.8]]),
      line(1, 3, 0.24, [["SET", 0.08], ["#8", 0.15], ["-", 0.21], ["OFFICE", 0.25]]),
      line(1, 4, 0.3, [["3", 0.08], ["A", 0.18]]),
    ])],
    "lookup.pdf",
    1,
  );

  assertResult(result);
  assert.equal(result.outcome, "extracted");
  assert.deepEqual(
    {
      qty: result.sets[0].components[0].qty,
      description: result.sets[0].components[0].description,
      catalog: result.sets[0].components[0].catalog_number,
      mfr: result.sets[0].components[0].mfr,
      finish: result.sets[0].components[0].finish,
    },
    { qty: "3", description: "Hinge", catalog: "T4A3386", mfr: "MK", finish: "US26D" },
  );
  assert.doesNotMatch(result.sets[0].components[0].notes ?? "", /Unresolved/);
});

test("resolves a duplicate lookup code from the nearest same-page definition", () => {
  const result = extractTextPages(
    [page(1, [
      line(1, 1, 0.05, [["SPEC", 0.08], ["CODE", 0.16]]),
      line(1, 2, 0.1, [["A", 0.08], ["=", 0.12], ["Hinge", 0.18], ["|", 0.3], ["OLD", 0.34], ["|", 0.44], ["MK", 0.48], ["|", 0.58], ["US26D", 0.62]]),
      line(1, 3, 0.5, [["SET", 0.08], ["#2", 0.15], ["-", 0.22], ["ENTRY", 0.27]]),
      line(1, 4, 0.55, [["1", 0.08], ["A", 0.18]]),
      line(1, 5, 0.6, [["SPEC", 0.08], ["CODE", 0.16]]),
      line(1, 6, 0.65, [["A", 0.08], ["=", 0.12], ["Hinge", 0.18], ["|", 0.3], ["NEW", 0.34], ["|", 0.44], ["MK", 0.48], ["|", 0.58], ["US26D", 0.62]]),
    ])],
    "nearest-lookup.pdf",
    1,
  );

  assertResult(result);
  assert.equal(result.sets[0].components[0].catalog_number, "NEW");
});

test("does not swallow assignment-shaped component text outside a lookup legend", () => {
  const result = extractTextPages(
    [page(1, [
      line(1, 1, 0.1, [["SET", 0.08], ["#1", 0.15], ["-", 0.21], ["ENTRY", 0.25]]),
      line(1, 2, 0.18, [["A", 0.08], ["=", 0.12], ["Hinge", 0.18], ["|", 0.3], ["5BB1", 0.34], ["|", 0.44], ["ABH", 0.48], ["|", 0.58], ["630", 0.62]]),
    ])],
    "not-a-legend.pdf",
    1,
  );

  assertResult(result);
  assert.equal(result.sets[0].components.length, 1);
  assert.match(result.sets[0].components[0].description ?? "", /Hinge/);
});

test("distinguishes readable no-set pages from unreliable or headerless schedules", () => {
  const noSets = extractTextPages(
    [page(1, [
      line(1, 1, 0.1, [["GENERAL", 0.08], ["REQUIREMENTS", 0.2]]),
      line(1, 2, 0.16, [["Quality", 0.08], ["assurance", 0.18], ["applies", 0.3]]),
      line(1, 3, 0.22, [["Submittals", 0.08], ["are", 0.2], ["required", 0.26]]),
    ])],
    "no-sets.pdf",
    1,
  );
  assert.equal(noSets.outcome, "no_hardware_sets");
  assert.match(noSets.warnings.join(" "), /selected pages/);

  const scanned = extractTextPages([page(1, [])], "scan.pdf", 1);
  assert.equal(scanned.outcome, "needs_review");
  assert.match(scanned.warnings.join(" "), /OCR/);

  const headerless = extractTextPages(
    [page(1, [
      line(1, 1, 0.1, [["1", 0.08], ["Hinge", 0.16], ["T4A3386", 0.48], ["MK", 0.72], ["US26D", 0.84]]),
      line(1, 2, 0.16, [["Coordinate", 0.08], ["all", 0.2], ["requirements", 0.26]]),
      line(1, 3, 0.22, [["Submit", 0.08], ["product", 0.16], ["data", 0.24], ["for", 0.3], ["review", 0.35]]),
    ])],
    "headerless.pdf",
    1,
  );
  assert.equal(headerless.outcome, "needs_review");
  assert.match(headerless.warnings.join(" "), /page\(s\) 1 had no recoverable hardware set identifier/);
});

export type Outcome = "extracted" | "no_hardware_sets" | "needs_review";

export type Region = {
  page: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  line_start?: number | null;
  line_end?: number | null;
};

export type TextRange = { start: number; end: number };
export type ComponentTextField =
  | "qty"
  | "description"
  | "catalog_number"
  | "mfr"
  | "finish"
  | "notes";

export type Component = {
  qty: string | null;
  description: string | null;
  catalog_number: string | null;
  mfr: string | null;
  finish: string | null;
  notes: string | null;
  strikethrough?: Partial<Record<ComponentTextField, TextRange[]>>;
  confidence: Partial<Record<ConfidenceField, number | null>>;
};

export type HardwareSet = {
  set_number: string;
  description: string | null;
  status: "active" | "not_used";
  strikethrough?: Partial<Record<"set_number" | "description", TextRange[]>>;
  location: { regions: Region[] };
  components: Component[];
  confidence: number;
};

export type ExtractionResult = {
  source_file: string;
  selected_pages: number[];
  backend: "heuristic" | "openai";
  outcome: Outcome;
  sets: HardwareSet[];
  warnings: string[];
};

type JsonObject = Record<string, unknown>;
type ConfidenceField =
  | "qty"
  | "description"
  | "catalog_number"
  | "mfr"
  | "finish"
  | "notes";

const TOP_LEVEL_KEYS = ["source_file", "selected_pages", "backend", "outcome", "sets", "warnings"];
const SET_KEYS = [
  "set_number",
  "description",
  "status",
  "strikethrough",
  "location",
  "components",
  "confidence",
];
const REGION_KEYS = ["page", "bbox", "line_start", "line_end"];
const BBOX_KEYS = ["x0", "y0", "x1", "y1"];
const COMPONENT_KEYS = [
  "qty",
  "description",
  "catalog_number",
  "mfr",
  "finish",
  "notes",
  "strikethrough",
  "confidence",
];
const CONFIDENCE_KEYS: ConfidenceField[] = [
  "qty",
  "description",
  "catalog_number",
  "mfr",
  "finish",
  "notes",
];
const COMPONENT_TEXT_FIELDS: ComponentTextField[] = [
  "qty",
  "description",
  "catalog_number",
  "mfr",
  "finish",
  "notes",
];
const SET_TEXT_FIELDS = ["set_number", "description"] as const;
const OUTCOMES: Outcome[] = ["extracted", "no_hardware_sets", "needs_review"];

function fail(path: string, requirement: string): never {
  throw new Error(`${path} ${requirement}.`);
}

function assertObject(value: unknown, path: string): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object");
  }
}

function assertOnlyKeys(value: JsonObject, allowed: readonly string[], path: string) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) fail(`${path}.${unexpected}`, "is not supported");
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") fail(path, "must be a string");
}

function assertNullableString(value: unknown, path: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") fail(path, "must be a string or null");
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(path, "must be a positive integer");
  }
}

function assertStrikethrough(
  value: unknown,
  path: string,
  target: JsonObject,
  allowed: readonly string[],
) {
  if (value === undefined) return;
  assertObject(value, path);
  assertOnlyKeys(value, allowed, path);
  for (const [field, ranges] of Object.entries(value)) {
    const text = target[field];
    if (typeof text !== "string") fail(`${path}.${field}`, "requires a string source field");
    if (!Array.isArray(ranges) || !ranges.length) fail(`${path}.${field}`, "must be a non-empty array");
    let previousEnd = 0;
    ranges.forEach((range, index) => {
      const rangePath = `${path}.${field}[${index}]`;
      assertObject(range, rangePath);
      assertOnlyKeys(range, ["start", "end"], rangePath);
      if (!Number.isInteger(range.start) || (range.start as number) < 0) {
        fail(`${rangePath}.start`, "must be a non-negative integer");
      }
      if (!Number.isInteger(range.end) || (range.end as number) <= (range.start as number)) {
        fail(`${rangePath}.end`, "must be an integer greater than start");
      }
      if ((range.end as number) > text.length) fail(`${rangePath}.end`, "must fit the source field");
      if ((range.start as number) < previousEnd) fail(rangePath, "must be sorted and non-overlapping");
      previousEnd = range.end as number;
    });
  }
}

function assertOptionalPositiveInteger(value: unknown, path: string) {
  if (value !== undefined && value !== null) assertPositiveInteger(value, path);
}

function assertScore(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(path, "must be a finite number from 0 to 1");
  }
}

function assertConfidence(value: unknown, path: string): asserts value is Component["confidence"] {
  assertObject(value, path);
  assertOnlyKeys(value, CONFIDENCE_KEYS, path);
  for (const [field, score] of Object.entries(value)) {
    if (score !== null) assertScore(score, `${path}.${field}`);
  }
}

function assertRegion(value: unknown, path: string, selectedPages: Set<number>): asserts value is Region {
  assertObject(value, path);
  assertOnlyKeys(value, REGION_KEYS, path);
  assertPositiveInteger(value.page, `${path}.page`);
  if (!selectedPages.has(value.page)) fail(`${path}.page`, "must appear in selected_pages");

  assertObject(value.bbox, `${path}.bbox`);
  assertOnlyKeys(value.bbox, BBOX_KEYS, `${path}.bbox`);
  for (const coordinate of BBOX_KEYS) {
    assertScore(value.bbox[coordinate], `${path}.bbox.${coordinate}`);
  }
  const { x0, y0, x1, y1 } = value.bbox as Region["bbox"];
  if (x1 <= x0 || y1 <= y0) fail(`${path}.bbox`, "must have positive area in x0, y0, x1, y1 order");

  assertOptionalPositiveInteger(value.line_start, `${path}.line_start`);
  assertOptionalPositiveInteger(value.line_end, `${path}.line_end`);
  if (
    typeof value.line_start === "number" &&
    typeof value.line_end === "number" &&
    value.line_end < value.line_start
  ) {
    fail(`${path}.line_end`, "must be greater than or equal to line_start");
  }
}

function assertComponent(value: unknown, path: string): asserts value is Component {
  assertObject(value, path);
  assertOnlyKeys(value, COMPONENT_KEYS, path);
  for (const field of ["qty", "description", "catalog_number", "mfr", "finish", "notes"] as const) {
    assertNullableString(value[field], `${path}.${field}`);
  }
  assertStrikethrough(value.strikethrough, `${path}.strikethrough`, value, COMPONENT_TEXT_FIELDS);
  assertConfidence(value.confidence, `${path}.confidence`);
}

function assertHardwareSet(
  value: unknown,
  path: string,
  selectedPages: Set<number>,
): asserts value is HardwareSet {
  assertObject(value, path);
  assertOnlyKeys(value, SET_KEYS, path);
  assertString(value.set_number, `${path}.set_number`);
  if (!value.set_number.trim()) fail(`${path}.set_number`, "must not be empty");
  assertNullableString(value.description, `${path}.description`);
  if (value.status !== "active" && value.status !== "not_used") {
    fail(`${path}.status`, "must be active or not_used");
  }
  assertStrikethrough(value.strikethrough, `${path}.strikethrough`, value, SET_TEXT_FIELDS);

  assertObject(value.location, `${path}.location`);
  assertOnlyKeys(value.location, ["regions"], `${path}.location`);
  if (!Array.isArray(value.location.regions) || !value.location.regions.length) {
    fail(`${path}.location.regions`, "must be a non-empty array");
  }
  value.location.regions.forEach((region, index) =>
    assertRegion(region, `${path}.location.regions[${index}]`, selectedPages),
  );

  if (!Array.isArray(value.components)) fail(`${path}.components`, "must be an array");
  value.components.forEach((component, index) =>
    assertComponent(component, `${path}.components[${index}]`),
  );
  if (value.status === "not_used" && value.components.length) {
    fail(`${path}.components`, "must be empty when status is not_used");
  }
  assertScore(value.confidence, `${path}.confidence`);
}

export function assertResult(value: unknown): asserts value is ExtractionResult {
  assertObject(value, "The file");
  assertOnlyKeys(value, TOP_LEVEL_KEYS, "result");
  assertString(value.source_file, "source_file");

  if (!Array.isArray(value.selected_pages) || !value.selected_pages.length) {
    fail("selected_pages", "must be a non-empty array");
  }
  value.selected_pages.forEach((page, index) =>
    assertPositiveInteger(page, `selected_pages[${index}]`),
  );
  if (new Set(value.selected_pages).size !== value.selected_pages.length) {
    fail("selected_pages", "must not contain duplicates");
  }
  const selectedPages = new Set(value.selected_pages as number[]);

  if (value.backend !== "heuristic" && value.backend !== "openai") {
    fail("backend", "must be heuristic or openai");
  }
  if (!OUTCOMES.includes(value.outcome as Outcome)) {
    fail("outcome", "must be extracted, no_hardware_sets, or needs_review");
  }
  if (!Array.isArray(value.sets)) fail("sets", "must be an array");
  value.sets.forEach((set, index) => assertHardwareSet(set, `sets[${index}]`, selectedPages));
  if (!Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === "string")) {
    fail("warnings", "must be an array of strings");
  }

  if (value.outcome === "extracted" && !value.sets.length) {
    fail("outcome=extracted", "requires at least one hardware set");
  }
  if (value.outcome === "no_hardware_sets" && value.sets.length) {
    fail("outcome=no_hardware_sets", "requires an empty sets array");
  }
  if (value.outcome === "needs_review" && !value.warnings.length) {
    fail("outcome=needs_review", "requires at least one actionable warning");
  }
  if (
    value.outcome === "extracted" &&
    (value.sets as HardwareSet[]).some(
      (hardwareSet) => hardwareSet.status === "active" && !hardwareSet.components.length,
    )
  ) {
    fail("outcome=extracted", "cannot contain an active set without components");
  }
}

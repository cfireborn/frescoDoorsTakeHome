import type {
  Component,
  ComponentTextField,
  ExtractionResult,
  HardwareSet,
  Region,
  TextRange,
} from "./result-schema";

const SET_NUMBER =
  String.raw`(?:[A-Z]{1,4}(?:[ .-]\d+[A-Z]?)+|\d+[A-Z]?(?:[.-][A-Z0-9]+)*|[A-Z]+\d+[A-Z]?)`;
const LABELED_SET_HEADER = new RegExp(
  String.raw`^\s*(?:(?:HW|HARDWARE)\s+)?(?:SET|HEADING|GROUP)(?:\s+(?:NO\.?|NUMBER))?\s*#?\s*[:.-]?\s*(${SET_NUMBER})(?:\s*(?:[-\u2013\u2014:]|\s{2,})\s*(.*?)|\s+(\(?\s*(?:NOT\s+USED|N\s*\/?\s*A|CONT(?:INUED|'?D|\.))\s*\)?))?(?:\s+\[[^\]]+\])?\s*$`,
  "i",
);
const DIRECT_HW_SET_HEADER = new RegExp(
  String.raw`^\s*HW\s+(${SET_NUMBER})(?:\s+(.*?))?(?:\s+\[[^\]]+\])?\s*$`,
  "i",
);
const SET_CELL = new RegExp(
  String.raw`^\s*(?:(?:HW|HARDWARE)\s+)?(?:SET|HEADING|GROUP)?(?:\s+(?:NO\.?|NUMBER))?\s*#?\s*[:.-]?\s*(${SET_NUMBER})\s*$`,
  "i",
);
const NOT_USED = /\bNOT\s+USED\b|^\s*N\s*\/?\s*A\s*[.!]?\s*$/i;
const MOVED_SET = /\bMOVED\s+TO\b.*\bSET\b/i;
const STATUS_ONLY = /^\s*(?:NOT\s+USED|N\s*\/?\s*A)\s*[.!]?\s*$/i;
const LOOKUP_HEADING =
  /\b(?:(?:SPEC|CATALOG|HARDWARE|COMPONENT)\s+CODE|CODE\s+LEGEND|LOOKUP\s+TABLE|OPTION\s+LIST|FINISH\s+LIST|MANUFACTURER\s+LIST)\b/i;
const LOOKUP_ASSIGNMENT = /^\s*([A-Z][A-Z0-9.-]{0,7})\s*(?:=|:|->)\s*(.+)$/i;
const HARDWARE_TERM =
  /\b(?:accessory|actuator|astragal|bolt|closer|contact|coordinator|core|credential|cylinder|device|door\s+(?:bottom\s+rail|pull|top\s+rail)|exit\s+device|gasket(?:ing)?|hardware|harness|hinges?|holder|intercom|key(?:pad|way|ing)?|kick\s+plate|latch|lock(?:set)?s?|mullion|operator|panic|sfics?|button|drip|pivot|plate|power\s+supply|pull|push|reader|rod|seal(?:ant)?|silencers?|stop|strike|sweep|switch|threshold|transfer|trim|weatherstripp?ing|wiring)\b/i;
const SCHEDULE_PROSE =
  /^(?:HDR\s+PROJECT\b|REFER\s+TO\s+(?:DIVISION|SECTION)\b|OPERATIONAL\s+DESCRIPTION\b|MODE\s+OF\s+OPERATION\b|DOORS?\s+(?:ARE|IS)\b|CARD\s+READER\s+OR\s+KEYPAD\b|PROVIDE\s+EACH\b|REPLACE\b|ADD\b|RE-USE\b|ENSURE\b)/i;
const IGNORED_LINE =
  /(?:\bDOOR\s+HARDWARE\s+SCHEDULE\b|^(?:PAGE\s+\d+(?:\s+OF\s+\d+)?|DOOR\s+HARDWARE\b|HARDWARE\s+SETS?|SECTION\s+08|END\s+OF\s+SECTION|EACH\s+TO\s+HAVE\s*:?|PROVIDE\s+EACH\b|FOR\s+USE\s+ON\s+DOOR\b|DOORS?\s*:)|\bEND\s+(?:OF\s+)?SECTION\s+08\s*71\s*00\b)/i;

const AMBIGUOUS_CODES = new Set(["NO", "PE"]);
const MANUFACTURER_CODES = new Set([
  "AD",
  "ABH",
  "BES",
  "BEST",
  "BE",
  "BRN",
  "C-R",
  "CMND",
  "CON",
  "DE",
  "EDW",
  "GLY",
  "GLYNN-JOHNSON",
  "GS",
  "HAG",
  "HA",
  "IVE",
  "IVES",
  "LCN",
  "MC",
  "MED1",
  "MK",
  "MCKINNEY",
  "NO",
  "NORTON",
  "NGP",
  "PE",
  "PEMKO",
  "PRE",
  "RCI",
  "RO",
  "RU",
  "SA",
  "SCE",
  "SCH",
  "SCHLAGE",
  "VD",
  "VON",
  "ZER",
]);
const FINISH_CODES = new Set([
  "26D",
  "26",
  "32D",
  "313",
  "626",
  "628",
  "630",
  "606",
  "612",
  "613",
  "622",
  "639",
  "691",
  "695",
  "711",
  "780",
  "689",
  "BSP",
  "BLACK",
  "BLK",
  "BLU",
  "BK",
  "C26D",
  "C28",
  "C32D",
  "PE",
  "AL",
  "ALM",
  "ANCL",
  "CLR",
  "GREY",
  "GRAY",
  "LGR",
  "LS",
  "MIL",
  "WHT",
  "US10B",
  "10BE",
  "US15",
  "US26D",
  "US28",
  "US32D",
]);

export type BrowserWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  is_struck?: boolean;
};

export type BrowserLine = {
  page: number;
  number: number;
  text: string;
  words: BrowserWord[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
  gapBefore?: number;
};

export type BrowserTextPage = {
  page: number;
  lines: BrowserLine[];
};

type ColumnField =
  | "set_number"
  | "qty"
  | "description"
  | "catalog_number"
  | "mfr"
  | "finish"
  | "notes"
  | "lookup_code";
type Column = { field: ColumnField; x: number };
type Schema = {
  columns: Column[];
  lookup: boolean;
  combinedManufacturerProduct: boolean;
};
type CodeRole = { x: number; role: "mfr" | "finish" };
type LookupEntry = { component: Component; y: number };
type Lookup = Map<string, LookupEntry[]>;
type SetStatus = HardwareSet["status"];

type SchedulePageEvidence = {
  page: number;
  strong: boolean;
  continuation: boolean;
  scheduleHeading: boolean;
  relevantSection: boolean;
  externalScheduleReference: boolean;
  externalScheduleSection: boolean;
};

type SetBuilder = {
  number: string;
  description: string | null;
  status: SetStatus;
  strikethrough: NonNullable<HardwareSet["strikethrough"]>;
  regions: Map<number, BrowserLine[]>;
  components: Component[];
};

type PdfViewport = {
  width: number;
  height: number;
  convertToViewportRectangle(rect: number[]): number[];
};
type PdfPage = {
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getAnnotations?: () => Promise<unknown[]>;
  cleanup?: () => void;
};
type PdfOps = {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
};
type SourceMark = { x0: number; y0: number; x1: number; y1: number };
type TransformMatrix = [number, number, number, number, number, number];

/** Parse a one-based selection such as "3-6,9". */
export function parsePageSelection(pageSpec: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error("PDF has no pages.");
  const normalized = pageSpec.trim().toLowerCase();
  if (!normalized) throw new Error("Enter one or more pages, for example 12-18.");

  let pages: number[];
  if (normalized === "all") {
    pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  } else {
    const selected = new Set<number>();
    for (const segment of normalized.split(",")) {
      const part = segment.trim();
      if (!part) throw new Error(`Invalid page selection: ${pageSpec}.`);
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (end < start) throw new Error(`Descending page range: ${part}.`);
        if (start < 1 || end > pageCount) {
          throw new Error(`Page numbers must be between 1 and ${pageCount}: ${part}.`);
        }
        for (let page = start; page <= end; page += 1) selected.add(page);
      } else if (/^\d+$/.test(part)) {
        const page = Number(part);
        if (page < 1 || page > pageCount) {
          throw new Error(`Page numbers must be between 1 and ${pageCount}: ${part}.`);
        }
        selected.add(page);
      } else {
        throw new Error(`Invalid page range segment: ${part}.`);
      }
    }
    pages = [...selected].sort((left, right) => left - right);
  }

  const invalid = pages.filter((page) => page < 1 || page > pageCount);
  if (invalid.length) {
    throw new Error(`Page numbers must be between 1 and ${pageCount}: ${invalid.join(", ")}.`);
  }
  return pages;
}

/** A blank optional override means the browser should discover schedule pages automatically. */
export function parseOptionalPageSelection(
  pageSpec: string,
  pageCount: number,
): number[] | null {
  return pageSpec.trim() ? parsePageSelection(pageSpec, pageCount) : null;
}

/** Find schedule pages from text and layout evidence without relying on a fixed page range. */
export function discoverHardwareSchedulePages(pages: BrowserTextPage[]): number[] {
  return schedulePagesFromEvidence(pages.map(scheduleEvidenceForPage));
}

export function classifyUndiscoveredSchedule(
  pages: BrowserTextPage[],
): Pick<ExtractionResult, "outcome" | "warnings"> {
  const evidence = pages.map(scheduleEvidenceForPage);
  const totalLines = pages.reduce((sum, page) => sum + page.lines.length, 0);
  const totalCharacters = pages.reduce(
    (sum, page) => sum + page.lines.reduce((pageSum, line) => pageSum + line.text.length, 0),
    0,
  );
  return classifyUndiscoveredEvidence(evidence, totalLines, totalCharacters);
}

function scheduleEvidenceForPage(page: BrowserTextPage): SchedulePageEvidence {
  const text = page.lines.map((line) => cleanText(line.text)).join("\n");
  const scheduleHeading = page.lines.some((line) =>
    /^(?:(?:\d+(?:\.\d+)*)\s+)?(?:DOOR\s+)?HARDWARE\s+(?:SET\s+)?SCHEDULE(?:\s*[-:]\s*CONT(?:INUED|'?D|\.))?\s*$/i.test(
      cleanText(line.text),
    )
  );
  const relevantSection =
    /\b(?:DIVISION\s+0?8|OPENINGS|DOOR\s+HARDWARE|SECTION\s+0?8(?:\s|[-.]?\d{2}))/i.test(text);
  const externalScheduleReference =
    /\bREFER\w*\b.{0,100}\b(?:08\s*06\s*71|080671)\b/i.test(text);
  const explicitExternalScheduleSection = page.lines.some((line) =>
    /^\s*SECTION\s+(?:08\s*06\s*71|080671)\b/i.test(cleanText(line.text))
  );
  const exactExternalScheduleCode = page.lines.some((line) =>
    /^\s*(?:08\s*06\s*71|080671)\s*$/i.test(cleanText(line.text))
  );
  const externalScheduleCodeHeading = page.lines.some((line) =>
    /^\s*(?:08\s*06\s*71|080671)\b/i.test(cleanText(line.text))
  );
  let tableHeader = false;
  let explicitSets = 0;
  let tableSets = 0;
  let componentLines = 0;
  let finishValues = 0;
  let structuredRows = 0;
  let anchoredListRows = 0;
  let activeSchema: Schema | null = null;

  for (const line of page.lines) {
    const cleaned = cleanText(line.text);
    const schema = schemaFromHeader(line);
    if (schema) {
      activeSchema = schema;
      const fields = new Set(schema.columns.map((column) => column.field));
      tableHeader ||=
        fields.has("set_number") &&
        (fields.has("description") || fields.has("catalog_number")) &&
        (fields.has("qty") || fields.has("mfr") || fields.has("finish"));
      continue;
    }

    if (parseSetHeader(cleaned)) {
      explicitSets += 1;
      continue;
    }
    if (activeSchema && parseSetCell(cellsFromLine(activeSchema, line).set_number)) {
      tableSets += 1;
    }
    if (HARDWARE_TERM.test(cleaned)) componentLines += 1;
    if (looksLikeStructuredContinuationRow(line)) structuredRows += 1;
    if (looksLikeFinishIndependentListRow(line)) anchoredListRows += 1;
    finishValues += line.words.filter((word) => isFinishCode(normalizeCode(word.text))).length;
  }

  const rowEvidence = tableSets >= 1 && componentLines >= 2 && finishValues >= 2;
  const strong =
    (scheduleHeading && tableHeader) ||
    explicitSets >= 2 ||
    (explicitSets >= 1 && NOT_USED.test(text)) ||
    (explicitSets >= 1 && anchoredListRows >= 2) ||
    (explicitSets >= 1 && componentLines >= 1 && finishValues >= 1) ||
    (explicitSets >= 1 && componentLines >= 2 && finishValues >= 1) ||
    (tableHeader && (tableSets >= 1 || componentLines >= 2)) ||
    (tableSets >= 2 && componentLines >= 3 && finishValues >= 2);
  const continuation =
    strong ||
    explicitSets >= 1 ||
    rowEvidence ||
    structuredRows >= 2 ||
    (componentLines >= 5 && finishValues >= 3);
  const externalScheduleSection =
    explicitExternalScheduleSection ||
    exactExternalScheduleCode ||
    (externalScheduleCodeHeading && (tableHeader || explicitSets > 0 || tableSets > 0));

  return {
    page: page.page,
    strong,
    continuation,
    scheduleHeading,
    relevantSection,
    externalScheduleReference,
    externalScheduleSection,
  };
}

function looksLikeFinishIndependentListRow(line: BrowserLine) {
  const text = cleanText(line.text);
  if (!/^\d+(?:\.\d+)?(?:\s+(?:EA(?:-R)?\.?|EACH|LOT|PAIR|PR\.?|SET\.?))?\s+/i.test(text)) {
    return false;
  }
  if (!HARDWARE_TERM.test(text)) return false;
  const values = line.words.slice(1).map((word) => normalizeCode(word.text));
  const hasManufacturer = values.some(
    (value) => MANUFACTURER_CODES.has(value) && !AMBIGUOUS_CODES.has(value),
  );
  const hasCatalog = values.some(
    (value) => /[A-Z]/.test(value) && /\d/.test(value) && value.length >= 3,
  );
  return hasManufacturer || hasCatalog;
}

function looksLikeStructuredContinuationRow(line: BrowserLine) {
  const words = line.words.map((word) => normalizeCode(word.text));
  const first = words[0] ?? "";
  const hasQuantity = /^\d+(?:\.\d+)?$/.test(first);
  if (!hasQuantity || !HARDWARE_TERM.test(line.text)) return false;
  const hasManufacturer = words.some(
    (word) => MANUFACTURER_CODES.has(word) && !AMBIGUOUS_CODES.has(word),
  );
  const hasFinish = words.some(
    (word) => isFinishCode(word) && !AMBIGUOUS_CODES.has(word),
  );
  return hasManufacturer && hasFinish;
}

function schedulePagesFromEvidence(evidence: SchedulePageEvidence[]): number[] {
  const ordered = [...evidence].sort((left, right) => left.page - right.page);
  const selected = new Set(ordered.filter((page) => page.strong).map((page) => page.page));
  if (!selected.size) return [];

  // Include dense adjacent continuation pages even when a repeated table heading is absent.
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of ordered) {
      if (
        !page.continuation ||
        selected.has(page.page) ||
        (!selected.has(page.page - 1) && !selected.has(page.page + 1))
      ) {
        continue;
      }
      selected.add(page.page);
      changed = true;
    }
  }
  return [...selected].sort((left, right) => left - right);
}

function classifyUndiscoveredEvidence(
  evidence: SchedulePageEvidence[],
  totalLines: number,
  totalCharacters: number,
): Pick<ExtractionResult, "outcome" | "warnings"> {
  const unreadable = totalLines < 3 || totalCharacters < 30;
  const scheduleUnrecognized = evidence.some((page) => page.scheduleHeading);
  const externalScheduleMissing =
    evidence.some((page) => page.externalScheduleReference) &&
    !evidence.some((page) => page.externalScheduleSection);
  const relevantSectionFound = evidence.some((page) => page.relevantSection);
  return {
    outcome:
      unreadable || scheduleUnrecognized || externalScheduleMissing
        ? "needs_review"
        : "no_hardware_sets",
    warnings: [
      unreadable
        ? "The PDF contains too little extractable text for browser parsing. It may be image-only; OCR is not available in the hosted workflow."
        : externalScheduleMissing
          ? "The document refers to Section 08 06 71 for its hardware schedule, but that schedule was not present in the PDF."
          : scheduleUnrecognized
            ? "A hardware schedule heading was found, but its rows could not be recognized reliably."
            : relevantSectionFound
              ? "Division 08/Openings content was found, but no hardware set schedule could be identified."
              : "No Division 08/Openings section or hardware set schedule was found in the document.",
    ],
  };
}

function compactPageSelection(pages: number[]): string {
  if (!pages.length) return "none";
  const ranges: string[] = [];
  let start = pages[0];
  let end = start;
  for (const page of pages.slice(1)) {
    if (page === end + 1) {
      end = page;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = page;
    end = page;
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(", ");
}

/**
 * Extract selected text-PDF pages entirely in the browser. No file bytes or parsed text are sent
 * to a server. Scanned/image-only pages deliberately return needs_review rather than guessing.
 */
export async function extractPdfLocally(
  file: File,
  pageSpec = "",
  progress?: (message: string) => void,
): Promise<ExtractionResult> {
  const pdfjs = await import("pdfjs-dist/webpack.mjs");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const document = await loadingTask.promise;
  try {
    const manualPages = parseOptionalPageSelection(pageSpec, document.numPages);
    let selectedPages = manualPages;
    const scannedCandidates = new Map<number, BrowserTextPage>();
    let externalScheduleReferenceFound = false;
    let externalScheduleSectionFound = false;

    if (!selectedPages) {
      const evidence: SchedulePageEvidence[] = [];
      let totalLines = 0;
      let totalCharacters = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        progress?.(`Finding hardware schedule pages (${pageNumber} of ${document.numPages})...`);
        const pdfPage = await document.getPage(pageNumber);
        let page: BrowserTextPage;
        try {
          page = await textPageFromPdf(pdfPage, pageNumber);
        } finally {
          pdfPage.cleanup?.();
        }
        const pageEvidence = scheduleEvidenceForPage(page);
        evidence.push(pageEvidence);
        externalScheduleReferenceFound ||= pageEvidence.externalScheduleReference;
        externalScheduleSectionFound ||= pageEvidence.externalScheduleSection;
        if (pageEvidence.strong || pageEvidence.continuation) {
          scannedCandidates.set(pageNumber, page);
        }
        totalLines += page.lines.length;
        totalCharacters += page.lines.reduce((sum, line) => sum + line.text.length, 0);
      }
      selectedPages = schedulePagesFromEvidence(evidence);

      if (!selectedPages.length) {
        const selectedPagesScanned = Array.from(
          { length: document.numPages },
          (_value, index) => index + 1,
        );
        const classification = classifyUndiscoveredEvidence(
          evidence,
          totalLines,
          totalCharacters,
        );
        return {
          source_file: file.name || "document.pdf",
          selected_pages: selectedPagesScanned,
          backend: "heuristic",
          outcome: classification.outcome,
          sets: [],
          warnings: classification.warnings,
        };
      }
      progress?.(
        `Found likely hardware schedule pages: ${compactPageSelection(selectedPages)}.`,
      );
    }

    const pages: BrowserTextPage[] = [];
    for (let index = 0; index < selectedPages.length; index += 1) {
      const pageNumber = selectedPages[index];
      const scanned = scannedCandidates.get(pageNumber);
      progress?.(
        `Reading source formatting on PDF page ${pageNumber} (${index + 1} of ${selectedPages.length})...`,
      );
      const pdfPage = await document.getPage(pageNumber);
      try {
        const page = scanned ?? await textPageFromPdf(pdfPage, pageNumber);
        const marks = await sourceMarksFromPdf(pdfPage, pdfjs.OPS as PdfOps);
        pages.push(applySourceMarks(page, marks));
      } finally {
        pdfPage.cleanup?.();
      }
    }
    progress?.("Extracting hardware sets locally...");
    return extractTextPages(
      pages,
      file.name || "document.pdf",
      document.numPages,
      {
        externalScheduleMissing:
          externalScheduleReferenceFound && !externalScheduleSectionFound,
      },
    );
  } finally {
    await document.destroy();
  }
}

/** Read only the PDF page count. The file remains in browser memory and is never uploaded. */
export async function inspectPdf(file: File): Promise<{ pageCount: number }> {
  const pdfjs = await import("pdfjs-dist/webpack.mjs");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const document = await loadingTask.promise;
  try {
    return { pageCount: document.numPages };
  } finally {
    await document.destroy();
  }
}

/** Pure extraction surface used by unit tests and by the PDF.js adapter above. */
export function extractTextPages(
  pages: BrowserTextPage[],
  sourceFile = "document.pdf",
  documentPageCount = pages.at(-1)?.page ?? 1,
  fullDocumentEvidence: { externalScheduleMissing?: boolean } = {},
): ExtractionResult {
  const orderedPages = [...pages].sort((left, right) => left.page - right.page);
  if (!orderedPages.length) throw new Error("At least one selected page is required.");

  const selectedPages = orderedPages.map((page) => page.page);

  const builders: SetBuilder[] = [];
  const warnings: string[] = [];
  const unresolvedCodes = new Set<string>();
  let current: SetBuilder | null = null;
  let carriedSchema: Schema | null = null;
  let previousPage: number | null = null;
  let orphanEvidence = 0;
  const orphanPages = new Set<number>();
  let pendingDescription: SetBuilder | null = null;
  let pendingNote: { builder: SetBuilder; componentIndex: number } | null = null;

  for (const page of orderedPages) {
    pendingDescription = null;
    pendingNote = null;
    let inDoorList = false;
    let inNarrative = false;
    const adjacent = previousPage === null || page.page === previousPage + 1;
    if (!adjacent) {
      current = null;
      carriedSchema = null;
    }
    const crossedPage = previousPage !== null && previousPage !== page.page;
    let pageBreakPending = crossedPage && current !== null;
    let continuationEvidence = Boolean(
      pageBreakPending &&
        current &&
        (!current.components.length || builderReachesPageEnd(current, previousPage)),
    );
    const roles = codeRolesForPage(page);
    const { lookup, skipLines } = collectLookups(page, roles);
    let schema = carriedSchema;

    for (const line of page.lines) {
      const text = cleanText(line.text);
      if (!text || skipLines.has(line.number) || line.bbox.y0 >= 0.9) continue;

      const schemaCells = schema ? cellsFromLine(schema, line) : {};
      const parsedHeader = parseSetHeader(text);
      const explicit =
        parsedHeader &&
        !(
          schema &&
          parseSetCell(schemaCells.set_number) &&
          cellsHaveComponent(schemaCells, true)
        )
          ? parsedHeader
          : null;
      if (explicit) {
        inDoorList = false;
        inNarrative = false;
        pendingNote = null;
        const rawDescription = explicit.description;
        // Redirected headings contain no local component rows, so keep them as inactive sets.
        const status =
          rawDescription && (NOT_USED.test(rawDescription) || MOVED_SET.test(rawDescription))
            ? "not_used"
            : "active";
        const description = status === "not_used" ? descriptionWithoutStatus(rawDescription) : rawDescription;
        current = openSet(
          builders,
          current,
          explicit.number,
          description,
          status,
          line,
          "explicit",
        );
        pendingDescription = !rawDescription && status === "active" ? current : null;
        schema = null;
        carriedSchema = null;
        pageBreakPending = false;
        continue;
      }

      const detectedSchema = schemaFromHeader(line);
      if (detectedSchema) {
        inDoorList = false;
        inNarrative = false;
        pendingDescription = null;
        schema = detectedSchema;
        carriedSchema = detectedSchema;
        continuationEvidence = true;
        continue;
      }
      if (/^FOR\s+USE\s+ON\s+DOORS?\b/i.test(text)) {
        inDoorList = true;
        continue;
      }
      if (/^PROVIDE\s+EACH\b/i.test(text)) {
        inDoorList = false;
        inNarrative = false;
        continue;
      }
      if (/^(?:MODE\s+OF\s+OPERATION|OPERATIONAL\s+DESCRIPTION|DOORS?\s+(?:ARE|IS)\b)/i.test(text)) {
        inNarrative = true;
        continue;
      }
      if (inDoorList || looksLikePageFurniture(line)) continue;
      const beginsComponent = /^\d+(?:\.\d+)?\s+/.test(text) || quantity(schemaCells.qty) !== null;
      if (inNarrative && !beginsComponent) continue;
      if (beginsComponent) inNarrative = false;
      if (IGNORED_LINE.test(text) || LOOKUP_HEADING.test(text)) {
        pendingDescription = null;
        continue;
      }

      const cells = schema ? schemaCells : {};
      const tableNumber = parseSetCell(cells.set_number);
      if (tableNumber) {
        pendingNote = null;
        const statusMarked = cellsMarkNotUsed(cells);
        const hasComponent = cellsHaveComponent(cells, true);
        const rowDescription = hasComponent ? null : cleanValue(cells.description);
        current = openSet(
          builders,
          current,
          tableNumber,
          statusMarked ? descriptionWithoutStatus(rowDescription) : rowDescription,
          statusMarked ? "not_used" : "active",
          line,
          "table",
        );
        pageBreakPending = false;
        pendingDescription = null;
        if (statusMarked || !hasComponent) continue;
      }

      const setDescription = tableNumber ? null : tableDescriptionFragment(cells.set_number);
      if (current && setDescription) {
        current.description = joinDescriptionFragments(current.description, setDescription);
        addLine(current, line);
      }

      if (!current) {
        if (looksLikeComponent(line, cells, roles)) {
          orphanEvidence += 1;
          orphanPages.add(page.page);
        }
        continue;
      }
      if (pageBreakPending && !continuationEvidence) {
        if (looksLikeComponent(line, cells, roles)) {
          orphanEvidence += 1;
          orphanPages.add(page.page);
        }
        continue;
      }

      const statusMarked = STATUS_ONLY.test(text) || cellsMarkNotUsed(cells);
      if (statusMarked && !current.components.length) {
        addLine(current, line);
        current.status = "not_used";
        current.components = [];
        current.description = descriptionWithoutStatus(current.description);
        pendingDescription = null;
        pageBreakPending = false;
        continue;
      }
      if (statusMarked) continue;

      if (/^NOTE\s*:/i.test(text)) {
        const note = cleanValue(text.replace(/^NOTE\s*:\s*/i, ""));
        if (note) {
          const matchIndex = findComponentForNote(
            current.components,
            note,
            /\b(?:removed|deleted|omitted?)\b/i.test(note),
          );
          if (matchIndex >= 0) {
            current.components[matchIndex] = appendComponentNote(
              current.components[matchIndex],
              note,
              line,
            );
            addLine(current, line);
            pendingNote = { builder: current, componentIndex: matchIndex };
          }
        }
        continue;
      }

      if (
        pendingNote?.builder === current &&
        line.gapBefore !== undefined &&
        line.gapBefore <= 0.02 &&
        isNoteContinuation(cells)
      ) {
        const note = cleanValue(text);
        if (note) {
          const matchedIndex = findComponentForNote(current.components, note, false);
          const index = matchedIndex >= 0 ? matchedIndex : pendingNote.componentIndex;
          current.components[index] = appendComponentNote(current.components[index], note, line);
          addLine(current, line);
          pendingNote = { builder: current, componentIndex: index };
          continue;
        }
      }
      pendingNote = null;

      if (pendingDescription === current) {
        pendingDescription = null;
        if (!looksLikeComponent(line, cells, roles)) {
          current.description = cleanValue(text);
          addLine(current, line);
          continue;
        }
      }

      if (
        schema &&
        current.components.length &&
        isCombinedTableContinuation(cells, schema)
      ) {
        addLine(current, line);
        const lastIndex = current.components.length - 1;
        current.components[lastIndex] = mergeCombinedTableContinuation(
          current.components[lastIndex],
          cells,
          line,
          schema,
        );
        pageBreakPending = false;
        continue;
      }

      if (
        schema &&
        current.components.length &&
        isTableTextContinuation(cells, line)
      ) {
        addLine(current, line);
        const lastIndex = current.components.length - 1;
        current.components[lastIndex] = mergeTableTextContinuation(
          current.components[lastIndex],
          cells,
          line,
          schema,
        );
        pageBreakPending = false;
        continue;
      }

      const component = schema
        ? componentFromCells(
            normalizedComponentCells(cells, schema),
            line,
            roles,
            lookup,
            unresolvedCodes,
            {
              mfr: !schema.columns.some((column) => column.field === "mfr"),
              finish: !schema.columns.some((column) => column.field === "finish"),
            },
            schema,
          )
        : componentFromLine(line, roles, lookup, unresolvedCodes);
      if (component && current.status !== "not_used") {
        addLine(current, line);
        current.components.push(component);
        pageBreakPending = false;
      }
    }
    previousPage = page.page;
  }

  if (orphanEvidence > 0) {
    warnings.push(
      `${orphanEvidence} component-like schedule row(s) on page(s) ${[...orphanPages].join(", ")} had no recoverable hardware set identifier.`,
    );
  }
  if (unresolvedCodes.size) {
    warnings.push(
      `Unresolved spec/catalog code(s) preserved without expansion: ${[...unresolvedCodes].join(", ")}. Review the same-page lookup table.`,
    );
  }

  const emptyActive = builders.filter(
    (builder) => builder.status === "active" && !builder.components.length,
  );
  if (emptyActive.length) {
    warnings.push(`Active sets with no parsed components: ${emptyActive.map((set) => set.number).join(", ")}.`);
  }

  const text = orderedPages.flatMap((page) => page.lines.map((line) => line.text)).join(" ");
  const tooLittleText = orderedPages.reduce((total, page) => total + page.lines.length, 0) < 3 || text.trim().length < 30;
  const externalScheduleMissing =
    typeof fullDocumentEvidence.externalScheduleMissing === "boolean"
      ? fullDocumentEvidence.externalScheduleMissing
      : /\bREFER\w*\b.{0,100}\b(?:08\s*06\s*71|080671)\b/i.test(text);
  if (externalScheduleMissing) {
    warnings.push("The selected section refers to an external hardware schedule that is not present.");
  }

  const finalPage = orderedPages.at(-1);
  const lastBuilder = builders.at(-1);
  const selectionMayTruncate = Boolean(
    finalPage &&
      lastBuilder &&
      lastBuilder.status === "active" &&
      builderReachesSelectionEdge(lastBuilder, finalPage.page) &&
      finalPage.page < documentPageCount &&
      !finalPage.lines.some((line) => /END\s+OF\s+SECTION/i.test(line.text)),
  );
  if (selectionMayTruncate) {
    warnings.push("The final set reaches the selected-page boundary and may continue on the next page.");
  }

  let outcome: ExtractionResult["outcome"];
  if (!builders.length) {
    if (tooLittleText) {
      outcome = "needs_review";
      warnings.push(
        "The selected pages contain too little extractable text. They may be image-only; OCR is not available in the hosted workflow.",
      );
    } else if (orphanEvidence > 0 || externalScheduleMissing) {
      outcome = "needs_review";
    } else {
      outcome = "no_hardware_sets";
      warnings.push("No hardware set identifiers were found on the selected pages.");
    }
  } else if (
    emptyActive.length ||
    orphanEvidence > 0 ||
    externalScheduleMissing ||
    selectionMayTruncate
  ) {
    outcome = "needs_review";
  } else {
    outcome = "extracted";
  }

  return {
    source_file: sourceFile,
    selected_pages: selectedPages,
    backend: "heuristic",
    outcome,
    sets: builders.map(buildSet),
    warnings,
  };
}

async function textPageFromPdf(pdfPage: PdfPage, pageNumber: number): Promise<BrowserTextPage> {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const content = await pdfPage.getTextContent();
  const words: BrowserWord[] = [];

  for (const rawItem of content.items) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    if (
      typeof item.str !== "string" ||
      !Array.isArray(item.transform) ||
      item.transform.length < 6 ||
      typeof item.width !== "number" ||
      typeof item.height !== "number"
    ) {
      continue;
    }
    const transform = item.transform as number[];
    const x = transform[4];
    const baseline = transform[5];
    const height = Math.max(item.height, Math.hypot(transform[2], transform[3]), 1);
    const rectangle = viewport.convertToViewportRectangle([
      x,
      baseline - height * 0.22,
      x + Math.max(item.width, 0.5),
      baseline + height * 0.82,
    ]);
    const itemBox = normalizedBox(rectangle, viewport.width, viewport.height);
    const matches = [...item.str.matchAll(/\S+/g)];
    const characterCount = Math.max(item.str.length, 1);
    for (const match of matches) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      words.push({
        text: match[0],
        x0: itemBox.x0 + ((itemBox.x1 - itemBox.x0) * start) / characterCount,
        x1: itemBox.x0 + ((itemBox.x1 - itemBox.x0) * end) / characterCount,
        y0: itemBox.y0,
        y1: itemBox.y1,
      });
    }
  }

  return { page: pageNumber, lines: linesFromWords(words, pageNumber) };
}

export async function sourceMarksFromPdf(
  pdfPage: PdfPage,
  ops: PdfOps,
): Promise<SourceMark[]> {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const [operatorList, annotations] = await Promise.all([
    pdfPage.getOperatorList(),
    pdfPage.getAnnotations?.() ?? Promise.resolve([]),
  ]);
  const paintOperators = new Set([
    ops.stroke,
    ops.closeStroke,
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ]);
  const flattenedMarks: Array<SourceMark & { paint: number }> = [];
  let transform: TransformMatrix = [1, 0, 0, 1, 0, 0];
  const transformStack: TransformMatrix[] = [];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];
    if (operation === ops.save) {
      transformStack.push([...transform]);
      continue;
    }
    if (operation === ops.restore) {
      transform = transformStack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (operation === ops.transform) {
      const values = numericValues(args);
      if (values?.length === 6) transform = multiplyTransforms(transform, values);
      continue;
    }
    if (operation !== ops.constructPath) continue;
    if (!Array.isArray(args) || !paintOperators.has(Number(args[0]))) continue;
    const bounds = numericRectangle(args[2]);
    if (!bounds) continue;
    const mark = normalizedBox(
      viewport.convertToViewportRectangle(transformRectangle(bounds, transform)),
      viewport.width,
      viewport.height,
    );
    const width = mark.x1 - mark.x0;
    const height = mark.y1 - mark.y0;
    if (
      width >= 0.003 &&
      height <= 0.003 &&
      width / Math.max(height, 0.0001) >= 4
    ) {
      flattenedMarks.push({ ...mark, paint: Number(args[0]) });
    }
  }
  const marks: SourceMark[] = flattenedMarks
    .filter((mark) => !isRepeatedTableRule(mark, flattenedMarks, ops.fill))
    .map((mark) => ({ x0: mark.x0, y0: mark.y0, x1: mark.x1, y1: mark.y1 }));
  for (const rawAnnotation of annotations) {
    if (!rawAnnotation || typeof rawAnnotation !== "object") continue;
    const annotation = rawAnnotation as Record<string, unknown>;
    if (String(annotation.subtype).toLowerCase() !== "strikeout") continue;
    const quadPoints = numericValues(annotation.quadPoints);
    const rectangles = quadPoints?.length && quadPoints.length % 8 === 0
      ? Array.from({ length: quadPoints.length / 8 }, (_value, index) => {
          const quad = quadPoints.slice(index * 8, index * 8 + 8);
          return [
            Math.min(quad[0], quad[2], quad[4], quad[6]),
            Math.min(quad[1], quad[3], quad[5], quad[7]),
            Math.max(quad[0], quad[2], quad[4], quad[6]),
            Math.max(quad[1], quad[3], quad[5], quad[7]),
          ];
        })
      : [numericRectangle(annotation.rect)].filter((rectangle): rectangle is number[] => Boolean(rectangle));
    for (const rectangle of rectangles) {
      marks.push(normalizedBox(
        viewport.convertToViewportRectangle(rectangle),
        viewport.width,
        viewport.height,
      ));
    }
  }
  return marks;
}

function isRepeatedTableRule(
  mark: SourceMark & { paint: number },
  marks: Array<SourceMark & { paint: number }>,
  fillOperator: number,
) {
  if (mark.paint !== fillOperator || mark.x1 - mark.x0 < 0.7) return false;
  return marks.filter(
    (candidate) =>
      candidate.paint === fillOperator &&
      candidate.x1 - candidate.x0 >= 0.7 &&
      Math.abs(candidate.x0 - mark.x0) <= 0.02 &&
      Math.abs(candidate.x1 - mark.x1) <= 0.02,
  ).length >= 3;
}

function multiplyTransforms(left: TransformMatrix, right: number[]): TransformMatrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformRectangle(bounds: number[], transform: TransformMatrix): number[] {
  const points = [
    transformPoint(transform, bounds[0], bounds[1]),
    transformPoint(transform, bounds[0], bounds[3]),
    transformPoint(transform, bounds[2], bounds[1]),
    transformPoint(transform, bounds[2], bounds[3]),
  ];
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y)),
  ];
}

function transformPoint(
  transform: TransformMatrix,
  x: number,
  y: number,
): [number, number] {
  return [
    transform[0] * x + transform[2] * y + transform[4],
    transform[1] * x + transform[3] * y + transform[5],
  ];
}

function numericRectangle(value: unknown): number[] | null {
  const values = numericValues(value);
  return values?.length === 4 ? values : null;
}

function numericValues(value: unknown): number[] | null {
  if (!value || typeof value !== "object" || !("length" in value)) return null;
  const values = Array.from(value as ArrayLike<unknown>);
  if (values.some((item) => typeof item !== "number" || !Number.isFinite(item))) return null;
  return values as number[];
}

/** Apply flattened PDF midline marks while rejecting borders and ordinary underlines. */
export function applySourceMarks(page: BrowserTextPage, marks: SourceMark[]): BrowserTextPage {
  if (!marks.length) return page;
  const lines = page.lines.map((line) => ({
    ...line,
    words: line.words.map((word) => ({
      ...word,
      is_struck: marks.some((mark) => markStrikesWord(mark, word)),
    })),
  }));
  return { ...page, lines };
}

function markStrikesWord(mark: SourceMark, word: BrowserWord) {
  const wordHeight = word.y1 - word.y0;
  const markCenter = (mark.y0 + mark.y1) / 2;
  if (markCenter < word.y0 + wordHeight * 0.25 || markCenter > word.y0 + wordHeight * 0.78) {
    return false;
  }
  const overlap = Math.max(0, Math.min(word.x1, mark.x1) - Math.max(word.x0, mark.x0));
  return overlap >= Math.max(0.002, (word.x1 - word.x0) * 0.6);
}

function normalizedBox(rectangle: number[], width: number, height: number) {
  const xs = [rectangle[0], rectangle[2]].map((value) => clamp(value / width));
  const ys = [rectangle[1], rectangle[3]].map((value) => clamp(value / height));
  const [x0, x1] = positiveRange(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = positiveRange(Math.min(...ys), Math.max(...ys));
  return {
    x0,
    y0,
    x1,
    y1,
  };
}

function linesFromWords(input: BrowserWord[], page: number): BrowserLine[] {
  const groups: BrowserWord[][] = [];
  const ordered = [...input].sort(
    (left, right) => (left.y0 + left.y1) / 2 - (right.y0 + right.y1) / 2 || left.x0 - right.x0,
  );
  for (const word of ordered) {
    const center = (word.y0 + word.y1) / 2;
    let best: BrowserWord[] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      const groupCenter = group.reduce((sum, item) => sum + (item.y0 + item.y1) / 2, 0) / group.length;
      const tolerance = Math.max(0.006, (word.y1 - word.y0) * 0.55);
      const distance = Math.abs(center - groupCenter);
      if (distance <= tolerance && distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    }
    (best ?? groups[groups.push([]) - 1]).push(word);
  }

  const lines = groups
    .map((group) => {
      const words = group.sort((left, right) => left.x0 - right.x0);
      let text = "";
      for (let index = 0; index < words.length; index += 1) {
        if (index) text += words[index].x0 - words[index - 1].x1 >= 0.018 ? "  " : " ";
        text += words[index].text;
      }
      return {
        page,
        number: 0,
        text,
        words,
        bbox: unionWordBoxes(words),
      } satisfies BrowserLine;
    })
    .sort((left, right) => left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0);

  return lines.map((line, index) => ({
    ...line,
    number: index + 1,
    gapBefore: index ? Math.max(0, line.bbox.y0 - lines[index - 1].bbox.y1) : 0,
  }));
}

function schemaFromHeader(line: BrowserLine): Schema | null {
  const found = new Map<ColumnField, number>();
  const labels = line.words.map((word) => normalizeLabel(word.text));
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const next = labels[index + 1];
    let field: ColumnField | null = null;
    if ((label === "hardware" || label === "hw") && ["set", "group", "heading"].includes(next)) {
      field = "set_number";
      index += 1;
    } else if (["set", "group", "heading"].includes(label)) field = "set_number";
    else if (["qty", "quantity", "q'ty", "qt"].includes(label)) field = "qty";
    else if (["description", "desc", "item", "hardware"].includes(label)) field = "description";
    else if (["catalog", "product", "model", "part"].includes(label)) field = "catalog_number";
    else if (["mfr", "manf", "mfg", "mfgr", "manufacturer", "vendor", "make"].includes(label)) field = "mfr";
    else if (["finish", "fin"].includes(label)) field = "finish";
    else if (["notes", "note", "remarks", "remark", "comments", "comment"].includes(label)) field = "notes";
    else if (label === "code" && !["catalog", "product", "part"].includes(labels[index - 1])) field = "lookup_code";
    if (field && !found.has(field)) found.set(field, line.words[index].x0);
  }
  const structural = [...found.keys()].filter((field) => field !== "description" && field !== "set_number");
  if (found.size < 2 || (!structural.length && found.size < 3)) return null;
  const meaningfulLabels = labels.filter(Boolean);
  if (found.size / Math.max(meaningfulLabels.length, 1) < 0.5) return null;
  const columns = [...found].map(([field, x]) => ({ field, x })).sort((left, right) => left.x - right.x);
  return {
    columns,
    lookup: found.has("lookup_code") && !found.has("set_number"),
    combinedManufacturerProduct: /\bMANUFACTURER\s*[-/]\s*PRODUCT\b/i.test(
      cleanText(line.text),
    ),
  };
}

function cellsFromLine(schema: Schema, line: BrowserLine): Partial<Record<ColumnField, string>> {
  const values = new Map<ColumnField, string[]>();
  for (const column of schema.columns) values.set(column.field, []);
  const boundaries = schema.columns.slice(1).map((column) => column.x - 0.01);
  for (const word of line.words) {
    let index = 0;
    while (index < boundaries.length && word.x0 >= boundaries[index]) index += 1;
    values.get(schema.columns[index].field)?.push(word.text);
  }
  return Object.fromEntries(
    [...values].flatMap(([field, parts]) => (parts.length ? [[field, cleanText(parts.join(" "))]] : [])),
  );
}

const COMBINED_COLUMN_MANUFACTURERS = [
  "GLYNN-JOHNSON",
  "VON DUPRIN",
  "ASSA ABLOY",
  "BLUMCRAFT",
  "ROCKWOOD",
  "SENTRONIC",
  "SCHLAGE",
  "MCKINNEY",
  "NORTON",
  "PEMKO",
  "TRINE",
  "ALUR",
  "IVES",
  "HAGER",
  "BEST",
  "LCN",
  "CRL",
  "NGP",
  "ZERO",
  "RCI",
];

function normalizedComponentCells(
  cells: Partial<Record<ColumnField, string>>,
  schema: Schema,
): Partial<Record<ColumnField, string>> {
  if (!schema.combinedManufacturerProduct) return cells;
  const combined = cleanValue(
    [cells.mfr, cells.catalog_number].filter(Boolean).join(" "),
  );
  const split = splitManufacturerProduct(combined);
  return {
    ...cells,
    mfr: split.mfr ?? undefined,
    catalog_number: split.catalog ?? undefined,
  };
}

function splitManufacturerProduct(value: string | null) {
  if (!value) return { mfr: null, catalog: null };
  const separated = /^(.+?)\s+-\s+(.+)$/.exec(value);
  if (separated) {
    return { mfr: cleanValue(separated[1]), catalog: cleanValue(separated[2]) };
  }
  const upper = value.toUpperCase();
  const known = COMBINED_COLUMN_MANUFACTURERS.find(
    (manufacturer) =>
      upper === manufacturer ||
      upper.startsWith(`${manufacturer} `) ||
      upper.startsWith(`${manufacturer}-`),
  );
  if (known) {
    return {
      mfr: known,
      catalog: cleanValue(
        value.slice(known.length).replace(/^\s*-\s*/, ""),
      ),
    };
  }
  return { mfr: null, catalog: value };
}

function isCombinedTableContinuation(
  cells: Partial<Record<ColumnField, string>>,
  schema: Schema,
) {
  if (
    !schema.combinedManufacturerProduct ||
    parseSetCell(cells.set_number) ||
    hasTableQuantityAnchor(cells.qty)
  ) {
    return false;
  }
  const content = [
    cells.description,
    cells.mfr,
    cells.catalog_number,
    cells.finish,
    cells.notes,
  ].filter(Boolean);
  if (!content.length) return false;
  const hasHardwareType = Boolean(cleanValue(cells.description));
  const hasManufacturerProduct = Boolean(
    cleanValue([cells.mfr, cells.catalog_number].filter(Boolean).join(" ")),
  );
  const coordinationContinuation = Boolean(
    cleanText(cells.description ?? "").toUpperCase() === "MORTISE LOCKSET" &&
      cleanValue([cells.mfr, cells.catalog_number].filter(Boolean).join(" "))?.startsWith("("),
  );
  if (
    hasHardwareType &&
    hasManufacturerProduct &&
    HARDWARE_TERM.test(cleanText(cells.description ?? "")) &&
    !coordinationContinuation
  ) {
    return false;
  }
  return !cells.finish;
}

function hasTableQuantityAnchor(value: string | undefined) {
  const cleaned = cleanValue(value);
  return Boolean(
    quantity(value) !== null ||
      (cleaned && /^(?:--?|[\u2013\u2014]|N\s*\/?\s*A|NONE)$/i.test(cleaned)),
  );
}

function mergeCombinedTableContinuation(
  component: Component,
  cells: Partial<Record<ColumnField, string>>,
  line: BrowserLine,
  schema: Schema,
): Component {
  const productFragment = cleanValue(
    [cells.mfr, cells.catalog_number].filter(Boolean).join(" "),
  );
  return appendComponentFragments(
    component,
    {
      description: cleanValue(cells.description),
      catalog_number: productFragment,
      notes: cleanValue(cells.notes),
    },
    line,
    schema,
  );
}

function isTableTextContinuation(
  cells: Partial<Record<ColumnField, string>>,
  line: BrowserLine,
) {
  if (
    parseSetCell(cells.set_number) ||
    hasTableQuantityAnchor(cells.qty) ||
    cells.mfr ||
    cells.finish ||
    cells.notes ||
    cells.lookup_code ||
    (line.gapBefore ?? Number.POSITIVE_INFINITY) > 0.025
  ) {
    return false;
  }
  const fragment = cleanValue([cells.description, cells.catalog_number].filter(Boolean).join(" "));
  return Boolean(fragment && fragment.length >= 4 && !HARDWARE_TERM.test(fragment));
}

function mergeTableTextContinuation(
  component: Component,
  cells: Partial<Record<ColumnField, string>>,
  line: BrowserLine,
  schema: Schema,
) {
  return appendComponentFragments(
    component,
    {
      description: cleanValue(cells.description),
      catalog_number: cleanValue(cells.catalog_number),
    },
    line,
    schema,
  );
}

function appendComponentFragments(
  component: Component,
  fragments: Partial<Record<ComponentTextField, string | null>>,
  line: BrowserLine,
  schema: Schema,
): Component {
  const updates: Partial<Record<ComponentTextField, string | null>> = {};
  const offsets = new Map<ComponentTextField, number>();
  for (const [field, fragment] of Object.entries(fragments) as Array<[
    ComponentTextField,
    string | null,
  ]>) {
    if (!fragment) continue;
    const previous = component[field];
    const joined = joinFragments(previous, fragment);
    if (joined === previous) continue;
    updates[field] = joined;
    offsets.set(field, previous ? previous.length + 1 : 0);
  }
  if (!Object.keys(updates).length) return component;

  const fragmentRanges = strikethroughForFields(fragments, line, schema);
  const strikethrough = { ...component.strikethrough };
  for (const [field, ranges] of Object.entries(fragmentRanges) as Array<[
    ComponentTextField,
    TextRange[],
  ]>) {
    const value = updates[field] ?? component[field];
    if (!value) continue;
    const offset = offsets.get(field) ?? 0;
    strikethrough[field] = mergeTextRanges(value, [
      ...(strikethrough[field] ?? []),
      ...ranges.map((range) => ({ start: range.start + offset, end: range.end + offset })),
    ]);
  }

  const merged = { ...component, ...updates };
  return {
    ...merged,
    ...(Object.keys(strikethrough).length ? { strikethrough } : {}),
    confidence: {
      ...component.confidence,
      ...Object.fromEntries(Object.keys(updates).map((field) => [
        field,
        Math.min(
          component.confidence[field] ?? 0.82,
          field === "description" ? 0.86 : field === "catalog_number" ? 0.84 : 0.82,
        ),
      ])),
    },
  };
}

function joinFragments(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  if (left.toUpperCase().endsWith(right.toUpperCase())) return left;
  return cleanValue(`${left} ${right}`);
}

function tableDescriptionFragment(value: string | undefined) {
  const fragment = cleanValue(value);
  if (!fragment || parseSetCell(fragment) || STATUS_ONLY.test(fragment)) return null;
  return fragment;
}

function joinDescriptionFragments(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  const normalizedLeft = left.toUpperCase();
  const normalizedRight = right.toUpperCase();
  if (normalizedLeft === normalizedRight || normalizedLeft.endsWith(` / ${normalizedRight}`)) {
    return left;
  }
  return cleanValue(`${left} / ${right}`);
}

function collectLookups(page: BrowserTextPage, roles: CodeRole[]) {
  const lookup: Lookup = new Map();
  const skipLines = new Set<number>();
  let lookupSchema: Schema | null = null;
  let lookupContext = false;
  for (const line of page.lines) {
    const text = cleanText(line.text);
    if (parseSetHeader(text)) {
      lookupSchema = null;
      lookupContext = false;
      continue;
    }
    const assignment = LOOKUP_ASSIGNMENT.exec(text);
    if (
      assignment &&
      lookupContext &&
      !/^(?:SET|NOTE|DOORS?|DESCRIPTION|QUANTITY)$/i.test(assignment[1])
    ) {
      addLookup(
        lookup,
        normalizeCode(assignment[1]),
        componentFromLookupBody(assignment[2]),
        line,
      );
      skipLines.add(line.number);
      continue;
    }
    const schema = schemaFromHeader(line);
    if (schema) {
      lookupSchema = schema.lookup ? schema : null;
      lookupContext = schema.lookup;
      if (schema.lookup) skipLines.add(line.number);
      continue;
    }
    if (LOOKUP_HEADING.test(text)) {
      lookupContext = true;
      skipLines.add(line.number);
      continue;
    }
    if (!lookupSchema) continue;
    const cells = cellsFromLine(lookupSchema, line);
    const code = cleanValue(cells.lookup_code);
    if (!code || !/^[A-Z][A-Z0-9.-]{0,7}$/i.test(code)) continue;
    const definitionCells = { ...cells };
    delete definitionCells.lookup_code;
    const component = componentFromCells(
      definitionCells,
      line,
      roles,
      new Map(),
      new Set(),
      { mfr: true, finish: true },
      lookupSchema,
    );
    if (component) {
      addLookup(lookup, normalizeCode(code), component, line);
      skipLines.add(line.number);
    }
  }
  return { lookup, skipLines };
}

function componentFromLookupBody(body: string): Component {
  const chunks = body.split(/\s*\|\s*|\s{2,}/).map(cleanText).filter(Boolean);
  if (chunks.length >= 2) {
    const mfr = cleanValue(chunks[2]);
    const finish = cleanValue(chunks[3]);
    return makeComponent(null, chunks[0], chunks[1], mfr, finish, "Resolved from same-page code table", 0.9);
  }
  const tokens = body.split(/\s+/).filter(Boolean);
  const { mfr, finish, remaining } = takeTrailingCodes(tokens);
  const split = descriptionCatalogSplit(remaining);
  return makeComponent(null, split.description, split.catalog, mfr, finish, "Resolved from same-page code table", 0.82);
}

function componentFromCells(
  cells: Partial<Record<ColumnField, string>>,
  line: BrowserLine,
  roles: CodeRole[],
  lookup: Lookup,
  unresolvedCodes: Set<string>,
  inferMissing: { mfr: boolean; finish: boolean } = { mfr: true, finish: true },
  schema?: Schema,
): Component | null {
  const qty = quantity(cells.qty);
  let description = cleanValue(cells.description);
  let catalog = cleanValue(cells.catalog_number);
  let mfr = cleanValue(cells.mfr);
  let finish = cleanValue(cells.finish);
  let notes = cleanValue(cells.notes);
  const lookupCode = cleanValue(cells.lookup_code);

  if (lookupCode) {
    const resolved = nearestLookup(lookup, lookupCode, line);
    if (resolved) {
      description ||= resolved.description;
      catalog ||= resolved.catalog_number;
      mfr ||= resolved.mfr;
      finish ||= resolved.finish;
      notes = joinNotes(notes, `Resolved spec code ${lookupCode}`);
    } else {
      catalog ||= lookupCode;
      notes = joinNotes(notes, `Unresolved spec code ${lookupCode}`);
      unresolvedCodes.add(lookupCode);
    }
  }

  if ((!mfr && inferMissing.mfr) || (!finish && inferMissing.finish)) {
    const inferred = inferCodes(line.words, roles);
    if (inferMissing.mfr) mfr ||= inferred.mfr;
    if (inferMissing.finish) finish ||= inferred.finish;
  }
  if (!description && !catalog && !mfr) return null;
  const evidence = [description, catalog, mfr, finish].filter(Boolean).join(" ");
  if (qty === null && !HARDWARE_TERM.test(evidence) && !catalog && !mfr && !finish) return null;
  return withComponentStrikethrough(
    makeComponent(qty, description, catalog, mfr, finish, notes, 0.93),
    line,
    schema,
  );
}

function componentFromLine(
  line: BrowserLine,
  roles: CodeRole[],
  lookup: Lookup,
  unresolvedCodes: Set<string>,
): Component | null {
  const tokens = line.words.map((word) => word.text);
  if (!tokens.length) return null;
  let qty: string | null = null;
  let start = 0;
  if (/^\d+(?:\.\d+)?$/.test(tokens[0]) && Number(tokens[0]) <= 100) {
    qty = tokens[0];
    start = 1;
    if (/^(?:EA(?:-R)?\.?|EACH|LOT|PAIR|PR\.?|SET\.?)$/i.test(tokens[start] ?? "")) start += 1;
  }
  const bodyWords = line.words.slice(start);
  const bodyTokens = bodyWords.map((word) => word.text);
  if (!bodyTokens.length) return null;
  if (SCHEDULE_PROSE.test(bodyTokens.join(" "))) return null;

  if (bodyTokens.length === 1) {
    const resolved = nearestLookup(lookup, bodyTokens[0], line);
    if (resolved) {
      const component = {
        ...resolved,
        qty,
        notes: joinNotes(resolved.notes, `Resolved spec code ${bodyTokens[0]}`),
        confidence: { ...resolved.confidence, qty: qty ? 0.96 : null },
      };
      return withComponentStrikethrough(component, line);
    }
  }
  if (bodyTokens.length === 1 && /^[A-Z][A-Z0-9.-]{0,7}$/i.test(bodyTokens[0])) {
    unresolvedCodes.add(bodyTokens[0]);
    return withComponentStrikethrough(
      makeComponent(
        qty,
        null,
        bodyTokens[0],
        null,
        null,
        `Unresolved spec code ${bodyTokens[0]}`,
        0.45,
      ),
      line,
    );
  }

  const inferred = inferCodes(bodyWords, roles);
  const remaining = bodyTokens.filter((_token, index) => !inferred.consumed.has(index));
  const split = descriptionCatalogSplit(remaining);
  const evidence = [split.description, split.catalog, inferred.mfr, inferred.finish].filter(Boolean).join(" ");
  if (!HARDWARE_TERM.test(evidence)) return null;

  if (!split.description && remaining.length === 1 && /^[A-Z][A-Z0-9.-]{0,7}$/i.test(remaining[0])) {
    unresolvedCodes.add(remaining[0]);
  }
  return withComponentStrikethrough(
    makeComponent(qty, split.description, split.catalog, inferred.mfr, inferred.finish, null, 0.74),
    line,
  );
}

function addLookup(lookup: Lookup, code: string, component: Component, line: BrowserLine) {
  const entries = lookup.get(code) ?? [];
  entries.push({ component, y: line.bbox.y0 });
  lookup.set(code, entries);
}

function nearestLookup(lookup: Lookup, code: string, line: BrowserLine) {
  const entries = lookup.get(normalizeCode(code));
  if (!entries?.length) return null;
  return entries.reduce((nearest, candidate) =>
    Math.abs(candidate.y - line.bbox.y0) < Math.abs(nearest.y - line.bbox.y0)
      ? candidate
      : nearest
  ).component;
}

function descriptionCatalogSplit(tokens: string[]) {
  if (!tokens.length) return { description: null, catalog: null };
  if (looksLikeLeadingCatalogToken(tokens[0]) && HARDWARE_TERM.test(tokens.slice(1).join(" "))) {
    return {
      description: cleanValue(tokens.slice(1).join(" ")),
      catalog: cleanValue(tokens[0]),
    };
  }
  for (let split = 1; split < tokens.length; split += 1) {
    const description = tokens.slice(0, split).join(" ");
    if (HARDWARE_TERM.test(description) && looksLikeCatalogToken(tokens[split])) {
      return { description, catalog: cleanValue(tokens.slice(split).join(" ")) };
    }
  }
  return {
    description: HARDWARE_TERM.test(tokens.join(" ")) ? cleanValue(tokens.join(" ")) : null,
    catalog: HARDWARE_TERM.test(tokens.join(" ")) ? null : cleanValue(tokens.join(" ")),
  };
}

function inferCodes(words: BrowserWord[], roles: CodeRole[]) {
  let mfr: string | null = null;
  let finish: string | null = null;
  const consumed = new Set<number>();
  const firstCandidate = Math.max(0, words.length - 4);
  for (let index = firstCandidate; index < words.length; index += 1) {
    const code = normalizeCode(words[index].text);
    if (AMBIGUOUS_CODES.has(code)) {
      const nearby = nearestRole(words[index].x0, roles);
      if (nearby?.role === "mfr") mfr = code;
      else if (nearby?.role === "finish") finish = code;
      else continue;
      consumed.add(index);
    } else if (MANUFACTURER_CODES.has(code)) {
      mfr = code;
      consumed.add(index);
    } else if (isFinishCode(code)) {
      const nearby = nearestRole(words[index].x0, roles);
      if (isStrongFinishCode(code) || nearby?.role === "finish") {
        finish = code;
        consumed.add(index);
      }
    }
  }
  return { mfr, finish, consumed };
}

function takeTrailingCodes(tokens: string[]) {
  let mfr: string | null = null;
  let finish: string | null = null;
  const remaining: string[] = [];
  for (const [index, token] of tokens.entries()) {
    const code = normalizeCode(token);
    const trailing = index >= Math.max(0, tokens.length - 4);
    if (trailing && MANUFACTURER_CODES.has(code) && !AMBIGUOUS_CODES.has(code)) mfr = code;
    else if (trailing && isStrongFinishCode(code) && !AMBIGUOUS_CODES.has(code)) finish = code;
    else remaining.push(token);
  }
  return { mfr, finish, remaining };
}

function codeRolesForPage(page: BrowserTextPage): CodeRole[] {
  const headers: CodeRole[] = [];
  const columns: Array<{ x: number; values: string[] }> = [];
  for (const line of page.lines) {
    if (parseSetHeader(line.text)) continue;
    for (const word of line.words) {
      const label = normalizeLabel(word.text);
      if (["mfr", "manf", "mfg", "mfgr", "manufacturer", "vendor", "make"].includes(label)) {
        headers.push({ x: word.x0, role: "mfr" });
      }
      else if (["finish", "fin"].includes(label)) headers.push({ x: word.x0, role: "finish" });

      const value = normalizeCode(word.text);
      if (!MANUFACTURER_CODES.has(value) && !isFinishCode(value)) continue;
      let column = columns.find((candidate) => Math.abs(candidate.x - word.x0) <= 0.025);
      if (!column) {
        column = { x: word.x0, values: [] };
        columns.push(column);
      }
      column.values.push(value);
    }
  }
  const roles: CodeRole[] = [];
  for (const column of columns) {
    const header = nearestRole(column.x, headers, 0.055);
    if (header) {
      roles.push({ x: column.x, role: header.role });
      continue;
    }
    const manufacturerScore = column.values.filter(
      (value) => MANUFACTURER_CODES.has(value) && !AMBIGUOUS_CODES.has(value),
    ).length;
    const finishScore = column.values.filter(
      (value) => isStrongFinishCode(value) && !AMBIGUOUS_CODES.has(value),
    ).length;
    if (
      manufacturerScore >= 1 &&
      column.values.length >= 2 &&
      manufacturerScore > finishScore
    ) {
      roles.push({ x: column.x, role: "mfr" });
    } else if (
      finishScore >= 1 &&
      column.values.length >= 2 &&
      finishScore > manufacturerScore
    ) {
      roles.push({ x: column.x, role: "finish" });
    }
  }
  return roles;
}

function nearestRole(x: number, roles: CodeRole[], maximumDistance = 0.04) {
  const nearest = roles.reduce<CodeRole | null>(
    (best, candidate) =>
      !best || Math.abs(candidate.x - x) < Math.abs(best.x - x) ? candidate : best,
    null,
  );
  return nearest && Math.abs(nearest.x - x) <= maximumDistance ? nearest : null;
}

function looksLikeComponent(
  line: BrowserLine,
  cells: Partial<Record<ColumnField, string>>,
  roles: CodeRole[],
) {
  if (
    cells.description &&
    (cells.catalog_number || cells.mfr || cells.finish || cells.lookup_code)
  ) {
    return true;
  }
  const text = cleanText(line.text);
  if (!HARDWARE_TERM.test(text)) return false;
  return /^\d+(?:\.\d+)?\s+/.test(text) || Boolean(inferCodes(line.words, roles).mfr || inferCodes(line.words, roles).finish);
}

function cellsHaveComponent(
  cells: Partial<Record<ColumnField, string>>,
  rowStartsSet = false,
) {
  const structural = Boolean(
    cells.qty ||
      cells.catalog_number ||
      cells.mfr ||
      cells.finish ||
      cells.notes ||
      cells.lookup_code,
  );
  if (rowStartsSet && !structural) return false;
  return Boolean(
    structural ||
      (cells.description && !STATUS_ONLY.test(cells.description)),
  );
}

function cellsMarkNotUsed(cells: Partial<Record<ColumnField, string>>) {
  const componentValues = Object.entries(cells).filter(
    ([field, value]) => field !== "set_number" && value && !STATUS_ONLY.test(value),
  );
  return componentValues.length === 0 && Object.values(cells).some((value) => value && STATUS_ONLY.test(value));
}

function openSet(
  builders: SetBuilder[],
  current: SetBuilder | null,
  number: string,
  description: string | null,
  status: SetStatus,
  line: BrowserLine,
  headingKind: "explicit" | "table",
) {
  const strikethrough = strikethroughForFields(
    { set_number: number, description },
    line,
  ) as NonNullable<HardwareSet["strikethrough"]>;
  if (
    current?.number === number &&
    sameOccurrence(
      current,
      description,
      line,
      Boolean(Object.keys(strikethrough).length),
      headingKind,
    )
  ) {
    current.description ||= description;
    const continuationStrikethrough = strikethroughForFields(
      { set_number: number, description: current.description },
      line,
    ) as NonNullable<HardwareSet["strikethrough"]>;
    for (const field of ["set_number", "description"] as const) {
      const value = field === "set_number" ? current.number : current.description;
      if (!value) continue;
      const ranges = [
        ...(current.strikethrough[field] ?? []),
        ...(continuationStrikethrough[field] ?? []),
      ];
      if (ranges.length) current.strikethrough[field] = mergeTextRanges(value, ranges);
    }
    if (status === "not_used") {
      current.status = status;
      current.components = [];
    }
    addLine(current, line);
    return current;
  }
  const created: SetBuilder = {
    number,
    description,
    status,
    strikethrough,
    regions: new Map(),
    components: [],
  };
  addLine(created, line);
  builders.push(created);
  return created;
}

function sameOccurrence(
  current: SetBuilder,
  description: string | null,
  line: BrowserLine,
  nextIsStruck: boolean,
  headingKind: "explicit" | "table",
) {
  const lastPage = Math.max(...current.regions.keys());
  if (Boolean(Object.keys(current.strikethrough).length) !== nextIsStruck) return false;
  const priorDescription = baseDescription(current.description);
  const nextDescription = baseDescription(description);
  if (priorDescription && nextDescription && priorDescription !== nextDescription) return false;
  if (line.page === lastPage) {
    if (headingKind === "table") {
      return !(current.components.length && (line.gapBefore ?? 0) >= 0.02);
    }
    if (current.components.length || current.status === "not_used") return false;
    const priorLines = current.regions.get(lastPage) ?? [];
    const priorBottom = Math.max(...priorLines.map((candidate) => candidate.bbox.y1));
    return line.bbox.y0 - priorBottom <= 0.03;
  }
  if (line.page !== lastPage + 1 || line.bbox.y0 > 0.22) return false;
  return /\bCONT(?:INUED|'?D|\.)\)?\s*$/i.test(description ?? "") ||
    !current.components.length ||
    builderReachesPageEnd(current, lastPage);
}

function addLine(builder: SetBuilder, line: BrowserLine) {
  const lines = builder.regions.get(line.page) ?? [];
  if (!lines.some((candidate) => candidate.number === line.number)) lines.push(line);
  builder.regions.set(line.page, lines);
}

function buildSet(builder: SetBuilder): HardwareSet {
  const regions: Region[] = [...builder.regions]
    .sort(([left], [right]) => left - right)
    .map(([page, lines]) => ({
      page,
      bbox: {
        x0: Math.min(...lines.map((line) => line.bbox.x0)),
        y0: Math.min(...lines.map((line) => line.bbox.y0)),
        x1: Math.max(...lines.map((line) => line.bbox.x1)),
        y1: Math.max(...lines.map((line) => line.bbox.y1)),
      },
      line_start: Math.min(...lines.map((line) => line.number)),
      line_end: Math.max(...lines.map((line) => line.number)),
    }));
  const scores = builder.components.flatMap((component) =>
    Object.values(component.confidence).filter((score): score is number => typeof score === "number"),
  );
  const confidence =
    builder.status === "not_used"
      ? 0.98
      : scores.length
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 1000) / 1000
        : 0.25;
  return {
    set_number: builder.number,
    description: builder.description,
    status: builder.status,
    ...(Object.keys(builder.strikethrough).length
      ? { strikethrough: builder.strikethrough }
      : {}),
    location: { regions },
    components: builder.status === "not_used" ? [] : builder.components,
    confidence,
  };
}

function makeComponent(
  qty: string | null,
  description: string | null,
  catalog: string | null,
  mfr: string | null,
  finish: string | null,
  notes: string | null,
  score: number,
): Component {
  return {
    qty,
    description,
    catalog_number: catalog,
    mfr,
    finish,
    notes,
    confidence: {
      qty: qty === null ? null : Math.min(0.96, score + 0.03),
      description: description === null ? null : score,
      catalog_number: catalog === null ? null : Math.max(0, score - 0.02),
      mfr: mfr === null ? null : score,
      finish: finish === null ? null : score,
      notes: notes === null ? null : Math.max(0, score - 0.08),
    },
  };
}

function withComponentStrikethrough(
  component: Component,
  line: BrowserLine,
  schema?: Schema,
): Component {
  const strikethrough = strikethroughForComponent(component, line, schema);
  return Object.keys(strikethrough).length ? { ...component, strikethrough } : component;
}

function strikethroughForComponent(
  component: Component,
  line: BrowserLine,
  schema?: Schema,
): NonNullable<Component["strikethrough"]> {
  return strikethroughForFields(
    {
      qty: component.qty,
      description: component.description,
      catalog_number: component.catalog_number,
      mfr: component.mfr,
      finish: component.finish,
      notes: component.notes,
    },
    line,
    schema,
  ) as NonNullable<Component["strikethrough"]>;
}

function strikethroughForFields(
  values: Record<string, string | null>,
  line: BrowserLine,
  schema?: Schema,
): Record<string, TextRange[]> {
  const ranges = new Map<string, TextRange[]>();
  const fields = Object.keys(values).filter((field) => typeof values[field] === "string");
  for (const word of line.words.filter((candidate) => candidate.is_struck)) {
    const preferred = schema ? outputFieldsForColumn(columnForWord(schema, word)) : [];
    const candidates = [...new Set([...preferred, ...fields])].filter((field) => fields.includes(field));
    for (const field of candidates) {
      const value = values[field];
      if (!value) continue;
      const used = ranges.get(field) ?? [];
      const sourceWords = sourceWordsForField(field, values, line, schema);
      const sourceIndex = sourceWords.indexOf(word);
      const orderedRange = sourceIndex >= 0
        ? findSourceOrderedWordRange(value, sourceWords, sourceIndex)
        : null;
      const range = orderedRange && !used.some(
        (candidate) => orderedRange.start < candidate.end && orderedRange.end > candidate.start,
      )
        ? orderedRange
        : findUnusedWordRange(value, word.text, used);
      if (!range) continue;
      ranges.set(field, [...(ranges.get(field) ?? []), range]);
      break;
    }
  }
  return Object.fromEntries(
    [...ranges].flatMap(([field, fieldRanges]) => {
      const value = values[field];
      if (!value) return [];
      return [[field, mergeTextRanges(value, fieldRanges)]];
    }),
  );
}

function sourceWordsForField(
  field: string,
  values: Record<string, string | null>,
  line: BrowserLine,
  schema?: Schema,
) {
  if (schema) {
    const columnWords = line.words.filter((word) =>
      outputFieldsForColumn(columnForWord(schema, word)).includes(field)
    );
    if (columnWords.length) return columnWords;
  }
  if (field === "description" && values.set_number) {
    const normalizedNumber = normalizeSetNumber(values.set_number);
    const numberIndex = line.words.findIndex(
      (word) => normalizeSetNumber(normalizeCode(word.text)) === normalizedNumber,
    );
    if (numberIndex >= 0) return line.words.slice(numberIndex + 1);
  }
  return line.words;
}

function findSourceOrderedWordRange(
  value: string,
  sourceWords: BrowserWord[],
  targetIndex: number,
): TextRange | null {
  let cursor = 0;
  for (let index = 0; index <= targetIndex; index += 1) {
    const range = findWordRangeAtOrAfter(value, sourceWords[index].text, cursor);
    if (!range) continue;
    if (index === targetIndex) return range;
    cursor = range.end;
  }
  return null;
}

function findWordRangeAtOrAfter(
  value: string,
  sourceWord: string,
  minimumStart: number,
): TextRange | null {
  const variants = [sourceWord, sourceWord.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const lowerValue = value.toLowerCase();
  for (const variant of variants) {
    const lowerWord = variant.toLowerCase();
    let start = lowerValue.indexOf(lowerWord, minimumStart);
    while (start >= 0) {
      const end = start + variant.length;
      const alphanumeric = /^[A-Za-z0-9]+$/.test(variant);
      const bounded = !alphanumeric || (
        (start === 0 || !/[A-Za-z0-9]/.test(value[start - 1])) &&
        (end === value.length || !/[A-Za-z0-9]/.test(value[end]))
      );
      if (bounded) return { start, end };
      start = lowerValue.indexOf(lowerWord, start + 1);
    }
  }
  return null;
}

function columnForWord(schema: Schema, word: BrowserWord): ColumnField | null {
  if (!schema.columns.length) return null;
  let index = 0;
  while (
    index + 1 < schema.columns.length &&
    word.x0 >= schema.columns[index + 1].x - 0.01
  ) {
    index += 1;
  }
  return schema.columns[index]?.field ?? null;
}

function outputFieldsForColumn(field: ColumnField | null): string[] {
  if (field === "lookup_code") return ["catalog_number"];
  if (field === "set_number") return [];
  if (field === "qty" || field === "description" || field === "catalog_number" ||
      field === "mfr" || field === "finish" || field === "notes") {
    return field === "mfr" ? ["mfr", "catalog_number"] : [field];
  }
  return [];
}

function findUnusedWordRange(
  value: string,
  sourceWord: string,
  used: TextRange[],
): TextRange | null {
  const variants = [sourceWord, sourceWord.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")]
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  const lowerValue = value.toLowerCase();
  for (const variant of variants) {
    const lowerWord = variant.toLowerCase();
    let start = lowerValue.indexOf(lowerWord);
    while (start >= 0) {
      const end = start + variant.length;
      const alphanumeric = /^[A-Za-z0-9]+$/.test(variant);
      const bounded = !alphanumeric || (
        (start === 0 || !/[A-Za-z0-9]/.test(value[start - 1])) &&
        (end === value.length || !/[A-Za-z0-9]/.test(value[end]))
      );
      if (bounded && !used.some((range) => start < range.end && end > range.start)) {
        return { start, end };
      }
      start = lowerValue.indexOf(lowerWord, start + 1);
    }
  }
  return null;
}

function mergeTextRanges(value: string, ranges: TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: TextRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && (range.start <= previous.end || !value.slice(previous.end, range.start).trim())) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function findComponentForNote(components: Component[], note: string, preferStruck: boolean) {
  const noteText = note.toLowerCase();
  const hardwareNouns = /\b(?:closer|hinge|lock|cylinder|stop|gasketing|strike|operator|reader|switch|supply|threshold|seal|bolt|device)\b/g;
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component.description) continue;
    const terms = component.description.toLowerCase().match(hardwareNouns) ?? [];
    const matches = new Set(terms.filter((term) => noteText.includes(term))).size;
    const phrases = ["power supply", "card reader", "door position switch", "door closer"];
    const phraseMatches = phrases.filter(
      (phrase) => component.description?.toLowerCase().includes(phrase) && noteText.includes(phrase),
    ).length;
    const score = matches * 2 + phraseMatches * 5 + (preferStruck && component.strikethrough ? 1 : 0);
    if (score >= bestScore && matches > 0) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

function isNoteContinuation(cells: Partial<Record<ColumnField, string>>) {
  return Boolean(
    (cleanValue(cells.description) || cleanValue(cells.notes)) &&
    !quantity(cells.qty) &&
    !cleanValue(cells.catalog_number) &&
    !cleanValue(cells.mfr) &&
    !cleanValue(cells.finish) &&
    !cleanValue(cells.lookup_code),
  );
}

function appendComponentNote(component: Component, note: string, line: BrowserLine): Component {
  const notes = joinNotes(component.notes, note);
  const noteOffset = component.notes ? component.notes.length + 2 : 0;
  const noteRanges = strikethroughForFields({ notes: note }, line).notes ?? [];
  const existingRanges = component.strikethrough?.notes ?? [];
  const strikethrough = {
    ...component.strikethrough,
    ...(noteRanges.length || existingRanges.length
      ? {
          notes: [
            ...existingRanges,
            ...noteRanges.map((range) => ({
              start: range.start + noteOffset,
              end: range.end + noteOffset,
            })),
          ],
        }
      : {}),
  };
  return {
    ...component,
    notes,
    ...(Object.keys(strikethrough).length ? { strikethrough } : {}),
    confidence: { ...component.confidence, notes: 0.96 },
  };
}

function builderReachesPageEnd(builder: SetBuilder, page: number | null) {
  return page !== null && (builder.regions.get(page) ?? []).some((line) => line.bbox.y1 >= 0.78);
}

function builderReachesSelectionEdge(builder: SetBuilder, page: number) {
  return (builder.regions.get(page) ?? []).some((line) => line.bbox.y1 >= 0.88);
}

function parseSetCell(value: string | undefined) {
  if (!value) return null;
  const match = SET_CELL.exec(cleanText(value));
  return match ? normalizeSetNumber(match[1]) : null;
}

function parseSetHeader(value: string) {
  const text = cleanText(value);
  const match = LABELED_SET_HEADER.exec(text) ?? DIRECT_HW_SET_HEADER.exec(text);
  if (!match) return null;
  return {
    number: normalizeSetNumber(match[1]),
    description: cleanValue(match[2] ?? match[3]),
  };
}

function quantity(value: string | undefined) {
  const cleaned = cleanValue(value);
  if (!cleaned || /^(?:--|N\/?A|NONE)$/i.test(cleaned)) return null;
  const match = /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)(?:\s+(?:EA(?:-R)?\.?|EACH|LOT|PAIR|PR\.?|SET\.?))?$/i.exec(cleaned);
  return match ? match[1].replace(/\s/g, "") : null;
}

function descriptionWithoutStatus(value: string | null) {
  if (!value) return null;
  return cleanValue(value.replace(/\bNOT\s+USED\b|\bN\s*\/\s*A\b/gi, "").replace(/^\s*[-:()]|[-:()]\s*$/g, ""));
}

function baseDescription(value: string | null) {
  return cleanText(value ?? "")
    .toUpperCase()
    .replace(/\s*(?:[-:,(]\s*)?CONT(?:INUED|'?D|\.)(?:\s*\))?\s*$/i, "")
    .trim();
}

function normalizeSetNumber(value: string) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeCode(value: string) {
  return value.toUpperCase().trim().replace(/^[.,;:#()[\]]+|[.,;:#()[\]]+$/g, "");
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
}

function isFinishCode(value: string) {
  return FINISH_CODES.has(value) || /^(?:(?:US|C)\d{2,3}[A-Z]?|\d{3}[A-Z]?|\d{2}[A-Z])(?:\/(?:US|C)?\d{2,3}[A-Z]?)*$/.test(value);
}

function isStrongFinishCode(value: string) {
  return FINISH_CODES.has(value) || /^(?:US|C)\d{2,3}[A-Z]?(?:\/(?:US|C)?\d{2,3}[A-Z]?)*$/.test(value);
}

function looksLikeCatalogToken(value: string) {
  const token = normalizeCode(value);
  if (/^[A-Z]+$/.test(token) && HARDWARE_TERM.test(token)) return false;
  return /\d/.test(token) || (/^[A-Z][A-Z0-9./-]{1,}$/.test(token) && token.length >= 3);
}

function looksLikePageFurniture(line: BrowserLine) {
  if (line.bbox.y0 >= 0.12) return false;
  const text = cleanText(line.text);
  const markers = [
    /\bDOOR\s+HARDWARE\b/i,
    /\bSECTION\s+0?8\b/i,
    /\bPAGE\s+\d+\b/i,
  ];
  return markers.filter((pattern) => pattern.test(text)).length >= 2;
}

function looksLikeLeadingCatalogToken(value: string) {
  const token = normalizeCode(value);
  return /\d/.test(token) || /[./-]/.test(token);
}

function cleanText(value: string) {
  return value.replace(/[\ue000-\uf8ff]/g, "").replace(/\s+/g, " ").trim();
}

function cleanValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return cleanText(value).replace(/^\|+|\|+$/g, "").trim() || null;
}

function joinNotes(left: string | null, right: string) {
  return left ? `${left}; ${right}` : right;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function positiveRange(lower: number, upper: number): [number, number] {
  if (upper > lower) return [lower, upper];
  return lower >= 1 ? [0.9999, 1] : [lower, Math.min(1, lower + 0.0001)];
}

function unionWordBoxes(words: BrowserWord[]) {
  return {
    x0: Math.min(...words.map((word) => word.x0)),
    y0: Math.min(...words.map((word) => word.y0)),
    x1: Math.max(...words.map((word) => word.x1)),
    y1: Math.max(...words.map((word) => word.y1)),
  };
}

import type { Component, ExtractionResult, HardwareSet, Outcome } from "./result-schema";

export type ComponentScheduleRow = {
  sourceFile: string;
  outcome: Outcome;
  warnings: string[];
  setOrder: number;
  setNumber: string;
  setDescription: string | null;
  status: HardwareSet["status"];
  setStrikethrough: HardwareSet["strikethrough"];
  setStruckText: string;
  setConfidence: number;
  sourcePages: number[];
  componentOrder: number | null;
  qty: string | null;
  description: string | null;
  catalogNumber: string | null;
  mfr: string | null;
  finish: string | null;
  notes: string | null;
  componentStrikethrough: Component["strikethrough"];
  componentStruckText: string;
  orderHandling: "UNCHANGED" | "REVIEW - PARTIAL SOURCE STRIKE" | "EXCLUDE - FULL SOURCE STRIKE";
  componentConfidence: number | null;
};

const CSV_COLUMNS: Array<{
  label: string;
  value: (row: ComponentScheduleRow) => string;
}> = [
  { label: "Source File", value: (row) => row.sourceFile },
  { label: "Result Outcome", value: (row) => row.outcome },
  { label: "Result Warnings", value: (row) => row.warnings.join(" | ") },
  { label: "Set Order", value: (row) => String(row.setOrder) },
  { label: "Set Number", value: (row) => row.setNumber },
  { label: "Set Description", value: (row) => row.setDescription ?? "" },
  {
    label: "Set Status",
    value: (row) => (row.status === "not_used" ? "NOT USED" : "ACTIVE"),
  },
  { label: "Set Struck Text", value: (row) => row.setStruckText },
  { label: "Set Confidence", value: (row) => String(row.setConfidence) },
  {
    label: "Component Order",
    value: (row) => (row.componentOrder === null ? "" : String(row.componentOrder)),
  },
  { label: "Source Pages", value: (row) => row.sourcePages.join("; ") },
  { label: "Quantity", value: (row) => row.qty ?? "" },
  { label: "Component Description", value: (row) => row.description ?? "" },
  { label: "Catalog Number", value: (row) => row.catalogNumber ?? "" },
  { label: "Manufacturer", value: (row) => row.mfr ?? "" },
  { label: "Finish", value: (row) => row.finish ?? "" },
  { label: "Notes", value: (row) => row.notes ?? "" },
  {
    label: "Component Struck Text",
    value: (row) => row.componentStruckText,
  },
  { label: "Order Handling", value: (row) => row.orderHandling },
  {
    label: "Component Confidence",
    value: (row) => row.componentConfidence?.toString() ?? "",
  },
];

function componentConfidence(component: Component): number | null {
  const values = Object.values(component.confidence ?? {}).filter(
    (value): value is number => typeof value === "number",
  );
  if (!values.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 1000) / 1000;
}

function sourcePages(hardwareSet: HardwareSet): number[] {
  return [...new Set(hardwareSet.location.regions.map((region) => region.page))].sort(
    (left, right) => left - right,
  );
}

export function flattenComponentSchedule(result: ExtractionResult): ComponentScheduleRow[] {
  return result.sets.flatMap((hardwareSet, setIndex) => {
    const common = {
      sourceFile: result.source_file,
      outcome: result.outcome,
      warnings: result.warnings,
      setOrder: setIndex + 1,
      setNumber: hardwareSet.set_number,
      setDescription: hardwareSet.description,
      status: hardwareSet.status,
      setStrikethrough: hardwareSet.strikethrough,
      setStruckText: struckText(hardwareSet, ["set_number", "description"]),
      setConfidence: hardwareSet.confidence,
      sourcePages: sourcePages(hardwareSet),
    };
    if (!hardwareSet.components.length) {
      return [{
        ...common,
        componentOrder: null,
        qty: null,
        description: null,
        catalogNumber: null,
        mfr: null,
        finish: null,
        notes: null,
        componentStrikethrough: undefined,
        componentStruckText: "",
        orderHandling: setSourceDisposition(hardwareSet),
        componentConfidence: null,
      }];
    }
    return hardwareSet.components.map((component, componentIndex) => ({
      ...common,
      componentOrder: componentIndex + 1,
      qty: component.qty,
      description: component.description,
      catalogNumber: component.catalog_number,
      mfr: component.mfr,
      finish: component.finish,
      notes: component.notes,
      componentStrikethrough: component.strikethrough,
      componentStruckText: struckText(component, [
        "qty",
        "description",
        "catalog_number",
        "mfr",
        "finish",
        "notes",
      ]),
      orderHandling: componentSourceDisposition(component, hardwareSet),
      componentConfidence: componentConfidence(component),
    }));
  });
}

export function componentSourceDisposition(
  component: Component,
  hardwareSet?: HardwareSet,
): ComponentScheduleRow["orderHandling"] {
  if (!component.strikethrough || !Object.keys(component.strikethrough).length) {
    return hardwareSet ? setSourceDisposition(hardwareSet) : "UNCHANGED";
  }
  const identityFields = ["description", "catalog_number", "mfr", "finish"] as const;
  const populated = identityFields.filter((field) => component[field]?.trim());
  const fullyStruck = populated.length > 0 && populated.every((field) =>
    fieldIsFullyStruck(component[field], component.strikethrough?.[field]),
  );
  return fullyStruck ? "EXCLUDE - FULL SOURCE STRIKE" : "REVIEW - PARTIAL SOURCE STRIKE";
}

function setSourceDisposition(
  hardwareSet: HardwareSet,
): ComponentScheduleRow["orderHandling"] {
  if (!hardwareSet.strikethrough || !Object.keys(hardwareSet.strikethrough).length) {
    return "UNCHANGED";
  }
  // A struck heading can mark an obsolete set, but is not enough evidence by itself
  // to exclude every child row. Only a full component strike is exported as EXCLUDE.
  return "REVIEW - PARTIAL SOURCE STRIKE";
}

function fieldIsFullyStruck(value: string | null, ranges?: Array<{ start: number; end: number }>) {
  if (!value || !ranges?.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (/\s/.test(value[index])) continue;
    if (!ranges.some((range) => range.start <= index && range.end > index)) return false;
  }
  return true;
}

function struckText(
  source: HardwareSet | Component,
  fields: string[],
): string {
  const strikethrough = source.strikethrough as Record<
    string,
    Array<{ start: number; end: number }> | undefined
  > | undefined;
  if (!strikethrough) return "";
  const values = source as unknown as Record<string, unknown>;
  return fields.flatMap((field) => {
    const value = values[field];
    if (typeof value !== "string") return [];
    return (strikethrough[field] ?? []).map(
      (range) => `${field}: ${value.slice(range.start, range.end)}`,
    );
  }).join(" | ");
}

function csvCell(value: string): string {
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const spreadsheetSafe = /^[\u0000-\u0020]*[=+\-@]/.test(clean) ? `'${clean}` : clean;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

export function buildComponentScheduleCsv(rows: ComponentScheduleRow[]): string {
  return `\uFEFF${[
    CSV_COLUMNS.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(column.value(row))).join(",")),
  ].join("\r\n")}`;
}

export function componentScheduleFilename(sourceFile: string): string {
  const basename = sourceFile.split(/[\\/]/).at(-1) ?? "hardware-sets";
  const stem = basename.replace(/\.pdf$/i, "").trim();
  const safeStem = stem
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 120)
    .replace(/[.-]+$/g, "");
  return `${safeStem || "hardware-sets"}-component-schedule.csv`;
}

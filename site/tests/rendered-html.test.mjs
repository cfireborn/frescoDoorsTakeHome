import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertResult } from "../app/result-schema.ts";
import { reviewWarningVisibility } from "../app/review-visibility.ts";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the extraction review workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Fresco Hardware Set Extractor<\/title>/i);
  assert.match(html, /<h1[^>]*visually-hidden[^>]*>Fresco Hardware Set Extractor<\/h1>/);
  assert.match(html, /hardware sets/);
  assert.match(html, /fresco-logo\.webp/);
  assert.match(html, /Choose PDF/);
  assert.match(html, /Extract hardware sets/);
  assert.match(html, /Advanced: choose pages manually/);
  assert.match(html, /find the schedule automatically/);
  assert.match(html, /Show extraction and partial extraction warnings/);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, /Import JSON/);
  assert.match(html, /Download current JSON/);
  assert.doesNotMatch(html, /Select up to 30 pages/);
  assert.doesNotMatch(html, /Browser-local PDF extraction/);
  assert.doesNotMatch(html, /DIVISION 08 EXTRACTION/);
  assert.doesNotMatch(html, /Upload a spec\. Get/);
  assert.doesNotMatch(html, /No account\. No document upload/);
  assert.doesNotMatch(html, /Already have a result/);
  assert.doesNotMatch(html, /Structured sets are ready for source review/);
  assert.doesNotMatch(html, /Built for the Fresco hardware set coding challenge/);
  assert.doesNotMatch(html, /Every extracted set in one order-friendly table/);
  assert.match(html, /Source regions/);
  assert.match(html, /Component schedule/);
  assert.equal(html.match(/Export table CSV/g)?.length, 2);
  assert.match(html, /Set confidence/);
  assert.match(html, /Component confidence/);
  assert.match(html, /Order handling/);
  assert.match(html, /Component source edit/);
  assert.match(html, /Source PDF not attached/);
  assert.match(html, /No placeholder page is shown/);
  assert.match(html, /roselle-library-door-hardware\.pdf/);
  assert.match(html, /CYLINDER \/ CORE/);
  assert.doesNotMatch(html, />heuristic</);
  assert.doesNotMatch(html, /Your site is taking shape/);
});

test("keeps user PDF processing local and covers required result states", async () => {
  const [workbench, extractor, provenance, schedule, css, hosting, sampleJson, samplePdf] = await Promise.all([
    readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/browser-extractor.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/pdf-provenance.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/component-schedule.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/sample-result.json", import.meta.url), "utf8"),
    readFile(new URL("../public/roselle-library-door-hardware.pdf", import.meta.url)),
  ]);

  assert.match(workbench, /extractPdfLocally/);
  assert.doesNotMatch(workbench, /Enter the one-based pages that contain the hardware schedule/);
  assert.match(workbench, /fetch\(samplePdfPath\)/);
  assert.equal(workbench.match(/\bfetch\s*\(/g)?.length, 1);
  assert.match(extractor, /file\.arrayBuffer\(\)/);
  assert.match(extractor, /getDocument\(\{ data: bytes/);
  assert.match(extractor, /discoverHardwareSchedulePages/);
  assert.doesNotMatch(extractor, /MAX_SELECTED_PAGES/);
  assert.doesNotMatch(extractor, /fetch\s*\(/);
  assert.match(provenance, /getDocument\(\{ data: bytes/);
  assert.match(provenance, /page\.render\(\{ canvas, viewport \}\)/);
  assert.match(provenance, /ResizeObserver/);
  assert.match(provenance, /loadedDocument\.destroy\(\)/);
  assert.doesNotMatch(provenance, /fetch\s*\(/);
  assert.match(workbench, /text\/csv/);
  assert.match(schedule, /buildComponentScheduleCsv/);
  assert.match(schedule, /NOT USED/);
  assert.doesNotMatch(css, /page-preview::before/);
  assert.doesNotMatch(
    css,
    /\.page-canvas-frame\s*\{[^}]*min-height/,
    "The overlay frame must use the rendered page height, including for landscape pages.",
  );
  assert.match(workbench, /no_hardware_sets/);
  assert.match(workbench, /needs_review/);
  assert.match(workbench, /Could not extract reliably/);
  assert.match(workbench, /const \[showReviewWarnings, setShowReviewWarnings\] = useState\(true\)/);
  assert.match(workbench, /onChange=\{\(event\) => setShowReviewWarnings\(event\.target\.checked\)\}/);
  assert.match(workbench, /reviewVisibility\.outcomeCard/);
  assert.match(workbench, /reviewVisibility\.warningBanner/);
  assert.match(workbench, /reviewVisibility\.emptyState/);
  assert.match(workbench, /result\.warnings\.map/);
  assert.doesNotMatch(workbench, /result\.warnings\[0\]/);
  assert.equal(workbench.match(/onClick=\{downloadComponentSchedule\}/g)?.length, 2);
  assert.match(workbench, /className="drop-zone-copy"/);
  assert.match(workbench, /aria-label="Extracted hardware sets"/);
  assert.match(workbench, /tabIndex=\{0\}/);
  assert.match(css, /\.drop-zone-copy\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/);
  assert.match(css, /\.file-label\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/);
  assert.match(css, /\.load-message\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.source-preview-state p\s*\{[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(css, /\.set-panel\s*\{[^}]*display:\s*flex;[^}]*max-height:\s*calc\(100dvh - 32px\);/);
  assert.match(css, /\.set-list\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/);
  assert.match(css, /html\s*\{[^}]*overflow-x:\s*hidden;/);
  assert.match(css, /\.review-grid\s*\{[^}]*grid-template-columns:\s*340px minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.warning-toggle input\s*\{[^}]*height:\s*16px;[^}]*width:\s*16px;/);
  const bundledSample = JSON.parse(sampleJson);
  assert.doesNotThrow(() => assertResult(bundledSample));
  assert.equal(bundledSample.source_file, "roselle-library-door-hardware.pdf");
  assert.deepEqual(bundledSample.selected_pages, [15, 16, 17]);
  assert.equal(bundledSample.sets.length, 33);
  assert.ok(bundledSample.sets.every((set) => set.description));
  assert.equal(
    bundledSample.sets.flatMap((set) => set.components).filter((component) => component.mfr === "BE").length,
    0,
  );
  assert.equal(
    bundledSample.sets.at(-1).components.at(-1).catalog_number,
    "SILENCER SI6X",
  );
  assert.ok(
    bundledSample.sets.every((set) =>
      set.location.regions.every((region) => region.page >= 15 && region.page <= 17),
    ),
  );
  assert.equal(samplePdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(samplePdf.length < 120_000);
  assert.equal(
    createHash("sha256").update(samplePdf).digest("hex"),
    "d5d260962a798827e206648df7bb4daa504b27df088c5df59f0a6c18ba4ebd56",
  );
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, null);
  assert.equal(hostingConfig.r2, null);
  assert.match(hostingConfig.project_id, /^appgprj_/);
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /favicon\.ico/);
  assert.match(css, /font-family:\s*"Inter"/);
  assert.match(css, /linear-gradient\(100deg, var\(--magenta\), var\(--purple\)\)/);
});

test("toggles every review-warning pane from one visibility state", () => {
  assert.deepEqual(reviewWarningVisibility("needs_review", 2, true), {
    outcomeCard: true,
    warningBanner: true,
    emptyState: true,
  });
  assert.deepEqual(reviewWarningVisibility("needs_review", 2, false), {
    outcomeCard: false,
    warningBanner: false,
    emptyState: false,
  });
  assert.deepEqual(reviewWarningVisibility("extracted", 0, false), {
    outcomeCard: true,
    warningBanner: false,
    emptyState: true,
  });
});

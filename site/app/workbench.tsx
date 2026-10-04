"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { extractPdfLocally, inspectPdf } from "./browser-extractor";
import {
  buildComponentScheduleCsv,
  componentSourceDisposition,
  componentScheduleFilename,
  flattenComponentSchedule,
} from "./component-schedule";
import { PdfProvenance } from "./pdf-provenance";
import { sourcePdfMatches } from "./pdf-preview-model";
import { reviewWarningVisibility } from "./review-visibility";
import {
  assertResult,
  type Component,
  type ExtractionResult,
  type Outcome,
  type TextRange,
} from "./result-schema";
import sampleResultData from "./sample-result.json";

assertResult(sampleResultData);
const sampleResult: ExtractionResult = sampleResultData;
const samplePdfPath = "/roselle-library-door-hardware.pdf";

const outcomeCopy: Record<Outcome, { label: string; detail: string }> = {
  extracted: {
    label: "Extraction complete",
    detail: "",
  },
  no_hardware_sets: {
    label: "No hardware sets found",
    detail: "The selected pages were readable, but no relevant sets were present.",
  },
  needs_review: {
    label: "Review required",
    detail: "The source was incomplete or unreliable, so the extractor abstained.",
  },
};

function outcomePresentation(result: ExtractionResult) {
  const fallback = outcomeCopy[result.outcome];
  const warningDetail = result.warnings.join(" ");
  if (result.outcome === "needs_review") {
    return {
      label: result.sets.length
        ? "Partial extraction needs review"
        : "Could not extract reliably",
      detail: warningDetail || fallback.detail,
    };
  }
  if (result.outcome === "no_hardware_sets" && warningDetail) {
    return { ...fallback, detail: warningDetail };
  }
  return fallback;
}

function confidence(component: Component): string {
  const values = Object.values(component.confidence ?? {}).filter(
    (value): value is number => typeof value === "number",
  );
  if (!values.length) return "Not scored";
  return `${Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100)}%`;
}

function SourceText({
  value,
  ranges,
}: {
  value: string | null;
  ranges?: TextRange[];
}) {
  if (!value?.trim()) return <>Not provided</>;
  if (!ranges?.length) return <>{value}</>;
  const pieces = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start > cursor) pieces.push(<span key={`plain-${index}`}>{value.slice(cursor, range.start)}</span>);
    pieces.push(
      <del key={`strike-${index}`} title="Struck out in source">
        {value.slice(range.start, range.end)}
        <span className="visually-hidden"> (struck out in source)</span>
      </del>,
    );
    cursor = range.end;
  }
  if (cursor < value.length) pieces.push(<span key="plain-last">{value.slice(cursor)}</span>);
  return <>{pieces}</>;
}

function hasStrikethrough(value: { strikethrough?: Record<string, TextRange[]> }) {
  return Boolean(value.strikethrough && Object.keys(value.strikethrough).length);
}

function sourceEditLabel(component: Component, hardwareSet?: ExtractionResult["sets"][number]) {
  const disposition = componentSourceDisposition(component, hardwareSet);
  if (disposition === "EXCLUDE - FULL SOURCE STRIKE") return "EXCLUDE";
  if (disposition === "REVIEW - PARTIAL SOURCE STRIKE") return "REVIEW EDIT";
  return "UNCHANGED";
}

export function Workbench() {
  const [result, setResult] = useState<ExtractionResult>(sampleResult);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState("Showing the bundled Roselle Library sample.");
  const [error, setError] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [resultPdfFile, setResultPdfFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageSpec, setPageSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReviewWarnings, setShowReviewWarnings] = useState(true);
  const pdfInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const userSourceChosen = useRef(false);

  const selectedSet = result.sets[selectedIndex] ?? null;
  const metrics = useMemo(
    () => ({
      sets: result.sets.length,
      components: result.sets.reduce((total, set) => total + set.components.length, 0),
      notUsed: result.sets.filter((set) => set.status === "not_used").length,
      pages: new Set(result.selected_pages).size,
    }),
    [result],
  );
  const componentSchedule = useMemo(() => flattenComponentSchedule(result), [result]);

  useEffect(() => {
    let cancelled = false;
    async function attachSamplePdf() {
      try {
        const response = await fetch(samplePdfPath);
        if (!response.ok || cancelled || userSourceChosen.current) return;
        const blob = await response.blob();
        if (cancelled || userSourceChosen.current) return;
        setResultPdfFile(
          new File([blob], sampleResult.source_file, { type: "application/pdf" }),
        );
      } catch {
        // The sample result stays usable if its optional source preview cannot be loaded.
      }
    }
    void attachSamplePdf();
    return () => {
      cancelled = true;
    };
  }, []);

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    userSourceChosen.current = true;
    setPdfFile(null);
    setResultPdfFile(null);
    setPageCount(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      assertResult(parsed);
      setResult(parsed);
      setSelectedIndex(0);
      setMessage(`Loaded ${file.name} locally.`);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read this result.");
    } finally {
      event.target.value = "";
    }
  }

  async function preparePdf(file: File) {
    userSourceChosen.current = true;
    setPdfFile(null);
    setResultPdfFile(null);
    setPageCount(null);
    setPageSpec("");
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Choose a PDF file.");
      return;
    }
    if (file.size > 75 * 1024 * 1024) {
      setError("This browser workflow accepts PDFs up to 75 MB.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(`Reading ${file.name} locally...`);
    try {
      const metadata = await inspectPdf(file);
      setPdfFile(file);
      setPageCount(metadata.pageCount);
      setPageSpec("");
      setMessage(
        `${file.name} has ${metadata.pageCount} page(s). Hardware schedule pages will be found automatically.`,
      );
    } catch (caught) {
      setPdfFile(null);
      setPageCount(null);
      setError(caught instanceof Error ? caught.message : "Unable to read this PDF.");
      setMessage("Choose a readable text PDF to begin.");
    } finally {
      setBusy(false);
    }
  }

  async function choosePdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await preparePdf(file);
    event.target.value = "";
  }

  async function dropPdf(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) await preparePdf(file);
  }

  async function runExtraction() {
    if (!pdfFile) {
      setError("Choose a PDF before running extraction.");
      return;
    }
    setBusy(true);
    setError(null);
    setResultPdfFile(null);
    try {
      const extracted = await extractPdfLocally(pdfFile, pageSpec, setMessage);
      assertResult(extracted);
      setResult(extracted);
      setResultPdfFile(pdfFile);
      setSelectedIndex(0);
      setMessage(
        `Extracted ${extracted.sets.length} hardware set(s) from ${extracted.selected_pages.length} page(s).`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to extract this PDF.");
      setMessage("The PDF stayed on this device. Adjust the page range or try another file.");
    } finally {
      setBusy(false);
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.source_file.replace(/\.pdf$/i, "")}-hardware-sets.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadComponentSchedule() {
    const csv = buildComponentScheduleCsv(componentSchedule);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = componentScheduleFilename(result.source_file);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const outcome = outcomePresentation(result);
  const visibleOutcomeDetail = !showReviewWarnings && result.warnings.length
    ? outcomeCopy[result.outcome].detail
    : outcome.detail;
  const reviewVisibility = reviewWarningVisibility(
    result.outcome,
    result.warnings.length,
    showReviewWarnings,
  );
  const hasMatchingSourcePdf = sourcePdfMatches(result.source_file, resultPdfFile);

  return (
    <main>
      <nav className="topbar" aria-label="Product">
        <a className="brand" href="#top" aria-label="Fresco Hardware Set Extractor home">
          {/* Local brand asset; native img avoids vinext's unsupported image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/fresco-logo.webp" alt="Fresco" width="48" height="48" />
          <span className="brand-copy">
            <strong>Fresco</strong>
            <small>Hardware Set Extractor</small>
          </span>
        </a>
      </nav>

      <section className="hero" id="top">
        <h1 className="visually-hidden">Fresco Hardware Set Extractor</h1>
        <div className="upload-panel">
          <div
            className={pdfFile ? "drop-zone ready" : "drop-zone"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropPdf}
          >
            <div className="drop-zone-copy">
              <strong title={pdfFile?.name}>
                {pdfFile ? pdfFile.name : "Drop a specification PDF here"}
              </strong>
              <span>
                {pageCount
                  ? `${pageCount} pages detected`
                  : "Text-based PDFs up to 75 MB"}
              </span>
            </div>
            <button
              className="button secondary compact"
              onClick={() => pdfInput.current?.click()}
              disabled={busy}
            >
              {pdfFile ? "Replace PDF" : "Choose PDF"}
            </button>
          </div>
          <div className="extract-controls automatic">
            <button className="button primary" onClick={runExtraction} disabled={busy}>
              {busy ? "Working locally..." : "Extract hardware sets"}
            </button>
          </div>
          <details className="page-override">
            <summary>Advanced: choose pages manually</summary>
            <label>
              Page override (optional)
              <input
                value={pageSpec}
                onChange={(event) => setPageSpec(event.target.value)}
                placeholder="42-48,51"
                aria-describedby="page-help"
              />
            </label>
            <p className="page-help" id="page-help">
              Leave blank to scan the full PDF locally and find the schedule automatically.
            </p>
          </details>
          <label className="warning-toggle">
            <input
              type="checkbox"
              checked={showReviewWarnings}
              onChange={(event) => setShowReviewWarnings(event.target.checked)}
            />
            <span>Show extraction and partial extraction warnings</span>
          </label>
          <div className="secondary-actions">
            <button className="text-button" onClick={() => jsonInput.current?.click()}>
              Import JSON
            </button>
            <button className="text-button" onClick={downloadJson}>
              Download current JSON
            </button>
            <button
              className="text-button"
              onClick={downloadComponentSchedule}
              disabled={!componentSchedule.length}
            >
              Export table CSV
            </button>
          </div>
          <input
            ref={pdfInput}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={choosePdf}
          />
          <input
            ref={jsonInput}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={importJson}
          />
        </div>
      </section>

      <section className="workspace" aria-label="Extraction result">
        <header className="workspace-header">
          <div>
            <p className="file-label">{result.source_file}</p>
            <p className="load-message">{message}</p>
          </div>
          {reviewVisibility.outcomeCard && (
            <div
              className={`outcome outcome-${result.outcome}`}
              id={result.outcome === "needs_review" ? "review-outcome" : undefined}
            >
              <span>{outcome.label}</span>
              {visibleOutcomeDetail && <small>{visibleOutcomeDetail}</small>}
            </div>
          )}
        </header>

        {error && <p className="error-banner">{error}</p>}
        {reviewVisibility.warningBanner && (
          <div
            className="warning-banner"
            id="extraction-warnings"
            role="status"
            aria-live="polite"
          >
            <strong>{result.warnings.length} extraction warning(s)</strong>
            <ul>
              {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}

        <div className="metric-grid">
          <article><span>Hardware sets</span><strong>{metrics.sets}</strong></article>
          <article><span>Components</span><strong>{metrics.components}</strong></article>
          <article><span>Not used</span><strong>{metrics.notUsed}</strong></article>
          <article><span>Source pages</span><strong>{metrics.pages}</strong></article>
        </div>

        {selectedSet ? (
          <div className="review-grid">
            <aside className="set-panel">
              <div className="panel-heading">
                <div><p className="kicker">RESULTS</p><h2>Hardware sets</h2></div>
              </div>
              <div
                className="set-list"
                role="region"
                aria-label="Extracted hardware sets"
                tabIndex={0}
              >
                {result.sets.map((set, index) => (
                  <button
                    className={index === selectedIndex ? "set-row selected" : "set-row"}
                    key={`${set.set_number}-${index}`}
                    onClick={() => setSelectedIndex(index)}
                  >
                    <span className="set-number">
                      <SourceText value={set.set_number} ranges={set.strikethrough?.set_number} />
                    </span>
                    <span className="set-copy">
                      <strong>
                        <SourceText
                          value={set.description || "No description"}
                          ranges={set.strikethrough?.description}
                        />
                      </strong>
                      <small>{set.components.length} component(s)</small>
                    </span>
                    <span className="status-stack">
                      <span className={`status status-${set.status}`}>
                        {set.status === "not_used" ? "NOT USED" : "ACTIVE"}
                      </span>
                      {hasStrikethrough(set) && (
                        <span className="status status-struck">SOURCE EDIT</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="detail-panel">
              <div className="detail-heading">
                <div>
                  <p className="kicker">
                    SET <SourceText
                      value={selectedSet.set_number}
                      ranges={selectedSet.strikethrough?.set_number}
                    />
                  </p>
                  <h2>
                    <SourceText
                      value={selectedSet.description || "No description"}
                      ranges={selectedSet.strikethrough?.description}
                    />
                  </h2>
                </div>
                <span className="confidence-chip">
                  {selectedSet.confidence == null
                    ? "Not scored"
                    : `${Math.round(selectedSet.confidence * 100)}% set confidence`}
                </span>
              </div>

              <div className="source-section">
                <div className="section-title">
                  <div><p className="kicker">PROVENANCE</p><h3>Source regions</h3></div>
                  <span>Pages are one-based</span>
                </div>
                {hasMatchingSourcePdf && resultPdfFile ? (
                  <PdfProvenance file={resultPdfFile} regions={selectedSet.location.regions} />
                ) : (
                  <div className="source-preview-state">
                    <strong>Source PDF not attached</strong>
                    <p>
                      Choose {result.source_file} above and run extraction to render the real pages
                      and verify each highlighted source region. No placeholder page is shown.
                    </p>
                    <button
                      className="button secondary compact"
                      onClick={() => pdfInput.current?.click()}
                      disabled={busy}
                    >
                      Choose source PDF
                    </button>
                  </div>
                )}
              </div>

              <div className="component-section">
                <div className="section-title">
                  <div><p className="kicker">STRUCTURED OUTPUT</p><h3>Components</h3></div>
                  <span>{selectedSet.components.length} row(s)</span>
                </div>
                {selectedSet.components.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Qty</th><th>Description</th><th>Catalog</th><th>Mfr</th><th>Finish</th><th>Source</th><th>Confidence</th></tr></thead>
                      <tbody>
                        {selectedSet.components.map((component, index) => (
                          <tr
                            className={hasStrikethrough(component) ? "source-struck-row" : undefined}
                            key={`${component.catalog_number}-${index}`}
                          >
                            <td><SourceText value={component.qty} ranges={component.strikethrough?.qty} /></td>
                            <td>
                              <strong><SourceText value={component.description} ranges={component.strikethrough?.description} /></strong>
                              {component.notes && <small><SourceText value={component.notes} ranges={component.strikethrough?.notes} /></small>}
                            </td>
                            <td className="mono"><SourceText value={component.catalog_number} ranges={component.strikethrough?.catalog_number} /></td>
                            <td>
                              <SourceText value={component.mfr} ranges={component.strikethrough?.mfr} />
                              {component.mfr === "PE" && <span className="context-tag">manufacturer</span>}
                            </td>
                            <td>
                              <SourceText value={component.finish} ranges={component.strikethrough?.finish} />
                              {component.finish === "PE" && <span className="context-tag">finish</span>}
                            </td>
                            <td>
                              {hasStrikethrough(component) || hasStrikethrough(selectedSet)
                                ? <span className="status status-struck">{sourceEditLabel(component, selectedSet)}</span>
                                : <span className="source-plain">Unchanged</span>}
                            </td>
                            <td>{confidence(component)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <strong>This set is marked NOT USED.</strong>
                    <p>It remains in the output with an empty component list.</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : reviewVisibility.emptyState ? (
          <div className="empty-state standalone">
            <strong>{outcome.label}</strong>
            {visibleOutcomeDetail && <p>{visibleOutcomeDetail}</p>}
          </div>
        ) : null}

        <section className="full-output" aria-labelledby="full-output-title">
          <div className="full-output-heading">
            <div>
              <p className="kicker">FULL OUTPUT</p>
              <h2 id="full-output-title">Component schedule</h2>
            </div>
            <button
              className="button secondary compact"
              onClick={downloadComponentSchedule}
              disabled={!componentSchedule.length}
            >
              Export table CSV
            </button>
          </div>
          {componentSchedule.length ? (
            <div
              className="table-wrap full-table-wrap"
              role="region"
              aria-label="All extracted hardware sets and components"
              tabIndex={0}
            >
              <table className="full-table">
                <caption className="visually-hidden">
                  All extracted hardware sets and components in source order
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Set</th>
                    <th scope="col">Set description</th>
                    <th scope="col">Status</th>
                    <th scope="col">Set source edit</th>
                    <th scope="col">Pages</th>
                    <th scope="col">Item</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Component</th>
                    <th scope="col">Catalog</th>
                    <th scope="col">Mfr</th>
                    <th scope="col">Finish</th>
                    <th scope="col">Notes</th>
                    <th scope="col">Component source edit</th>
                    <th scope="col">Order handling</th>
                    <th scope="col">Set confidence</th>
                    <th scope="col">Component confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {componentSchedule.map((row, index) => (
                    <tr key={`${row.setNumber}-${index}`}>
                      <th className="mono" scope="row"><strong><SourceText value={row.setNumber} ranges={row.setStrikethrough?.set_number} /></strong></th>
                      <td><SourceText value={row.setDescription} ranges={row.setStrikethrough?.description} /></td>
                      <td>
                        <span className={`status status-${row.status}`}>
                          {row.status === "not_used" ? "NOT USED" : "ACTIVE"}
                        </span>
                      </td>
                      <td>{row.setStruckText || <span className="source-plain">None</span>}</td>
                      <td className="mono">{row.sourcePages.join(", ")}</td>
                      <td>{row.componentOrder ?? "N/A"}</td>
                      <td><SourceText value={row.qty} ranges={row.componentStrikethrough?.qty} /></td>
                      <td><SourceText value={row.description} ranges={row.componentStrikethrough?.description} /></td>
                      <td className="mono"><SourceText value={row.catalogNumber} ranges={row.componentStrikethrough?.catalog_number} /></td>
                      <td><SourceText value={row.mfr} ranges={row.componentStrikethrough?.mfr} /></td>
                      <td><SourceText value={row.finish} ranges={row.componentStrikethrough?.finish} /></td>
                      <td className="full-notes"><SourceText value={row.notes} ranges={row.componentStrikethrough?.notes} /></td>
                      <td>{row.componentStruckText || <span className="source-plain">None</span>}</td>
                      <td>{row.orderHandling}</td>
                      <td>{`${Math.round(row.setConfidence * 100)}%`}</td>
                      <td>
                        {row.componentConfidence === null
                          ? "Not scored"
                          : `${Math.round(row.componentConfidence * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <strong>No component schedule is available.</strong>
              <p>Run an extraction or import a result containing hardware sets.</p>
            </div>
          )}
        </section>
      </section>

      <footer>
        <a href="https://jet-jonquil-d17.notion.site/Fresco-Coding-Challenge-Hardware-Sets-313e090653228072b1e2d6ab4b437c0d">
          Assignment brief
        </a>
      </footer>
    </main>
  );
}

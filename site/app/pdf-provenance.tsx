"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupRegionsByPage, normalizedRegionStyle } from "./pdf-preview-model";
import type { Region } from "./result-schema";

type PdfProvenanceProps = {
  file: File;
  regions: Region[];
};

type PdfPageCanvasProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  regions: Region[];
};

function regionDescription(region: Region, index: number): string {
  const lineRange =
    region.line_start && region.line_end
      ? `, lines ${region.line_start} through ${region.line_end}`
      : "";
  return `Source region ${index + 1}${lineRange}`;
}

function PdfPageCanvas({ document, pageNumber, regions }: PdfPageCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderWidth, setRenderWidth] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    let animationFrame = 0;
    const updateWidth = (width: number) => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const nextWidth = Math.max(1, Math.floor(width));
        setRenderWidth((current) =>
          Math.abs(current - nextWidth) > 1 ? nextWidth : current,
        );
      });
    };
    updateWidth(frame.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!renderWidth) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      setStatus("loading");
      const page = await document.getPage(pageNumber);
      try {
        if (cancelled) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const cssScale = renderWidth / baseViewport.width;
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
        if (!cancelled) setStatus("ready");
      } finally {
        page.cleanup();
      }
    }

    void renderPage().catch((caught: unknown) => {
      if (cancelled || (caught instanceof Error && caught.name === "RenderingCancelledException")) {
        return;
      }
      setStatus("error");
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber, renderWidth]);

  return (
    <div
      className="page-canvas-frame"
      ref={frameRef}
      role="group"
      aria-busy={status === "loading"}
      aria-label={`PDF page ${pageNumber} with ${regions.length} highlighted source region${regions.length === 1 ? "" : "s"}`}
    >
      <canvas
        ref={canvasRef}
        className="pdf-page-canvas"
        role="img"
        aria-label={`Rendered source PDF page ${pageNumber}`}
      />
      {regions.map((region, index) => (
        <span
          className="region-box"
          key={`${region.page}-${region.line_start ?? "bbox"}-${index}`}
          style={normalizedRegionStyle(region)}
          role="note"
          aria-label={regionDescription(region, index)}
        >
          <span aria-hidden="true">{index + 1}</span>
        </span>
      ))}
      {status === "loading" && (
        <span className="page-render-status" role="status" aria-live="polite">
          Rendering page...
        </span>
      )}
      {status === "error" && (
        <span className="page-render-status error" role="alert">
          Unable to render this source page.
        </span>
      )}
    </div>
  );
}

export function PdfProvenance({ file, regions }: PdfProvenanceProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = useMemo(() => groupRegionsByPage(regions), [regions]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    async function loadDocument() {
      const pdfjs = await import("pdfjs-dist/webpack.mjs");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (cancelled) return;
      loadingTask = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
      loadedDocument = await loadingTask.promise;
      if (cancelled) {
        await loadedDocument.destroy();
        return;
      }
      setDocument(loadedDocument);
      setError(null);
    }

    void loadDocument().catch((caught: unknown) => {
      if (cancelled) return;
      setError(caught instanceof Error ? caught.message : "Unable to open the source PDF.");
    });

    return () => {
      cancelled = true;
      if (loadedDocument) void loadedDocument.destroy();
      else if (loadingTask) void loadingTask.destroy();
    };
  }, [file]);

  if (error) {
    return (
      <div className="source-preview-state error" role="alert">
        <strong>Source PDF preview unavailable</strong>
        <p>{error}</p>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="source-preview-state" role="status" aria-live="polite">
        <strong>Opening source PDF...</strong>
        <p>The document remains in this browser.</p>
      </div>
    );
  }

  return (
    <div className="page-strip">
      {pages.map(({ page, regions: pageRegions }) => (
        <article className="page-card" key={page}>
          <header>
            <strong>Page {page}</strong>
            <small>
              {pageRegions.length === 1
                ? regionDescription(pageRegions[0], 0)
                : `${pageRegions.length} highlighted regions`}
            </small>
          </header>
          <PdfPageCanvas document={document} pageNumber={page} regions={pageRegions} />
        </article>
      ))}
    </div>
  );
}

import type { Region } from "./result-schema";

export type PageRegions = {
  page: number;
  regions: Region[];
};

export function groupRegionsByPage(regions: Region[]): PageRegions[] {
  const grouped = new Map<number, Region[]>();
  for (const region of regions) {
    const pageRegions = grouped.get(region.page) ?? [];
    pageRegions.push(region);
    grouped.set(region.page, pageRegions);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([page, pageRegions]) => ({ page, regions: pageRegions }));
}

export function normalizedRegionStyle(region: Region) {
  return {
    left: `${region.bbox.x0 * 100}%`,
    top: `${region.bbox.y0 * 100}%`,
    width: `${(region.bbox.x1 - region.bbox.x0) * 100}%`,
    height: `${(region.bbox.y1 - region.bbox.y0) * 100}%`,
  };
}

function basename(filename: string): string {
  return filename.split(/[\\/]/).at(-1)?.trim().toLocaleLowerCase() ?? "";
}

export function sourcePdfMatches(sourceFile: string, pdfFile: File | null): boolean {
  return Boolean(pdfFile && basename(sourceFile) === basename(pdfFile.name));
}

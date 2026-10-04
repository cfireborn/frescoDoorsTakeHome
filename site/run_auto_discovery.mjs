import fs from "fs";
import path from "path";
import { extractPdfLocally } from "./app/browser-extractor.ts";

// Create a Fake File object
class FakeFile {
  constructor(buffer, name) {
    this.buffer = buffer;
    this.name = name;
  }
  async arrayBuffer() {
    return this.buffer.buffer.slice(
      this.buffer.byteOffset,
      this.buffer.byteOffset + this.buffer.byteLength
    );
  }
}

const baseDir = "/Users/cfire/Desktop/frescoTakeHome/Fresco Coding Challenge (Hardware Sets)";
const outDir = "/Users/cfire/Desktop/frescoTakeHome/scratch/auto_discovery_results";
fs.mkdirSync(outDir, { recursive: true });

async function runAll() {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const res = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(res);
      } else if (res.toLowerCase().endsWith(".pdf")) {
        files.push(res);
      }
    }
  }
  walk(baseDir);

  const results = [];
  for (const f of files.sort()) {
    const project = path.basename(path.dirname(f));
    const filename = path.basename(f);
    console.log(`Processing: ${project} / ${filename}`);
    const buffer = fs.readFileSync(f);
    const fakeFile = new FakeFile(buffer, filename);

    try {
      // Empty string for pageSpec triggers auto-discovery!
      const result = await extractPdfLocally(fakeFile, "", (msg) => {});
      const summary = {
        project,
        filename,
        outcome: result.outcome,
        sets: result.sets ? result.sets.length : 0,
        warnings: result.warnings ? result.warnings.length : 0,
        pages: result.selected_pages ? result.selected_pages.length : 0,
      };
      results.push(summary);
      fs.appendFileSync(path.join(outDir, "results.jsonl"), JSON.stringify(summary) + "\n");
      // console.log(" ->", summary.outcome, `${summary.sets} sets`, `(${summary.pages} pages)`);
    } catch (e) {
      // console.error(`Error on ${filename}:`, e);
      const errSum = {
        project,
        filename,
        outcome: "ERROR",
        sets: 0,
        warnings: 0,
        pages: 0,
        error: String(e)
      };
      results.push(errSum);
      fs.appendFileSync(path.join(outDir, "results.jsonl"), JSON.stringify(errSum) + "\n");
    }
  }

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  console.log("Done. Results written to results.json");
}

runAll().catch(console.error);

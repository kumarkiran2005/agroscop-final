// Test runner for the schemes feature.
//
// Bundles each tests/ **/*.test.ts through esbuild (resolving the "@/" alias the
// same way vite.config.ts does) and imports the result. A test file that throws
// is a failure. esbuild is already present as a Vite dependency, so this adds no
// new packages.
//
// Usage: npm test

import { build } from "esbuild";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, "tests");

function findTests(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...findTests(full));
    else if (entry.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

const files = findTests(TEST_DIR).sort();
if (files.length === 0) {
  console.error("No test files found under tests/");
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "agro-tests-"));
let failed = 0;

for (const file of files) {
  const name = relative(TEST_DIR, file);
  const outfile = join(outDir, name.replace(/[\\/]/g, "_").replace(/\.ts$/, ".mjs"));
  console.log(`\n${name}`);
  // The build is inside the try on purpose: an unresolved import is a test
  // failure, not a runner crash. Left outside, it aborts the whole run and
  // skips every remaining file.
  try {
    await build({
      entryPoints: [file],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      alias: { "@": join(ROOT, "src") },
      logLevel: "silent",
    });
    await import(pathToFileURL(outfile).href);
  } catch (err) {
    failed += 1;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED\n${message.replace(/^/gm, "    ")}`);
  }
}

console.log(`\n${files.length - failed} file(s) passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

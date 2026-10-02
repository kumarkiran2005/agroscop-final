/**
 * Minimal assertion harness. No test framework is installed; test files are
 * bundled by scripts/run-tests.mjs and executed as plain node modules, so a
 * thrown error means failure.
 */
const failures: string[] = [];

/** Run one named case. Records the failure instead of aborting the file. */
export function it(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(name);
    console.error(`  FAIL ${name}\n       ${message}`);
  }
}

/** Call at the end of every test file. Throws if any case failed. */
export function done(): void {
  if (failures.length > 0) {
    throw new Error(`${failures.length} case(s) failed: ${failures.join(", ")}`);
  }
}

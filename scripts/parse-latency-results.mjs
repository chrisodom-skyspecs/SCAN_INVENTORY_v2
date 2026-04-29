#!/usr/bin/env node
/**
 * scripts/parse-latency-results.mjs
 *
 * Post-processes vitest latency benchmark output into a clean JSON artifact.
 *
 * Reads:
 *   test-results/latency-output.txt   — captured verbose vitest stdout
 *   test-results/latency-results.json — vitest JSON reporter output
 *
 * Writes:
 *   test-results/latency-summary.json — structured p50 summary for CI artifacts
 *   test-results/latency-report.md    — human-readable Markdown report
 *
 * Exit codes:
 *   0 — all benchmarks passed (p50 < threshold)
 *   1 — one or more benchmarks failed (p50 >= threshold), or test failures found
 *
 * Usage:
 *   node scripts/parse-latency-results.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

// ── Configuration ─────────────────────────────────────────────────────────────

const P50_BUDGET_MS = 200;
const RESULTS_DIR = "test-results";
const LOG_FILE    = `${RESULTS_DIR}/latency-output.txt`;
const JSON_FILE   = `${RESULTS_DIR}/latency-results.json`;
const OUT_JSON    = `${RESULTS_DIR}/latency-summary.json`;
const OUT_MD      = `${RESULTS_DIR}/latency-report.md`;

// ── Ensure output directory exists ────────────────────────────────────────────

mkdirSync(RESULTS_DIR, { recursive: true });

// ── Parse [latency] lines from verbose output ─────────────────────────────────

/**
 * Each benchmark test emits a line like:
 *   [latency] getCaseById         p50 = 0.003ms
 *   [latency] listCases (all)     p50 = 0.012ms
 *
 * We extract name and p50_ms from every such line.
 */
const benchmarks = [];

if (existsSync(LOG_FILE)) {
  const log = readFileSync(LOG_FILE, "utf8");
  // Match: [latency] <name> p50 = <value>ms
  // The name may contain spaces, parentheses, +, etc.
  const latencyRe = /\[latency\]\s+(.+?)\s+p50\s*=\s*([\d.]+)ms/g;
  let match;
  while ((match = latencyRe.exec(log)) !== null) {
    const name   = match[1].trim().replace(/\s+/g, " ");
    const p50_ms = parseFloat(match[2]);
    benchmarks.push({
      name,
      p50_ms,
      threshold_ms: P50_BUDGET_MS,
      passed: p50_ms < P50_BUDGET_MS,
    });
  }
} else {
  console.warn(`[parse-latency-results] Warning: ${LOG_FILE} not found — no benchmark lines to parse.`);
}

// ── Parse test pass/fail counts from vitest JSON report ───────────────────────

let testStats = { total: 0, passed: 0, failed: 0, skipped: 0 };
let vitestPassed = true;

if (existsSync(JSON_FILE)) {
  try {
    const raw  = readFileSync(JSON_FILE, "utf8");
    const json = JSON.parse(raw);

    // vitest JSON report shape (v1+)
    testStats.total   = json.numTotalTests   ?? json.numTests          ?? 0;
    testStats.passed  = json.numPassedTests  ?? json.numPassingTests   ?? 0;
    testStats.failed  = json.numFailedTests  ?? json.numFailingTests   ?? 0;
    testStats.skipped = json.numSkippedTests ?? json.numPendingTests   ?? 0;

    if (testStats.failed > 0) {
      vitestPassed = false;
    }

    // Collect names of failed tests for diagnostics
    const failedTestNames = [];
    for (const suite of (json.testResults ?? json.suites ?? [])) {
      for (const t of (suite.assertionResults ?? suite.tests ?? [])) {
        if ((t.status ?? t.state) === "failed") {
          failedTestNames.push(`${suite.testFilePath ?? suite.name ?? "?"} > ${t.title ?? t.name ?? "?"}`);
        }
      }
    }
    if (failedTestNames.length > 0) {
      testStats.failedTestNames = failedTestNames;
    }
  } catch (e) {
    console.warn(`[parse-latency-results] Warning: Could not parse ${JSON_FILE}: ${e.message}`);
  }
} else {
  console.warn(`[parse-latency-results] Warning: ${JSON_FILE} not found — test stats unavailable.`);
}

// ── Determine overall pass/fail ───────────────────────────────────────────────

const benchmarksFailed = benchmarks.filter((b) => !b.passed);
const overallPassed = vitestPassed && benchmarksFailed.length === 0;

// ── Build summary object ──────────────────────────────────────────────────────

const summary = {
  timestamp:       new Date().toISOString(),
  threshold_ms:    P50_BUDGET_MS,
  overall_passed:  overallPassed,
  benchmark_count: benchmarks.length,
  test_stats:      testStats,
  benchmarks,
  ...(benchmarksFailed.length > 0 && {
    failing_benchmarks: benchmarksFailed.map((b) => b.name),
  }),
};

// ── Write JSON summary ────────────────────────────────────────────────────────

writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");
console.log(`[parse-latency-results] Wrote JSON summary → ${OUT_JSON}`);

// ── Build Markdown report ─────────────────────────────────────────────────────

const overallIcon = overallPassed ? "✅" : "❌";
const statusLabel = overallPassed ? "PASSED" : "FAILED";

let md = `# Latency Benchmark Report\n\n`;
md    += `**Generated:** ${summary.timestamp}  \n`;
md    += `**p50 threshold:** ${P50_BUDGET_MS} ms  \n`;
md    += `**Overall:** ${overallIcon} ${statusLabel}\n\n`;

if (testStats.total > 0) {
  md += `## Test Statistics\n\n`;
  md += `| Total | Passed | Failed | Skipped |\n`;
  md += `|-------|--------|--------|--------|\n`;
  md += `| ${testStats.total} | ${testStats.passed} | ${testStats.failed} | ${testStats.skipped} |\n\n`;
}

if (benchmarks.length > 0) {
  md += `## p50 Benchmark Results\n\n`;
  md += `| Endpoint | p50 (ms) | Threshold | Status |\n`;
  md += `|----------|----------|-----------|--------|\n`;
  for (const b of benchmarks) {
    const icon  = b.passed ? "✅" : "❌";
    const label = b.passed ? "Pass"  : "**FAIL — exceeds threshold**";
    md += `| \`${b.name}\` | ${b.p50_ms.toFixed(3)} | < ${b.threshold_ms} | ${icon} ${label} |\n`;
  }
  md += "\n";
} else {
  md += `> ⚠️ No benchmark lines found in output — check that latency test files emitted \`[latency]\` lines.\n\n`;
}

if (benchmarksFailed.length > 0) {
  md += `## ❌ Failing Benchmarks\n\n`;
  for (const b of benchmarksFailed) {
    md += `- \`${b.name}\`: p50 = **${b.p50_ms.toFixed(3)} ms** (threshold: ${b.threshold_ms} ms)\n`;
  }
  md += "\n";
}

if (testStats.failedTestNames && testStats.failedTestNames.length > 0) {
  md += `## ❌ Failed Test Assertions\n\n`;
  for (const name of testStats.failedTestNames) {
    md += `- ${name}\n`;
  }
  md += "\n";
}

md += `---\n_Report generated by \`scripts/parse-latency-results.mjs\`_\n`;

writeFileSync(OUT_MD, md, "utf8");
console.log(`[parse-latency-results] Wrote Markdown report → ${OUT_MD}`);

// ── Console summary ───────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════");
console.log(`  Latency Benchmark Summary — ${statusLabel}`);
console.log("══════════════════════════════════════════════════");
console.log(`  Threshold : < ${P50_BUDGET_MS} ms p50`);
console.log(`  Tests     : ${testStats.passed}/${testStats.total} passed`);
console.log(`  Benchmarks: ${benchmarks.length - benchmarksFailed.length}/${benchmarks.length} within budget`);
console.log("──────────────────────────────────────────────────");

if (benchmarks.length === 0) {
  console.log("  (no [latency] lines found in output)");
} else {
  for (const b of benchmarks) {
    const icon = b.passed ? "✓" : "✗";
    const flag = b.passed ? "" : "  ← EXCEEDS p50 BUDGET";
    const name = b.name.padEnd(42);
    const val  = `${b.p50_ms.toFixed(3)} ms`.padStart(10);
    console.log(`  ${icon} ${name} ${val}${flag}`);
  }
}

console.log("══════════════════════════════════════════════════\n");

// ── Exit with non-zero if any benchmark or test failed ────────────────────────
// (The vitest process already exited non-zero in CI — this script is informational,
//  but we also exit non-zero in case it is the final step that sets the job result.)

process.exit(overallPassed ? 0 : 1);

// Baseline: freeze existing findings so CI only fails on NEW violations.
// eslint-suppressions-style: counts per `file::rule` key, so line drift from
// unrelated edits doesn't invalidate the baseline.
//
//   npx nestjs-ddd-doctor --update-baseline   → writes ddd-doctor-baseline.json
//   (subsequent runs auto-load it if present)
//
// Semantics per key:
//   current ≤ baseline → all findings for that key suppressed
//   current > baseline → ALL findings for that key reported (regression)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const BASELINE_FILE = 'ddd-doctor-baseline.json';

const keyOf = (f) => `${f.file}::${f.rule.id}`;

export function loadBaseline(cwd) {
  const p = join(cwd, BASELINE_FILE);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed.entries ?? {};
  } catch {
    console.error(`nestjs-ddd-doctor: invalid baseline ${p} — ignoring it.`);
    return null;
  }
}

export function writeBaseline(cwd, findings) {
  const entries = {};
  for (const f of findings) entries[keyOf(f)] = (entries[keyOf(f)] ?? 0) + 1;
  const p = join(cwd, BASELINE_FILE);
  writeFileSync(p, JSON.stringify({ version: 1, entries }, null, 2) + '\n');
  return { path: p, count: findings.length };
}

/** Returns { visible, suppressedCount } after applying the baseline. */
export function applyBaseline(findings, baseline) {
  if (!baseline) return { visible: findings, suppressedCount: 0 };

  const counts = {};
  for (const f of findings) counts[keyOf(f)] = (counts[keyOf(f)] ?? 0) + 1;

  const visible = [];
  let suppressedCount = 0;
  for (const f of findings) {
    const k = keyOf(f);
    if ((baseline[k] ?? 0) >= counts[k]) suppressedCount++;
    else visible.push(f); // key regressed (or is new) → report all of it
  }
  return { visible, suppressedCount };
}

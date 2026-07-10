#!/usr/bin/env node
/**
 * nestjs-ddd-doctor — architecture check-up for NestJS projects with DDD leanings.
 *
 * Usage:
 *   npx nestjs-ddd-doctor [srcDir] [options]
 *
 * Options:
 *   --profile=pragmatic|strict   pragmatic (default): layer boundaries only.
 *                                strict: real tactical DDD — use cases,
 *                                repository ports, bounded-context skeleton.
 *   --ai=claude|codex|clipboard  Skip the prompt and hand findings straight off.
 *   --ci                         No interactive prompt; exit 1 on 🔴 findings.
 *
 * Config (./ddd-doctor.config.json):
 *   {
 *     "profile": "strict",
 *     "rules": { "controller-logic": "off" },
 *     "exempt": ["health.controller.ts", "lock.service.ts"]
 *   }
 *
 * Escape hatch: `// ddd-doctor-disable-next-line` above the offending line.
 * Exit code: 1 if any 🔴 finding (CI-friendly), 0 otherwise.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { rulesFor } from '../lib/rules.mjs';
import { banner, printReport, computeScore, grade } from '../lib/report.mjs';
import { offerAiHandoff } from '../lib/ai.mjs';

const CWD = process.cwd();

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }),
);
const positional = args.find((a) => !a.startsWith('--'));

// ── Config ────────────────────────────────────────────────────────────────────

let config = { rules: {}, exempt: [], profile: undefined };
const configPath = join(CWD, 'ddd-doctor.config.json');
if (existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf8')) };
  } catch (e) {
    console.error(`nestjs-ddd-doctor: invalid config ${configPath}: ${e.message}`);
    process.exit(2);
  }
}

const profile = flags.profile ?? config.profile ?? 'pragmatic';
if (!['pragmatic', 'strict'].includes(profile)) {
  console.error(`nestjs-ddd-doctor: unknown profile '${profile}' (pragmatic|strict)`);
  process.exit(2);
}

// ── Source dir resolution (monorepo-friendly) ────────────────────────────────

function findNestRoots(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  if (entries.some((e) => e.isFile() && e.name.endsWith('.controller.ts'))) {
    out.push(dir);
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue;
    findNestRoots(join(dir, e.name), depth + 1, out);
  }
  return out;
}

function resolveSrc() {
  if (positional) return resolve(positional);
  const dflt = resolve('./src');
  if (existsSync(dflt)) return dflt;

  const hits = findNestRoots(CWD);
  const roots = [...new Set(hits.map((h) => {
    const m = h.match(/^(.*\/src)(\/|$)/);
    return m ? m[1] : h;
  }))];

  if (roots.length === 1) return roots[0]; // shown as "patient" in the banner
  if (roots.length > 1) {
    console.error('nestjs-ddd-doctor: multiple NestJS source dirs found — pick one:');
    for (const r of roots) console.error(`   npx nestjs-ddd-doctor ${relative(CWD, r)}`);
    process.exit(2);
  }
  console.error('nestjs-ddd-doctor: no source directory found (no ./src, no *.controller.ts nearby)');
  console.error('Usage: npx nestjs-ddd-doctor [srcDir]');
  process.exit(2);
}

const SRC = resolveSrc();
if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  console.error(`nestjs-ddd-doctor: source directory not found: ${SRC}`);
  process.exit(2);
}

// ── Scan ──────────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) yield p;
  }
}

const files = new Map();
for (const file of walk(SRC)) files.set(file, readFileSync(file, 'utf8').split('\n'));

const isExempt = (f) => config.exempt.some((suffix) => f.endsWith(suffix));
const ctx = { files, src: SRC };
const rules = rulesFor(profile);

const findings = [];
for (const [file, lines] of files) {
  if (isExempt(file)) continue;
  const rel = relative(CWD, file);
  for (const rule of rules) {
    if (config.rules[rule.id] === 'off') continue;
    for (const line of rule.match(file, lines, ctx)) {
      findings.push({ rule, file: rel, line });
    }
  }
}

const order = { high: 0, med: 1, low: 2 };
findings.sort((a, b) => order[a.rule.sev] - order[b.rule.sev] || a.file.localeCompare(b.file));

// ── Report + AI handoff ───────────────────────────────────────────────────────

const srcLabel = relative(CWD, SRC) || '.';
banner(srcLabel, profile);

const score = computeScore(findings);
printReport(findings, score);

await offerAiHandoff(
  findings,
  { srcLabel, profile, score, gradeLabel: grade(score) },
  { aiFlag: typeof flags.ai === 'string' ? flags.ai : undefined, ci: Boolean(flags.ci) },
);

const hasHigh = findings.some((f) => f.rule.sev === 'high');
process.exit(hasHigh ? 1 : 0);

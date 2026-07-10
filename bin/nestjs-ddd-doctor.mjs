#!/usr/bin/env node
/**
 * nestjs-ddd-doctor — architecture linter for NestJS projects with DDD leanings.
 *
 * Heuristic, zero-dependency, regex-based. It checks the boundaries most
 * NestJS codebases agree on once they adopt a layered/DDD structure:
 *
 *   - Thin controllers: no DB access, no outbound HTTP, no dense branching.
 *   - Pure domain: `domain/` folders import no framework, ORM or infrastructure.
 *   - Application layer depends on ports, not concrete infrastructure.
 *   - No forwardRef (circular module smell).
 *   - Raw SQL only in db/ or infrastructure/ folders.
 *
 * Usage:
 *   npx nestjs-ddd-doctor [srcDir]        # default: ./src
 *
 * Exit code: 1 if any 🔴 finding (CI-friendly), 0 otherwise.
 *
 * Escape hatch for justified exceptions:
 *   // ddd-doctor-disable-next-line
 *
 * Optional config (./ddd-doctor.config.json):
 *   {
 *     "rules": { "controller-logic": "off" },
 *     "exempt": ["health.controller.ts", "lock.service.ts"]
 *   }
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const CWD = process.cwd();

// Monorepo-friendly default: when no arg is given and ./src doesn't exist,
// look for directories that actually contain NestJS controllers
// (*.controller.ts) up to a few levels deep — e.g. apps/api/src.
function findNestRoots(dir, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  if (entries.some((e) => e.isFile() && e.name.endsWith('.controller.ts'))) {
    out.push(dir);
    return out; // good enough as a root; no need to descend further
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue;
    findNestRoots(join(dir, e.name), depth + 1, out);
  }
  return out;
}

function resolveSrc() {
  if (process.argv[2]) return resolve(process.argv[2]);
  const dflt = resolve('./src');
  if (existsSync(dflt)) return dflt;

  // Controllers live nested (src/foo/foo.controller.ts) — collect the roots
  // and reduce them to their nearest `src` ancestor (or the dir itself).
  const hits = findNestRoots(CWD);
  const roots = [...new Set(hits.map((h) => {
    const m = h.match(/^(.*\/src)(\/|$)/);
    return m ? m[1] : h;
  }))];

  if (roots.length === 1) {
    console.log(`(auto-detected source dir: ${relative(CWD, roots[0])})`);
    return roots[0];
  }
  if (roots.length > 1) {
    console.error('nestjs-ddd-doctor: multiple NestJS source dirs found — pick one:');
    for (const r of roots) console.error(`   npx nestjs-ddd-doctor ${relative(CWD, r)}`);
    process.exit(2);
  }
  console.error(`nestjs-ddd-doctor: no source directory found (no ./src, no *.controller.ts nearby)`);
  console.error('Usage: npx nestjs-ddd-doctor [srcDir]');
  process.exit(2);
}

const SRC = resolveSrc();

if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  console.error(`nestjs-ddd-doctor: source directory not found: ${SRC}`);
  console.error('Usage: npx nestjs-ddd-doctor [srcDir]');
  process.exit(2);
}

// ── Config ────────────────────────────────────────────────────────────────────

let config = { rules: {}, exempt: [] };
const configPath = join(CWD, 'ddd-doctor.config.json');
if (existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(readFileSync(configPath, 'utf8')) };
  } catch (e) {
    console.error(`nestjs-ddd-doctor: invalid config ${configPath}: ${e.message}`);
    process.exit(2);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEV = { high: '🔴', med: '🟠', low: '🟡' };

const isController = (f) => f.endsWith('.controller.ts');
const inDir = (f, dir) => f.includes(`/${dir}/`);
const isExempt = (f) => config.exempt.some((suffix) => f.endsWith(suffix));

// ORM / DB client imports that have no business inside a controller or domain.
const ORM_IMPORTS =
  /from '(drizzle-orm|typeorm|@prisma\/client|@mikro-orm\/|knex|pg|mongoose|sequelize)/;
// Common DB injection tokens/handles.
const DB_HANDLES = /@Inject\((DRIZZLE|DATABASE|DB|KNEX|PG)|@InjectRepository\(|@InjectModel\(|@InjectDataSource\(|@InjectEntityManager\(/;
// Project-local schema/db imports (e.g. `../db/schema`).
const LOCAL_DB = /from '.*\/(db|database)\/(schema|drizzle|client|connection)/;

function grep(lines, re) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !lines[i - 1]?.includes('ddd-doctor-disable-next-line')) {
      out.push(i + 1);
    }
  }
  return out;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

const RULES = [
  {
    id: 'controller-db',
    sev: 'high',
    desc: 'Controller accesses the database directly (move it to a service/repository)',
    match: (f, lines) =>
      isController(f) && !isExempt(f)
        ? [...new Set([...grep(lines, ORM_IMPORTS), ...grep(lines, DB_HANDLES), ...grep(lines, LOCAL_DB)])].sort((a, b) => a - b)
        : [],
  },
  {
    id: 'controller-fetch',
    sev: 'high',
    desc: 'Controller performs outbound HTTP (move it to an infrastructure service)',
    match: (f, lines) =>
      isController(f) && !isExempt(f) ? grep(lines, /\bfetch\(|axios\.|got\(/) : [],
  },
  {
    id: 'domain-purity',
    sev: 'high',
    desc: 'Domain imports framework/ORM/infrastructure (domain/ must be plain TypeScript)',
    match: (f, lines) =>
      inDir(f, 'domain') && !isExempt(f)
        ? [...new Set([
            ...grep(lines, /from '@nestjs\//),
            ...grep(lines, ORM_IMPORTS),
            ...grep(lines, /\/infrastructure\//),
            ...grep(lines, LOCAL_DB),
          ])].sort((a, b) => a - b)
        : [],
  },
  {
    id: 'controller-logic',
    sev: 'med',
    desc: 'Business logic in controller (dense branching — extract to a service)',
    match: (f, lines) => {
      if (!isController(f) || isExempt(f)) return [];
      // Threshold: >5 branches in one controller file = orchestration that
      // belongs in a service.
      const hits = grep(lines, /^\s*(if|for|switch|while)\s*\(/);
      return hits.length > 5 ? [hits[0]] : [];
    },
  },
  {
    id: 'application-concrete-infra',
    sev: 'med',
    desc: 'Application layer imports concrete infrastructure (depend on the port, not the class)',
    match: (f, lines) =>
      inDir(f, 'application') && !f.endsWith('.module.ts') && !isExempt(f)
        ? grep(lines, /from '.*\/infrastructure\//)
        : [],
  },
  {
    id: 'handler-io',
    sev: 'med',
    desc: 'Handler performs direct I/O (DB/HTTP — use the repositories from its context)',
    match: (f, lines) =>
      inDir(f, 'handlers') && !isExempt(f)
        ? [...new Set([...grep(lines, DB_HANDLES), ...grep(lines, /\bfetch\(|axios\./)])].sort((a, b) => a - b)
        : [],
  },
  {
    id: 'no-forward-ref',
    sev: 'low',
    desc: 'forwardRef — circular modules (rethink the dependency direction)',
    match: (f, lines) => (isExempt(f) ? [] : grep(lines, /forwardRef\(/)),
  },
  {
    id: 'raw-sql-outside-infra',
    sev: 'low',
    desc: 'Raw SQL outside db/ and infrastructure/ (move it to a repository)',
    match: (f, lines) =>
      !inDir(f, 'db') && !inDir(f, 'database') && !inDir(f, 'infrastructure') &&
      !f.endsWith('.spec.ts') && !isExempt(f)
        ? grep(lines, /\.(execute|query)\(\s*sql`|sql`\s*(select|update|insert|delete)\b/i)
        : [],
  },
];

// ── Walker ────────────────────────────────────────────────────────────────────

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) yield p;
  }
}

const findings = [];
for (const file of walk(SRC)) {
  const rel = relative(CWD, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const rule of RULES) {
    if (config.rules[rule.id] === 'off') continue;
    for (const line of rule.match(file, lines)) {
      findings.push({ rule, file: rel, line });
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

const order = { high: 0, med: 1, low: 2 };
findings.sort((a, b) => order[a.rule.sev] - order[b.rule.sev] || a.file.localeCompare(b.file));

const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, []);
  byRule.get(f.rule.id).push(f);
}

console.log(`\nnestjs-ddd-doctor — ${relative(CWD, SRC) || '.'}\n`);
for (const [id, list] of byRule) {
  const { sev, desc } = list[0].rule;
  console.log(`${SEV[sev]} ${id} — ${desc} (${list.length})`);
  for (const f of list) console.log(`   ${f.file}:${f.line}`);
  console.log('');
}

const counts = { high: 0, med: 0, low: 0 };
for (const f of findings) counts[f.rule.sev]++;
const score = Math.max(0, 100 - counts.high * 10 - counts.med * 4 - counts.low * 1);

if (findings.length === 0) console.log('✅ No findings.');
console.log(`Score: ${score}/100  (🔴 ${counts.high} × -10   🟠 ${counts.med} × -4   🟡 ${counts.low} × -1)\n`);

process.exit(counts.high > 0 ? 1 : 0);

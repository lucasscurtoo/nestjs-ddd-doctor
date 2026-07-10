// Rule definitions.
//
// Two profiles:
//   - pragmatic (default): the boundaries most layered NestJS codebases agree
//     on — thin controllers, pure domain, ports over concrete infrastructure.
//   - strict: real tactical DDD on top of pragmatic — use cases as the
//     application entrypoint, repository ports, bounded-context skeleton
//     (domain/ + application/ per feature module).
//
// A rule is { id, sev, desc, fix, match(file, lines, ctx) → [lineNumbers] }.
// `ctx` gives cross-file context: { files: Map<absPath, lines>, src }.
// `fix` feeds the AI handoff prompt.

const DISABLE = 'ddd-doctor-disable-next-line';

export const isController = (f) => f.endsWith('.controller.ts');
export const inDir = (f, dir) => f.includes(`/${dir}/`);

// ORM / DB client imports that have no business inside a controller or domain.
const ORM_IMPORTS =
  /from '(drizzle-orm|typeorm|@prisma\/client|@mikro-orm\/|knex|pg|mongoose|sequelize)/;
// Common DB injection tokens/handles.
const DB_HANDLES =
  /@Inject\((DRIZZLE|DATABASE|DB|KNEX|PG)|@InjectRepository\(|@InjectModel\(|@InjectDataSource\(|@InjectEntityManager\(/;
// Project-local schema/db imports (e.g. `../db/schema`).
const LOCAL_DB = /from '.*\/(db|database)\/(schema|drizzle|client|connection)/;

export function grep(lines, re) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]) && !lines[i - 1]?.includes(DISABLE)) out.push(i + 1);
  }
  return out;
}

const merge = (...lists) => [...new Set(lists.flat())].sort((a, b) => a - b);

// ── Pragmatic rules ───────────────────────────────────────────────────────────

const PRAGMATIC = [
  {
    id: 'controller-db',
    sev: 'high',
    desc: 'Controller accesses the database directly (move it to a service/repository)',
    fix: 'Move the query into an injectable service or repository and inject that instead. The controller should only translate HTTP ↔ application calls.',
    match: (f, lines) =>
      isController(f)
        ? merge(grep(lines, ORM_IMPORTS), grep(lines, DB_HANDLES), grep(lines, LOCAL_DB))
        : [],
  },
  {
    id: 'controller-fetch',
    sev: 'high',
    desc: 'Controller performs outbound HTTP (move it to an infrastructure service)',
    fix: 'Wrap the outbound call in an infrastructure service (gateway/client class) and inject it.',
    match: (f, lines) => (isController(f) ? grep(lines, /\bfetch\(|axios\.|got\(/) : []),
  },
  {
    id: 'domain-purity',
    sev: 'high',
    desc: 'Domain imports framework/ORM/infrastructure (domain/ must be plain TypeScript)',
    fix: 'Remove the import. If the domain needs a capability (persistence, time, ids), declare an interface (port) in the domain/application layer and implement it in infrastructure.',
    match: (f, lines) =>
      inDir(f, 'domain')
        ? merge(
            grep(lines, /from '@nestjs\//),
            grep(lines, ORM_IMPORTS),
            grep(lines, /\/infrastructure\//),
            grep(lines, LOCAL_DB),
          )
        : [],
  },
  {
    id: 'domain-imports-application',
    sev: 'high',
    desc: 'Domain imports from application/ (dependency direction is inverted)',
    fix: 'Dependencies point inward: application depends on domain, never the reverse. Move the shared type into domain/ or invert with a port.',
    match: (f, lines) => (inDir(f, 'domain') ? grep(lines, /from '.*\/application\//) : []),
  },
  {
    id: 'controller-logic',
    sev: 'med',
    desc: 'Business logic in controller (dense branching — extract to a service)',
    fix: 'Extract the orchestration into an application service or use case; leave the controller with parameter mapping and a single delegation call.',
    match: (f, lines) => {
      if (!isController(f)) return [];
      const hits = grep(lines, /^\s*(if|for|switch|while)\s*\(/);
      return hits.length > 5 ? [hits[0]] : [];
    },
  },
  {
    id: 'application-concrete-infra',
    sev: 'med',
    desc: 'Application layer imports concrete infrastructure (depend on the port, not the class)',
    fix: 'Define an interface (port) next to the use case, inject the implementation via a DI token, and import only the interface here.',
    match: (f, lines) =>
      inDir(f, 'application') && !f.endsWith('.module.ts')
        ? grep(lines, /from '.*\/infrastructure\//)
        : [],
  },
  {
    id: 'handler-io',
    sev: 'med',
    desc: 'Handler performs direct I/O (DB/HTTP — use the repositories from its context)',
    fix: 'Handlers should receive their dependencies (repositories, gateways) through their context or constructor — move the raw I/O behind one.',
    match: (f, lines) =>
      inDir(f, 'handlers') ? merge(grep(lines, DB_HANDLES), grep(lines, /\bfetch\(|axios\./)) : [],
  },
  {
    id: 'no-forward-ref',
    sev: 'low',
    desc: 'forwardRef — circular modules (rethink the dependency direction)',
    fix: 'Break the cycle: extract the shared piece into its own module, or invert one side with an interface + DI token.',
    match: (f, lines) => grep(lines, /forwardRef\(/),
  },
  {
    id: 'raw-sql-outside-infra',
    sev: 'low',
    desc: 'Raw SQL outside db/ and infrastructure/ (move it to a repository)',
    fix: 'Move the raw query into a repository class under infrastructure/ (or db/), and call it through its method.',
    match: (f, lines) =>
      !inDir(f, 'db') && !inDir(f, 'database') && !inDir(f, 'infrastructure') && !f.endsWith('.spec.ts')
        ? grep(lines, /\.(execute|query)\(\s*sql`|sql`\s*(select|update|insert|delete)\b/i)
        : [],
  },
];

// ── Strict DDD rules (added on top of pragmatic) ──────────────────────────────

// Types a controller may legitimately inject without breaking "controllers
// orchestrate use cases": use cases, queries/commands (CQRS), Nest plumbing.
const ALLOWED_CTOR_TYPES =
  /(UseCase|Query|Command|Handler|Bus|Reflector|Logger|ConfigService|PinoLogger)$/;

function constructorParamTypes(lines) {
  // Returns [{ line, type }] for constructor params — naive brace-less scan.
  const out = [];
  const start = lines.findIndex((l) => /constructor\s*\(/.test(l));
  if (start === -1) return out;
  for (let i = start; i < Math.min(start + 30, lines.length); i++) {
    const m = lines[i].match(/:\s*([A-Z][A-Za-z0-9_]*)\s*[,)]?/);
    if (m && !lines[i - 1]?.includes(DISABLE)) out.push({ line: i + 1, type: m[1] });
    if (/\)\s*\{?\s*$/.test(lines[i]) && i > start) break;
  }
  return out;
}

const STRICT = [
  {
    id: 'controller-bypasses-use-case',
    sev: 'med',
    desc: 'Controller injects services directly (strict DDD: controllers orchestrate use cases)',
    fix: 'Introduce a use case class in application/use-cases that wraps this operation, inject it in the controller, and move the service call inside the use case.',
    match: (f, lines) => {
      if (!isController(f)) return [];
      return constructorParamTypes(lines)
        .filter(({ type }) => /Service$/.test(type) && !ALLOWED_CTOR_TYPES.test(type))
        .map(({ line }) => line);
    },
  },
  {
    id: 'repository-without-port',
    sev: 'med',
    desc: 'Repository class does not implement a port/interface (strict DDD: program to the abstraction)',
    fix: 'Declare an interface (e.g. IOrderRepository) in domain/ or application/ports, add `implements` to the class, and inject it via a DI token instead of the concrete class.',
    match: (f, lines) => {
      if (!inDir(f, 'infrastructure') && !/\.repository\.ts$/.test(f)) return [];
      if (f.endsWith('.spec.ts')) return [];
      return grep(lines, /^export class \w*Repository\b(?!.*\bimplements\b)/);
    },
  },
  {
    id: 'entity-outside-domain',
    sev: 'low',
    desc: 'Entity file outside domain/ (strict DDD: domain entities live in domain/, persistence models in infrastructure/persistence)',
    fix: 'If this is a domain entity, move it under domain/entities. If it is an ORM persistence model, move it under infrastructure/persistence and map it to the domain entity in the repository.',
    match: (f, lines) =>
      /\.entity\.ts$/.test(f) && !inDir(f, 'domain') && !f.includes('/persistence/')
        ? [1].filter(() => !lines[0]?.includes(DISABLE))
        : [],
  },
  {
    id: 'missing-bounded-context-layers',
    sev: 'low',
    desc: 'Feature module without domain/ or application/ layers (strict DDD: each bounded context has its skeleton)',
    fix: 'Create domain/ (entities, value objects, ports) and application/ (use cases) inside this module, and migrate its business logic there incrementally.',
    match: (f, lines, ctx) => {
      if (!/\.module\.ts$/.test(f) || f.endsWith('app.module.ts')) return [];
      const dir = f.slice(0, f.lastIndexOf('/'));
      const inModule = [...ctx.files.keys()].filter((p) => p.startsWith(dir + '/'));
      // Only meaningful contexts: has a controller and enough code to matter.
      if (!inModule.some(isController) || inModule.length < 6) return [];
      const hasDomain = inModule.some((p) => p.includes(`${dir}/domain/`));
      const hasApp = inModule.some((p) => p.includes(`${dir}/application/`));
      if (hasDomain && hasApp) return [];
      return [1].filter(() => !lines[0]?.includes(DISABLE));
    },
  },
  {
    id: 'fat-service',
    sev: 'low',
    desc: 'Large service with direct DB access (strict DDD: split into use cases + repository)',
    fix: 'Split this service: each public operation becomes a use case in application/use-cases; the data access moves behind a repository port.',
    match: (f, lines) => {
      if (!/\.service\.ts$/.test(f) || f.endsWith('.spec.ts')) return [];
      if (lines.length <= 250) return [];
      const db = merge(grep(lines, DB_HANDLES), grep(lines, ORM_IMPORTS));
      return db.length ? [db[0]] : [];
    },
  },
];

export function rulesFor(profile) {
  return profile === 'strict' ? [...PRAGMATIC, ...STRICT] : PRAGMATIC;
}

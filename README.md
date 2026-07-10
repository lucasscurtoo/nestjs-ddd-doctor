# nestjs-ddd-doctor 🩺

Zero-dependency architecture check-up for NestJS projects with DDD leanings — in the spirit of [react-doctor](https://react.doctor), but for your API's layer boundaries.

Run it, get a check-up from the botsito 🤖, a graded report of where your architecture is leaking, and a one-keystroke handoff to your AI of choice to fix it:

```
$ npx nestjs-ddd-doctor

        .----.
       ( @  @ )
        \ -- /          nestjs-ddd-doctor
     .--'----'--.       NestJS architecture check-up
    /|    ++    |\
   d |    ++    | b     patient: apps/api/src
     |  .----.  |       profile: pragmatic
     |__|    |__|
        | () |
        '----'

🔴 controller-db — Controller accesses the database directly (move it to a service/repository) (6)
   apps/api/src/whatsapp/bot-config.controller.ts:2
   apps/api/src/whatsapp/whatsapp.controller.ts:18
   ...

🟠 controller-logic — Business logic in controller (dense branching — extract to a service) (1)
   apps/api/src/whatsapp/whatsapp.controller.ts:43

Grade: D   Score: 52/100  (🔴 4 × -10   🟠 2 × -4   🟡 0 × -1)
Needs treatment. Start with the 🔴 findings.

Fix with AI?  [1] Claude Code   [2] Codex   [3] Copy prompt   [enter] skip
```

No install, no dependencies, one `npx`. Node ≥ 20. Colored output on TTYs (respects `NO_COLOR`); plain text when piped. In a monorepo with no `./src` it auto-detects the NestJS source dir by looking for `*.controller.ts` files (e.g. `apps/api/src`).

## Usage

```bash
npx nestjs-ddd-doctor [srcDir] [options]

--profile=pragmatic|strict    # default: pragmatic
--ai=claude|codex|clipboard   # skip the menu, hand findings straight off
--ci                          # no prompts; exit 1 on any 🔴 finding
```

## Profiles

**`pragmatic`** (default) — for teams that want layered architecture without the full ceremony. Checks the boundaries almost every layered NestJS codebase agrees on: controllers stay thin, the domain stays pure, the application layer talks to ports.

**`strict`** — real tactical DDD, the whole thing: controllers orchestrate **use cases** (not services), repositories implement **ports**, domain entities live in `domain/`, persistence models in `infrastructure/persistence`, and every meaningful feature module has its bounded-context skeleton (`domain/` + `application/`).

```bash
npx nestjs-ddd-doctor --profile=strict
```

## Rules

### Pragmatic (always on)

| Rule | Sev | What it catches |
|---|---|---|
| `controller-db` | 🔴 | ORM imports (`drizzle-orm`, `typeorm`, `@prisma/client`, `mongoose`, …), `@InjectRepository`/`@InjectModel`/DB tokens, or local `db/schema` imports inside `*.controller.ts` |
| `controller-fetch` | 🔴 | `fetch(` / `axios.` / `got(` inside a controller — outbound HTTP belongs in infrastructure |
| `domain-purity` | 🔴 | `domain/` files importing `@nestjs/*`, any ORM, or `infrastructure/` — the domain stays plain TypeScript |
| `domain-imports-application` | 🔴 | `domain/` importing from `application/` — dependencies point inward |
| `controller-logic` | 🟠 | More than 5 `if`/`for`/`switch`/`while` in one controller file — that's orchestration, extract a service |
| `application-concrete-infra` | 🟠 | `application/` importing from `infrastructure/` — depend on the port, not the class |
| `handler-io` | 🟠 | `handlers/` doing direct DB/HTTP instead of using their context's repositories |
| `no-forward-ref` | 🟡 | `forwardRef(` — circular modules; rethink the dependency direction |
| `raw-sql-outside-infra` | 🟡 | Raw ``sql` ``/`.query(` outside `db/`, `database/`, `infrastructure/` |

### Strict (added with `--profile=strict`)

| Rule | Sev | What it catches |
|---|---|---|
| `controller-bypasses-use-case` | 🟠 | Controller constructor injecting `*Service` classes — in strict DDD, controllers orchestrate `*UseCase`/`*Query`/`*Command` |
| `repository-without-port` | 🟠 | `class FooRepository` without `implements` — program to the abstraction, inject via DI token |
| `entity-outside-domain` | 🟡 | `*.entity.ts` outside `domain/` (ORM persistence models belong in `infrastructure/persistence`, mapped in the repository) |
| `missing-bounded-context-layers` | 🟡 | Feature module (with a controller and ≥6 files) lacking `domain/` or `application/` |
| `fat-service` | 🟡 | Service >250 lines with direct DB access — split into use cases + a repository port |

Scoring: `100 − 10·🔴 − 4·🟠 − 1·🟡` (floor 0). Grades: A+ ≥98 · A ≥90 · B ≥75 · C ≥60 · D ≥40 · F.

## AI handoff

When there are findings (and you're on a TTY), the doctor offers to hand them off:

- **[1] Claude Code / [2] Codex** — writes `ddd-doctor-report.md` (findings + per-rule fix guidance + ground rules like *"don't change behavior, keep tests green"*) and launches the CLI pointed at it.
- **[3] Copy prompt** — same report, straight to your clipboard, paste it into any AI.

Non-interactive: `--ai=claude`, `--ai=codex` or `--ai=clipboard`. CI: `--ci` disables the menu entirely.

## Config

`./ddd-doctor.config.json`:

```json
{
  "profile": "strict",
  "rules": { "controller-logic": "off" },
  "exempt": ["health.controller.ts", "lock.service.ts"]
}
```

`exempt` entries are path **suffixes**; a matching file is skipped by every rule. For a single justified line:

```ts
// ddd-doctor-disable-next-line
const rows = await this.db.execute(sql`select 1`);
```

## Philosophy

- **Heuristic, not a compiler.** Plain regex over your source. Fast, zero deps, occasionally wrong — that's what the escape hatch is for.
- **Boundaries, not dogma.** Pragmatic mode doesn't demand aggregates or CQRS; strict mode is there when you *do* want the whole tactical toolbox — and the grade tells you honestly how far you are.
- **Convention-driven.** Layers are detected by folder name (`domain/`, `application/`, `infrastructure/`, `handlers/`, `db/`). If your project doesn't use a folder, its rules simply never fire.

## License

MIT

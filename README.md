# nestjs-ddd-doctor 🩺

Zero-dependency architecture linter for NestJS projects with DDD leanings — in the spirit of [react-doctor](https://react.doctor), but for your API's layer boundaries.

Run it, get a scored report of where your architecture is leaking:

```
$ npx nestjs-ddd-doctor apps/api/src

nestjs-ddd-doctor — apps/api/src

🔴 controller-db — Controller accesses the database directly (move it to a service/repository) (6)
   apps/api/src/whatsapp/bot-config.controller.ts:2
   apps/api/src/whatsapp/whatsapp.controller.ts:18
   ...

🟠 controller-logic — Business logic in controller (dense branching — extract to a service) (1)
   apps/api/src/whatsapp/whatsapp.controller.ts:43

🟡 raw-sql-outside-infra — Raw SQL outside db/ and infrastructure/ (move it to a repository) (2)
   apps/api/src/common/guards/auth.guard.ts:32

Score: 29/100  (🔴 6 × -10   🟠 1 × -4   🟡 2 × -1)
```

Exit code is `1` when there is any 🔴 finding — drop it straight into CI.

## Install / run

```bash
npx nestjs-ddd-doctor [srcDir]   # default: ./src
```

No install, no dependencies, one file. Node ≥ 20.

In a monorepo with no `./src`, it auto-detects the NestJS source dir by looking for `*.controller.ts` files (e.g. `apps/api/src`). If several candidates exist it lists them and asks you to pick one.

## Rules

| Rule | Severity | What it catches |
|---|---|---|
| `controller-db` | 🔴 | ORM imports (`drizzle-orm`, `typeorm`, `@prisma/client`, `mongoose`, …), `@InjectRepository`/`@InjectModel`/DB tokens, or local `db/schema` imports inside `*.controller.ts` |
| `controller-fetch` | 🔴 | `fetch(` / `axios.` / `got(` inside a controller — outbound HTTP belongs in infrastructure |
| `domain-purity` | 🔴 | `domain/` files importing `@nestjs/*`, any ORM, or `infrastructure/` — the domain stays plain TypeScript |
| `controller-logic` | 🟠 | More than 5 `if`/`for`/`switch`/`while` in one controller file — that's orchestration, extract a service |
| `application-concrete-infra` | 🟠 | `application/` importing from `infrastructure/` — depend on the port, not the class |
| `handler-io` | 🟠 | `handlers/` doing direct DB/HTTP instead of using their context's repositories |
| `no-forward-ref` | 🟡 | `forwardRef(` — circular modules; rethink the dependency direction |
| `raw-sql-outside-infra` | 🟡 | Raw ``sql` ``/`.query(` outside `db/`, `database/`, `infrastructure/` |

Scoring: `100 − 10·🔴 − 4·🟠 − 1·🟡` (floor 0).

## Escape hatch

Some exceptions are legitimate (a health endpoint pinging the DB, a Postgres advisory-lock service). Silence a single line:

```ts
// ddd-doctor-disable-next-line
const rows = await this.db.execute(sql`select 1`);
```

Or configure exemptions and rule toggles in `./ddd-doctor.config.json`:

```json
{
  "rules": { "controller-logic": "off" },
  "exempt": ["health.controller.ts", "lock.service.ts"]
}
```

`exempt` entries are path **suffixes**; a file matching any of them is skipped by every rule.

## Philosophy

- **Heuristic, not a compiler.** Plain regex over your source. Fast, zero deps, occasionally wrong — that's what the escape hatch is for. If you need AST-grade precision, this is the baseline to grow from.
- **Boundaries, not dogma.** It doesn't demand aggregates, value objects or CQRS. It checks the few boundaries almost every layered NestJS codebase agrees on once it has them: controllers stay thin, the domain stays pure, the application layer talks to ports.
- **Convention-driven.** Layers are detected by folder name (`domain/`, `application/`, `infrastructure/`, `handlers/`, `db/`). If your project doesn't use a folder, its rules simply never fire.

## License

MIT

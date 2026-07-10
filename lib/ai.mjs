// AI handoff: build a fix prompt from the findings and hand it to
// Claude Code / Codex, or copy it to the clipboard.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { dim, bold, purple, green, yellow } from './report.mjs';

export function buildPrompt(findings, { srcLabel, profile, score, gradeLabel }) {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, []);
    byRule.get(f.rule.id).push(f);
  }

  const sections = [...byRule.entries()].map(([id, list]) => {
    const { sev, desc, fix } = list[0].rule;
    const files = list.map((f) => `- ${f.file}:${f.line}`).join('\n');
    return `### ${id} (${sev})\n\n${desc}.\n\n**How to fix:** ${fix}\n\n**Occurrences:**\n${files}`;
  });

  return `# nestjs-ddd-doctor report — fix these architecture violations

Source dir: \`${srcLabel}\` · Profile: ${profile} · Score: ${score}/100 (grade ${gradeLabel})

You are working on a NestJS codebase. The findings below are architecture
boundary violations detected by nestjs-ddd-doctor. Fix them one rule at a
time, with these ground rules:

- **Do not change behavior.** Move code across layers; do not rewrite logic.
- Keep the project's existing conventions (naming, DI style, folder layout).
- Run the project's tests after each rule is addressed; they must stay green.
- If a finding is a justified exception (health checks, advisory locks),
  do not force it — add \`// ddd-doctor-disable-next-line\` above the line
  with a short justification comment instead.
- When done, run \`npx nestjs-ddd-doctor ${srcLabel}\` and confirm the score improved.

## Findings

${sections.join('\n\n')}
`;
}

function copyToClipboard(text) {
  const candidates =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [cmd, args] of candidates) {
    const r = spawnSync(cmd, args, { input: text });
    if (r.status === 0) return true;
  }
  return false;
}

function hasBin(cmd) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd]).status === 0;
}

function launch(cmd, prompt, reportPath) {
  // The report is on disk — pass a short instruction; big prompts as argv are fragile.
  const instruction = `Read ${reportPath} and fix the architecture violations it lists, following its ground rules.`;
  console.log(dim(`\n$ ${cmd} "${instruction}"\n`));
  const r = spawnSync(cmd, [instruction], { stdio: 'inherit' });
  return r.status === 0;
}

export async function offerAiHandoff(findings, meta, { aiFlag, ci }) {
  if (findings.length === 0 || ci) return;

  let choice = aiFlag;
  if (!choice) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `${bold('Fix with AI?')}  ${purple('[1]')} Claude Code   ${purple('[2]')} Codex   ${purple('[3]')} Copy prompt   ${dim('[enter] skip')}  `,
    );
    rl.close();
    choice = { 1: 'claude', 2: 'codex', 3: 'clipboard' }[answer.trim()];
    if (!choice) return;
  }

  const prompt = buildPrompt(findings, meta);
  const reportPath = join(process.cwd(), 'ddd-doctor-report.md');
  writeFileSync(reportPath, prompt);
  console.log(green(`\n📄 Report written to ${reportPath}`));

  if (choice === 'clipboard') {
    if (copyToClipboard(prompt)) console.log(green('📋 Prompt copied to clipboard — paste it into your AI of choice.\n'));
    else console.log(yellow('Could not access the clipboard — the prompt is in the report file above.\n'));
    return;
  }

  const bin = choice; // 'claude' | 'codex'
  if (!hasBin(bin)) {
    console.log(yellow(`'${bin}' CLI not found in PATH — the prompt is in the report file above.\n`));
    return;
  }
  launch(bin, prompt, reportPath);
}

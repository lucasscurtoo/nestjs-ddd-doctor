// Report rendering: colors, mascot banner, grade, verdict.

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (txt) => (useColor ? `\x1b[${code}m${txt}\x1b[0m` : txt);

export const purple = paint('38;5;141');
export const dim = paint('2');
export const bold = paint('1');
export const red = paint('31');
export const orange = paint('38;5;208');
export const yellow = paint('33');
export const green = paint('32');
export const cyan = paint('36');

export const SEV = { high: '🔴', med: '🟠', low: '🟡' };
const SEV_PAINT = { high: red, med: orange, low: yellow };

const MASCOT = String.raw`
        .----.
       ( @  @ )
        \ -- /
     .--'----'--.
    /|    ++    |\
   d |    ++    | b
     |  .----.  |
     |__|    |__|
        | () |
        '----'
`;

export function banner(srcLabel, profile, structure) {
  let structLine = '';
  if (structure?.modules > 0) {
    const shaped = Math.min(structure.withDomain, structure.withApplication);
    structLine =
      shaped > 0
        ? `  ${dim('structure:')} ${green(`${shaped}/${structure.modules} modules DDD-shaped`)} ${dim('(domain/ + application/)')}`
        : `  ${dim('structure:')} ${structure.modules} feature modules, no DDD layers yet`;
  }
  const art = MASCOT.split('\n').slice(1, -1);
  const info = [
    '',
    '',
    `  ${bold(purple('nestjs-ddd-doctor'))}`,
    `  ${dim('NestJS architecture check-up')}`,
    '',
    `  ${dim('patient:')} ${srcLabel}`,
    `  ${dim('profile:')} ${profile === 'strict' ? cyan('strict DDD') : 'pragmatic'}`,
    structLine,
  ];
  console.log('');
  for (let i = 0; i < art.length; i++) {
    console.log(purple(art[i].padEnd(22)) + (info[i] ?? ''));
  }
  console.log('');
}

export function grade(score) {
  if (score >= 98) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function gradePaint(score) {
  return score >= 90 ? green : score >= 60 ? yellow : score >= 40 ? orange : red;
}

export function verdict(score) {
  if (score >= 90) return green('Clean bill of health. Keep it up.');
  if (score >= 70) return yellow('Minor symptoms — worth a look.');
  if (score >= 40) return orange('Needs treatment. Start with the 🔴 findings.');
  return red('Urgent care required. The 🔴 findings are bleeding layers.');
}

export function printReport(findings, score) {
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, []);
    byRule.get(f.rule.id).push(f);
  }

  for (const [id, list] of byRule) {
    const { sev, desc } = list[0].rule;
    console.log(`${SEV[sev]} ${SEV_PAINT[sev](bold(id))} ${dim('—')} ${desc} ${dim(`(${list.length})`)}`);
    for (const f of list) console.log(dim(`   ${f.file}:${f.line}`));
    console.log('');
  }

  const counts = { high: 0, med: 0, low: 0 };
  for (const f of findings) counts[f.rule.sev]++;

  if (findings.length === 0) console.log(`${green('✅ No findings.')}\n`);

  const gp = gradePaint(score);
  console.log(
    `${bold('Grade:')} ${gp(bold(grade(score)))}   ${bold('Score:')} ${gp(bold(`${score}/100`))}  ` +
      dim(`(🔴 ${counts.high}   🟠 ${counts.med}   🟡 ${counts.low} — per-rule log-damped penalty)`),
  );
  console.log(`${verdict(score)}`);

  // When one rule drives most of the damage, say so: it's one systematic
  // decision to fix, not N scattered problems.
  const penalties = [...byRule.entries()].map(([id, list]) => ({
    id,
    p: rulePenalty(list[0].rule.sev, list.length),
    count: list.length,
  }));
  const total = penalties.reduce((a, b) => a + b.p, 0);
  const top = penalties.sort((a, b) => b.p - a.p)[0];
  if (top && total > 0 && top.p / total > 0.45 && top.count >= 10) {
    console.log(
      cyan(`💡 ${top.id} (${top.count}×) drives most of the score — likely ONE systematic pattern; one refactor decision fixes it.`),
    );
  }
  console.log('');
}

// Scoring: per-RULE penalty with logarithmic damping + a cap.
//
//   penalty(rule) = weight × (1 + log2(count)), capped
//   weights: 🔴 10 / 🟠 4 / 🟡 1 · caps: 🔴 30 / 🟠 18 / 🟡 8
//
// Rationale: 200 hits of one rule are usually ONE systematic decision
// (e.g. "use cases inject the concrete repo"), not 200 independent sins.
// Linear scoring nukes any large codebase to 0 and stops differentiating;
// log damping keeps the score meaningful while still punishing spread.
const SEV_WEIGHT = { high: 10, med: 4, low: 1 };
const SEV_CAP = { high: 30, med: 18, low: 8 };

export function rulePenalty(sev, count) {
  if (count === 0) return 0;
  return Math.min(SEV_CAP[sev], SEV_WEIGHT[sev] * (1 + Math.log2(count)));
}

export function computeScore(findings) {
  const byRule = new Map();
  for (const f of findings) {
    byRule.set(f.rule.id, { sev: f.rule.sev, count: (byRule.get(f.rule.id)?.count ?? 0) + 1 });
  }
  let penalty = 0;
  for (const { sev, count } of byRule.values()) penalty += rulePenalty(sev, count);
  return Math.max(0, Math.round(100 - penalty));
}

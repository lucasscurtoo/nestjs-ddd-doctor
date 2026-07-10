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

export function banner(srcLabel, profile) {
  const art = MASCOT.split('\n').slice(1, -1);
  const info = [
    '',
    '',
    `  ${bold(purple('nestjs-ddd-doctor'))}`,
    `  ${dim('NestJS architecture check-up')}`,
    '',
    `  ${dim('patient:')} ${srcLabel}`,
    `  ${dim('profile:')} ${profile === 'strict' ? cyan('strict DDD') : 'pragmatic'}`,
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
      dim(`(🔴 ${counts.high} × -10   🟠 ${counts.med} × -4   🟡 ${counts.low} × -1)`),
  );
  console.log(`${verdict(score)}\n`);
}

export function computeScore(findings) {
  const counts = { high: 0, med: 0, low: 0 };
  for (const f of findings) counts[f.rule.sev]++;
  return Math.max(0, 100 - counts.high * 10 - counts.med * 4 - counts.low * 1);
}

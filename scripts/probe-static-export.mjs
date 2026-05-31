#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const reportPath = resolve('artifacts/static-export-probe.md');
const logPath = resolve('artifacts/static-export-probe.log');

await mkdir(resolve('artifacts'), { recursive: true });

const startedAt = new Date().toISOString();
const { status, output } = await run('npx', ['next', 'build'], {
  ...process.env,
  NOETICA_STATIC_EXPORT: '1'
});
const finishedAt = new Date().toISOString();
const passed = status === 0;

await writeFile(logPath, output);
await writeFile(
  reportPath,
  [
    '# Noetica Static Export Probe',
    '',
    `Started: ${startedAt}`,
    `Finished: ${finishedAt}`,
    `Status: ${passed ? 'pass' : 'fail'}`,
    `Exit code: ${status}`,
    '',
    '## Interpretation',
    '',
    passed
      ? 'The current UI can complete `next build` with `output: export` enabled. This does not yet mean Tauri should switch to static output; it means the next tranche can test `frontendDist` against the exported `out` directory.'
      : 'The current app cannot complete `next build` with `output: export` enabled. The log artifact identifies the first static-export blocker that must be assigned to UI refactor, local service, SourceOS endpoint, Agent Machine endpoint, or model-router/policy/memory work.',
    '',
    '## Command',
    '',
    '```bash',
    'NOETICA_STATIC_EXPORT=1 npx next build',
    '```',
    '',
    '## Log tail',
    '',
    '```text',
    tail(output, 120),
    '```',
    ''
  ].join('\n')
);

console.log(`static-export-probe-status=${passed ? 'pass' : 'fail'}`);
console.log(`static-export-probe-exit=${status}`);
console.log(`static-export-probe-report=${reportPath}`);
console.log('--- static-export-probe-tail ---');
console.log(tail(output, 80));
console.log('--- end-static-export-probe-tail ---');

process.exit(0);

function run(command, args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { env, shell: false });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', (status) => {
      resolveRun({ status: status ?? 1, output });
    });
  });
}

function tail(text, maxLines) {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-maxLines).join('\n');
}

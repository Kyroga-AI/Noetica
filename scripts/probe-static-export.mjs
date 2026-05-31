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
const dynamicApiRoutes = findDynamicApiRoutes(output);
const classification = !passed
  ? 'static-export-fail'
  : dynamicApiRoutes.length > 0
    ? 'static-ui-pass-with-dynamic-api-caveat'
    : 'static-ui-pass';

await writeFile(logPath, output);
await writeFile(
  reportPath,
  [
    '# Noetica Static Export Probe',
    '',
    `Started: ${startedAt}`,
    `Finished: ${finishedAt}`,
    `Status: ${passed ? 'pass' : 'fail'}`,
    `Classification: ${classification}`,
    `Exit code: ${status}`,
    '',
    '## Dynamic API routes observed',
    '',
    dynamicApiRoutes.length > 0 ? dynamicApiRoutes.map((route) => `- ${route}`).join('\n') : 'None observed.',
    '',
    '## Interpretation',
    '',
    interpret(classification),
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
console.log(`static-export-probe-classification=${classification}`);
console.log(`static-export-probe-exit=${status}`);
console.log(`static-export-probe-report=${reportPath}`);
if (dynamicApiRoutes.length > 0) {
  console.log(`static-export-dynamic-api-routes=${dynamicApiRoutes.join(',')}`);
}
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

function findDynamicApiRoutes(output) {
  const routes = new Set();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^ƒ\s+(\/api\/\S+)/);
    if (match) routes.add(match[1]);
  }
  return [...routes].sort();
}

function interpret(classification) {
  if (classification === 'static-export-fail') {
    return 'Static export failed. The log artifact identifies the first blocker to assign to UI refactor, local service, SourceOS endpoint, Agent Machine endpoint, or model-router/policy/memory work.';
  }
  if (classification === 'static-ui-pass-with-dynamic-api-caveat') {
    return 'The root UI can complete static export, but dynamic API routes are still present. Tauri can load the static UI from `out`, while chat/API execution remains service-boundary work and must not be treated as bundled static authority.';
  }
  return 'The current app completed static export and no dynamic API routes were observed in the build output.';
}

function tail(text, maxLines) {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-maxLines).join('\n');
}

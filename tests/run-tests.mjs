#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APPLY = process.env.APPLY_PATCH || path.resolve('bin/apply_patch');

function die(msg) {
  process.stderr.write(msg + '\n');
  process.exit(1);
}

function run(cmd, args, input, cwd) {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', cwd });
  return { code: r.status ?? 0, out: r.stdout || '', err: r.stderr || '' };
}

function assert(cond, msg) {
  if (!cond) die('ASSERT: ' + msg);
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentpatch-test-'));
}

function read(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}

function apply(patch, cwd, args = []) {
  // Use bash to execute the apply_patch script path reliably, even if it lacks +x.
  const r = run('bash', [APPLY, ...args], patch, cwd);
  return r;
}

function testAddFile() {
  const cwd = mkTmp();
  const patch = `*** Begin Patch\n*** Add File: a.txt\n+hello\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `add file exit code (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'hello\n', 'add file content');
}

function testAddFileNoPlus() {
  const cwd = mkTmp();
  const patch = `*** Begin Patch\n*** Add File: a.txt\nhello\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `add file no plus exit code (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'hello\n', 'add file no plus content');
}

function testUpdateExact() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'one\ntwo\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ @@\n-one\n+ONE\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `update exact exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'ONE\ntwo\n', 'update exact content');
}

function testUpdateFuzzyWhitespace() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'one   two\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ @@\n-one two\n+ONE TWO\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `update fuzzy exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'ONE TWO\n', 'update fuzzy content');
}

function testAnchorBottom() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'x\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ at:bottom @@\n+y\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor bottom exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'x\ny\n', 'anchor bottom content');
}

function testIdempotent() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'x\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ at:bottom @@\n+y\n*** End Patch\n`;
  const r1 = apply(patch, cwd);
  const r2 = apply(patch, cwd);
  assert(r1.code === 0 && r2.code === 0, 'idempotent exit');
  assert(read(path.join(cwd, 'a.txt')) === 'x\ny\n', 'idempotent content');
}

function testDeleteRequiresFlag() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'x\n');
  const patch = `*** Begin Patch\n*** Delete File: a.txt\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code !== 0, 'delete should fail without flag');
  assert(fs.existsSync(path.join(cwd, 'a.txt')), 'file should still exist');

  const r2 = apply(patch, cwd, ['--allow-delete']);
  assert(r2.code === 0, `delete with flag exit (stderr=${JSON.stringify(r2.err)})`);
  assert(!fs.existsSync(path.join(cwd, 'a.txt')), 'file deleted');
}

function testRenameRequiresFlag() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'x\n');
  const patch = `*** Begin Patch\n*** Rename File: a.txt -> b.txt\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code !== 0, 'rename should fail without flag');
  assert(fs.existsSync(path.join(cwd, 'a.txt')), 'a exists');

  const r2 = apply(patch, cwd, ['--allow-rename']);
  assert(r2.code === 0, `rename with flag exit (stderr=${JSON.stringify(r2.err)})`);
  assert(!fs.existsSync(path.join(cwd, 'a.txt')) && fs.existsSync(path.join(cwd, 'b.txt')), 'renamed');
}

const tests = [
  testAddFile,
  testAddFileNoPlus,
  testUpdateExact,
  testUpdateFuzzyWhitespace,
  testAnchorBottom,
  testIdempotent,
  testDeleteRequiresFlag,
  testRenameRequiresFlag
];

let passed = 0;
for (const t of tests) {
  const name = t.name;
  try {
    t();
    process.stdout.write(`ok - ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`not ok - ${name}\n`);
    process.stderr.write(String(e?.stack || e) + '\n');
    process.exit(1);
  }
}

process.stdout.write(`# passed ${passed}/${tests.length}\n`);

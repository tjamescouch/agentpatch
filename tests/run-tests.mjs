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
  const r = run('bash', [APPLY, ...args], patch, cwd);
  return r;
}

// ── Original tests ──────────────────────────────────────────────────────

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

// ── Context lines ───────────────────────────────────────────────────────

function testContextLines() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'aaa\nbbb\nccc\nddd\n');
  // Use context (space-prefix) to anchor the change
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    ' aaa',
    '-bbb',
    '+BBB',
    ' ccc',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `context lines exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'aaa\nBBB\nccc\nddd\n', 'context lines content');
}

// ── Multi-hunk update ───────────────────────────────────────────────────

function testMultiHunkUpdate() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'aaa\nbbb\nccc\nddd\neee\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-aaa',
    '+AAA',
    '@@ @@',
    '-eee',
    '+EEE',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `multi-hunk exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'AAA\nbbb\nccc\nddd\nEEE\n', 'multi-hunk content');
}

// ── Regex anchors ───────────────────────────────────────────────────────

function testAnchorBefore() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'alpha\nbeta\ngamma\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ before:/gamma/ @@',
    '+inserted',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor before exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'alpha\nbeta\ninserted\ngamma\n', 'anchor before content');
}

function testAnchorAfter() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'alpha\nbeta\ngamma\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ after:/alpha/ @@',
    '+inserted',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor after exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'alpha\ninserted\nbeta\ngamma\n', 'anchor after content');
}

// ── at:top anchor ───────────────────────────────────────────────────────

function testAnchorTopBasic() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'body\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ at:top @@',
    '+header',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor top exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'header\nbody\n', 'anchor top content');
}

function testAnchorTopSkipsShebangAndImports() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.ts'), '#!/usr/bin/env node\nimport fs from "fs";\n\nconst x = 1;\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.ts',
    '@@ at:top @@',
    '+import path from "path";',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor top shebang exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.ts'));
  // The inserted line should come after the shebang+import block
  const lines = content.split('\n');
  const idx = lines.indexOf('import path from "path";');
  assert(idx >= 2, `inserted after shebang+imports (got idx=${idx})`);
}

// ── Nested directory creation ───────────────────────────────────────────

function testAddFileNestedDir() {
  const cwd = mkTmp();
  const patch = [
    '*** Begin Patch',
    '*** Add File: deep/nested/dir/file.txt',
    '+content here',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `nested dir add exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'deep/nested/dir/file.txt')) === 'content here\n', 'nested dir add content');
}

// ── Multi-op patch ──────────────────────────────────────────────────────

function testMultiOpPatch() {
  const cwd = mkTmp();
  write(path.join(cwd, 'existing.txt'), 'old\n');
  const patch = [
    '*** Begin Patch',
    '*** Add File: new.txt',
    '+new file',
    '*** Update File: existing.txt',
    '@@ @@',
    '-old',
    '+updated',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `multi-op exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'new.txt')) === 'new file\n', 'multi-op new file');
  assert(read(path.join(cwd, 'existing.txt')) === 'updated\n', 'multi-op update');
}

// ── Code fence stripping ────────────────────────────────────────────────

function testCodeFenceStripping() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'hello\n');
  const patch = [
    '```diff',
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-hello',
    '+world',
    '*** End Patch',
    '```',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `code fence exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'world\n', 'code fence content');
}

// ── Error: update non-existent file ─────────────────────────────────────

function testUpdateNonExistentFails() {
  const cwd = mkTmp();
  const patch = [
    '*** Begin Patch',
    '*** Update File: nope.txt',
    '@@ @@',
    '-x',
    '+y',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code !== 0, 'update nonexistent should fail');
}

// ── Error: hunk not found, no anchor ────────────────────────────────────

function testHunkNotFoundFails() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'aaa\nbbb\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-zzz',
    '+yyy',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code !== 0, 'hunk not found should fail');
  // File should be unchanged
  assert(read(path.join(cwd, 'a.txt')) === 'aaa\nbbb\n', 'file unchanged after failed hunk');
}

// ── Rename with "to" syntax ─────────────────────────────────────────────

function testRenameToSyntax() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'content\n');
  const patch = [
    '*** Begin Patch',
    '*** Rename File: a.txt to b.txt',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd, ['--allow-rename']);
  assert(r.code === 0, `rename to syntax exit (stderr=${JSON.stringify(r.err)})`);
  assert(!fs.existsSync(path.join(cwd, 'a.txt')), 'old file gone');
  assert(read(path.join(cwd, 'b.txt')) === 'content\n', 'renamed file content');
}

// ── Rename to nested path ───────────────────────────────────────────────

function testRenameToNestedDir() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'moved\n');
  const patch = [
    '*** Begin Patch',
    '*** Rename File: a.txt -> sub/dir/b.txt',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd, ['--allow-rename']);
  assert(r.code === 0, `rename nested exit (stderr=${JSON.stringify(r.err)})`);
  assert(!fs.existsSync(path.join(cwd, 'a.txt')), 'old file gone');
  assert(read(path.join(cwd, 'sub/dir/b.txt')) === 'moved\n', 'renamed to nested path');
}

// ── Rename non-existent source ──────────────────────────────────────────

function testRenameNonExistentFails() {
  const cwd = mkTmp();
  const patch = [
    '*** Begin Patch',
    '*** Rename File: nope.txt -> b.txt',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd, ['--allow-rename']);
  assert(r.code !== 0, 'rename nonexistent source should fail');
}

// ── Delete non-existent file ────────────────────────────────────────────

function testDeleteNonExistentSucceeds() {
  const cwd = mkTmp();
  const patch = [
    '*** Begin Patch',
    '*** Delete File: nope.txt',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd, ['--allow-delete']);
  // Should succeed — file already doesn't exist
  assert(r.code === 0, `delete nonexistent exit (stderr=${JSON.stringify(r.err)})`);
}

// ── Dry run ─────────────────────────────────────────────────────────────

function testDryRunNoWrite() {
  const cwd = mkTmp();
  const patch = [
    '*** Begin Patch',
    '*** Add File: should-not-exist.txt',
    '+nope',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd, ['--dry-run']);
  assert(r.code === 0, `dry run exit (stderr=${JSON.stringify(r.err)})`);
  assert(!fs.existsSync(path.join(cwd, 'should-not-exist.txt')), 'dry run should not create file');
}

function testDryRunUpdateNoWrite() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-old',
    '+new',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd, ['--dry-run']);
  assert(r.code === 0, `dry run update exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'old\n', 'dry run should not modify file');
}

// ── Backup creation ─────────────────────────────────────────────────────

function testBackupCreated() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'original\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-original',
    '+modified',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `backup exit (stderr=${JSON.stringify(r.err)})`);
  const files = fs.readdirSync(cwd);
  const bakFiles = files.filter((f) => f.startsWith('a.txt.bak.'));
  assert(bakFiles.length === 1, `expected 1 backup file, got ${bakFiles.length}: ${bakFiles}`);
  assert(read(path.join(cwd, bakFiles[0])) === 'original\n', 'backup has original content');
}

// ── Fuzzy match with tabs ───────────────────────────────────────────────

function testFuzzyMatchTabs() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), '\tone\ttwo\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '- one two',
    '+ONE TWO',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `fuzzy tabs exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'ONE TWO\n', 'fuzzy tabs content');
}

// ── Multi-line replace ──────────────────────────────────────────────────

function testMultiLineReplace() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'aaa\nbbb\nccc\nddd\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-bbb',
    '-ccc',
    '+BBB',
    '+CCC',
    '+EXTRA',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `multi-line replace exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'aaa\nBBB\nCCC\nEXTRA\nddd\n', 'multi-line replace content');
}

// ── Pure insertion (no minus lines, no anchor → falls back to top) ─────

function testPureInsertionFallback() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'body\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '+inserted',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `pure insertion exit (stderr=${JSON.stringify(r.err)})`);
  // Falls back to insertTopStrategy which inserts at line 0 for a plain file
  const content = read(path.join(cwd, 'a.txt'));
  assert(content.includes('inserted'), 'pure insertion content present');
}

// ── Patch without Begin/End wrapper ─────────────────────────────────────

function testPatchWithoutBeginEnd() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old\n');
  const patch = [
    '*** Update File: a.txt',
    '@@ @@',
    '-old',
    '+new',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `no begin/end exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'new\n', 'no begin/end content');
}

// ── Add file overwrites existing ────────────────────────────────────────

function testAddFileOverwritesExisting() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old content\n');
  const patch = [
    '*** Begin Patch',
    '*** Add File: a.txt',
    '+new content',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `add overwrites exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'new content\n', 'add overwrites content');
}

// ── Add file with multi-line content ────────────────────────────────────

function testAddFileMultiLine() {
  const cwd = mkTmp();
  const patch = [
    '*** Begin Patch',
    '*** Add File: multi.txt',
    '+line one',
    '+line two',
    '+line three',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `add multi-line exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'multi.txt')) === 'line one\nline two\nline three\n', 'add multi-line content');
}

// ── Unknown arg fails ───────────────────────────────────────────────────

function testUnknownArgFails() {
  const cwd = mkTmp();
  const patch = '*** Begin Patch\n*** Add File: a.txt\n+x\n*** End Patch\n';
  const r = apply(patch, cwd, ['--bogus']);
  assert(r.code !== 0, 'unknown arg should fail');
}

// ── Empty patch fails ───────────────────────────────────────────────────

function testEmptyPatchFails() {
  const cwd = mkTmp();
  const r = apply('nothing useful here\n', cwd);
  assert(r.code !== 0, 'empty patch should fail');
}

// ── Idempotent update (exact match) ─────────────────────────────────────

function testIdempotentExactUpdate() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'aaa\nbbb\nccc\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-bbb',
    '+BBB',
    '*** End Patch',
    ''
  ].join('\n');
  apply(patch, cwd);
  assert(read(path.join(cwd, 'a.txt')) === 'aaa\nBBB\nccc\n', 'first apply');
  // Second apply — plus block already present → idempotent
  const r2 = apply(patch, cwd);
  assert(r2.code === 0, 'idempotent re-apply should succeed');
  assert(read(path.join(cwd, 'a.txt')) === 'aaa\nBBB\nccc\n', 'idempotent, no double apply');
}

// ── Regex anchor with special chars ─────────────────────────────────────

function testAnchorRegexSpecialChars() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'function foo() {\n  return 1;\n}\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ after:/function foo/ @@',
    '+  // added comment',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `regex anchor exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.txt'));
  const lines = content.split('\n');
  assert(lines[1] === '  // added comment', 'regex anchor inserted after match');
}

// ── Windows-style line endings in source ────────────────────────────────

function testWindowsLineEndings() {
  const cwd = mkTmp();
  // Write file with \r\n endings
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\r\ntwo\r\nthree\r\n');
  const patch = [
    '*** Begin Patch',
    '*** Update File: a.txt',
    '@@ @@',
    '-two',
    '+TWO',
    '*** End Patch',
    ''
  ].join('\n');
  const r = apply(patch, cwd);
  assert(r.code === 0, `windows endings exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.txt'));
  assert(content.includes('TWO'), 'windows endings updated');
}

// ── All tests ───────────────────────────────────────────────────────────

const tests = [
  // Original 8
  testAddFile,
  testAddFileNoPlus,
  testUpdateExact,
  testUpdateFuzzyWhitespace,
  testAnchorBottom,
  testIdempotent,
  testDeleteRequiresFlag,
  testRenameRequiresFlag,
  // New tests
  testContextLines,
  testMultiHunkUpdate,
  testAnchorBefore,
  testAnchorAfter,
  testAnchorTopBasic,
  testAnchorTopSkipsShebangAndImports,
  testAddFileNestedDir,
  testMultiOpPatch,
  testCodeFenceStripping,
  testUpdateNonExistentFails,
  testHunkNotFoundFails,
  testRenameToSyntax,
  testRenameToNestedDir,
  testRenameNonExistentFails,
  testDeleteNonExistentSucceeds,
  testDryRunNoWrite,
  testDryRunUpdateNoWrite,
  testBackupCreated,
  testFuzzyMatchTabs,
  testMultiLineReplace,
  testPureInsertionFallback,
  testPatchWithoutBeginEnd,
  testAddFileOverwritesExisting,
  testAddFileMultiLine,
  testUnknownArgFails,
  testEmptyPatchFails,
  testIdempotentExactUpdate,
  testAnchorRegexSpecialChars,
  testWindowsLineEndings,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  const name = t.name;
  try {
    t();
    process.stdout.write(`ok - ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`not ok - ${name}\n`);
    process.stderr.write(String(e?.stack || e) + '\n');
    failed++;
  }
}

process.stdout.write(`\n# ${passed}/${tests.length} passed`);
if (failed) process.stdout.write(`, ${failed} failed`);
process.stdout.write('\n');
if (failed) process.exit(1);

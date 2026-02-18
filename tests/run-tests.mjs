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

// ── Original tests ──────────────────────────────────────────────────

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

// ── New tests: Anchors ──────────────────────────────────────────────

function testAnchorTop() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'first\nsecond\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ at:top @@\n+zeroth\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor top exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'zeroth\nfirst\nsecond\n', 'anchor top content');
}

function testAnchorTopSkipsShebang() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.sh'), '#!/bin/bash\necho hello\n');
  const patch = `*** Begin Patch\n*** Update File: a.sh\n@@ at:top @@\n+# inserted\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor top shebang exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.sh'));
  assert(content.startsWith('#!/bin/bash\n'), 'shebang preserved at top');
  assert(content.includes('# inserted'), 'insertion present');
}

function testAnchorTopSkipsBlockComment() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.js'), '/*\n * License\n */\n\nconst x = 1;\n');
  const patch = `*** Begin Patch\n*** Update File: a.js\n@@ at:top @@\n+const DEBUG = true;\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor top block comment exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.js'));
  // Should NOT insert inside the block comment
  assert(!content.startsWith('/*\nconst DEBUG'), 'must not insert inside block comment');
  assert(content.includes('const DEBUG = true;'), 'insertion present');
  // The block comment should remain intact
  assert(content.indexOf('*/') < content.indexOf('const DEBUG'), 'inserted after block comment');
}

function testAnchorTopSkipsImports() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.js'), "import { foo } from 'bar';\n\nfunction main() {}\n");
  const patch = `*** Begin Patch\n*** Update File: a.js\n@@ at:top @@\n+const X = 1;\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor top imports exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.js'));
  assert(content.indexOf('import') < content.indexOf('const X'), 'inserted after imports');
}

function testAnchorBefore() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'alpha\nbeta\ngamma\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ before:/beta/ @@\n+inserted\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor before exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'alpha\ninserted\nbeta\ngamma\n', 'anchor before content');
}

function testAnchorAfter() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'alpha\nbeta\ngamma\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ after:/beta/ @@\n+inserted\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `anchor after exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'alpha\nbeta\ninserted\ngamma\n', 'anchor after content');
}

// ── New tests: Context lines ────────────────────────────────────────

function testContextLines() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  // Context lines (space-prefixed) anchor the hunk; only -/+ lines change
  const patch = `*** Begin Patch
*** Update File: a.txt
@@ @@
 one
 two
-three
+THREE
 four
*** End Patch
`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `context lines exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'one\ntwo\nTHREE\nfour\n', 'context lines content');
}

function testContextLinesAmbiguous() {
  // When a pattern appears twice, context lines disambiguate
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'x\nfoo\nx\nfoo\ny\n');
  const patch = `*** Begin Patch
*** Update File: a.txt
@@ @@
 x
-foo
+FOO
 y
*** End Patch
`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `context ambiguous exit (stderr=${JSON.stringify(r.err)})`);
  const content = read(path.join(cwd, 'a.txt'));
  // Should change the second "foo" (the one between x and y), not the first
  assert(content === 'x\nfoo\nx\nFOO\ny\n', 'context disambiguated correctly');
}

// ── New tests: Multi-hunk ───────────────────────────────────────────

function testMultiHunkSameFile() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'aaa\nbbb\nccc\nddd\neee\n');
  const patch = `*** Begin Patch
*** Update File: a.txt
@@ @@
-aaa
+AAA
@@ @@
-eee
+EEE
*** End Patch
`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `multi-hunk exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'AAA\nbbb\nccc\nddd\nEEE\n', 'multi-hunk content');
}

// ── New tests: Multi-file ───────────────────────────────────────────

function testMultiFile() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old-a\n');
  write(path.join(cwd, 'b.txt'), 'old-b\n');
  const patch = `*** Begin Patch
*** Update File: a.txt
@@ @@
-old-a
+new-a
*** Update File: b.txt
@@ @@
-old-b
+new-b
*** End Patch
`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `multi-file exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'new-a\n', 'multi-file a');
  assert(read(path.join(cwd, 'b.txt')) === 'new-b\n', 'multi-file b');
}

function testAddAndUpdate() {
  const cwd = mkTmp();
  write(path.join(cwd, 'existing.txt'), 'old\n');
  const patch = `*** Begin Patch
*** Add File: new.txt
+brand new
*** Update File: existing.txt
@@ @@
-old
+updated
*** End Patch
`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `add+update exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'new.txt')) === 'brand new\n', 'add+update new file');
  assert(read(path.join(cwd, 'existing.txt')) === 'updated\n', 'add+update existing');
}

// ── New tests: Error paths ──────────────────────────────────────────

function testUpdateMissingFile() {
  const cwd = mkTmp();
  const patch = `*** Begin Patch\n*** Update File: nonexistent.txt\n@@ @@\n-old\n+new\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code !== 0, 'update missing file should fail');
}

function testHunkNotFound() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'apple\nbanana\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ @@\n-cherry\n+CHERRY\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code !== 0, 'hunk not found should fail');
  // File should be unchanged
  assert(read(path.join(cwd, 'a.txt')) === 'apple\nbanana\n', 'file unchanged after failed hunk');
}

function testRenameMissingSource() {
  const cwd = mkTmp();
  const patch = `*** Begin Patch\n*** Rename File: ghost.txt -> new.txt\n*** End Patch\n`;
  const r = apply(patch, cwd, ['--allow-rename']);
  assert(r.code !== 0, 'rename missing source should fail');
}

function testDryRun() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ @@\n-old\n+new\n*** End Patch\n`;
  const r = apply(patch, cwd, ['--dry-run', '--verbose']);
  assert(r.code === 0, `dry-run exit (stderr=${JSON.stringify(r.err)})`);
  // File should NOT have changed
  assert(read(path.join(cwd, 'a.txt')) === 'old\n', 'dry-run should not modify file');
}

// ── New tests: Nested directories ───────────────────────────────────

function testAddFileNestedDir() {
  const cwd = mkTmp();
  const patch = `*** Begin Patch\n*** Add File: deep/nested/dir/file.txt\n+content\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `nested dir add exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'deep/nested/dir/file.txt')) === 'content\n', 'nested dir content');
}

// ── New tests: Idempotence edge cases ───────────────────────────────

function testIdempotentUpdate() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'alpha\nbeta\n');
  const patch = `*** Begin Patch\n*** Update File: a.txt\n@@ @@\n-alpha\n+ALPHA\n*** End Patch\n`;
  apply(patch, cwd);
  assert(read(path.join(cwd, 'a.txt')) === 'ALPHA\nbeta\n', 'first apply');
  // Second apply — the + block already exists, should be idempotent
  const r2 = apply(patch, cwd);
  assert(r2.code === 0, 'idempotent update should succeed');
  assert(read(path.join(cwd, 'a.txt')) === 'ALPHA\nbeta\n', 'idempotent update unchanged');
}

function testAddFileOverwrite() {
  // Adding a file that already exists should overwrite (not error)
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old content\n');
  const patch = `*** Begin Patch\n*** Add File: a.txt\n+new content\n*** End Patch\n`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `add overwrite exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'new content\n', 'add overwrites existing');
}

// ── New tests: Code fences stripped ─────────────────────────────────

function testCodeFencesStripped() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'old\n');
  const patch = '```diff\n*** Begin Patch\n*** Update File: a.txt\n@@ @@\n-old\n+new\n*** End Patch\n```\n';
  const r = apply(patch, cwd);
  assert(r.code === 0, `code fences exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'new\n', 'code fences stripped content');
}

// ── New tests: Multi-line additions ─────────────────────────────────

function testMultiLineAdd() {
  const cwd = mkTmp();
  write(path.join(cwd, 'a.txt'), 'before\nafter\n');
  const patch = `*** Begin Patch
*** Update File: a.txt
@@ after:/before/ @@
+line1
+line2
+line3
*** End Patch
`;
  const r = apply(patch, cwd);
  assert(r.code === 0, `multi-line add exit (stderr=${JSON.stringify(r.err)})`);
  assert(read(path.join(cwd, 'a.txt')) === 'before\nline1\nline2\nline3\nafter\n', 'multi-line add content');
}

// ── Test registry ───────────────────────────────────────────────────

const tests = [
  // Original
  testAddFile,
  testAddFileNoPlus,
  testUpdateExact,
  testUpdateFuzzyWhitespace,
  testAnchorBottom,
  testIdempotent,
  testDeleteRequiresFlag,
  testRenameRequiresFlag,
  // Anchors
  testAnchorTop,
  testAnchorTopSkipsShebang,
  testAnchorTopSkipsBlockComment,
  testAnchorTopSkipsImports,
  testAnchorBefore,
  testAnchorAfter,
  // Context lines
  testContextLines,
  testContextLinesAmbiguous,
  // Multi-hunk & multi-file
  testMultiHunkSameFile,
  testMultiFile,
  testAddAndUpdate,
  // Error paths
  testUpdateMissingFile,
  testHunkNotFound,
  testRenameMissingSource,
  testDryRun,
  // Edge cases
  testAddFileNestedDir,
  testIdempotentUpdate,
  testAddFileOverwrite,
  testCodeFencesStripped,
  testMultiLineAdd,
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

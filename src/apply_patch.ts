#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

// Pre-flight validation: check all ops can succeed before writing anything.
// Returns a map of filePath -> error string for any op that would fail.
function validateOps(
  ops: Op[],
  allowDelete: boolean,
  allowRename: boolean,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const op of ops) {
    if (op.op === 'update') {
      if (!fs.existsSync(op.filePath)) {
        errors[op.filePath] = `apply_patch: update failed, file not found: ${op.filePath}`;
      }
    } else if (op.op === 'delete') {
      if (!allowDelete) {
        errors[op.filePath] = 'apply_patch: Delete File requires --allow-delete';
      }
    } else if (op.op === 'rename') {
      if (!allowRename) {
        errors[op.from] = 'apply_patch: Rename File requires --allow-rename';
      } else if (!fs.existsSync(op.from)) {
        errors[op.from] = `apply_patch: rename failed: ${op.from} not found`;
      }
    }
  }

  return errors;
}

type Anchor =
  | { type: 'top' | 'bottom' }
  | { type: 'before' | 'after'; pattern: string }
  | {};

type Hunk = { minus: string[]; plus: string[]; anchor: Anchor };

type Op =
  | { op: 'add'; filePath: string; content: string }
  | { op: 'update'; filePath: string; hunks: Hunk[] }
  | { op: 'delete'; filePath: string }
  | { op: 'rename'; from: string; to: string };

interface ApplyResult {
  success: boolean;
  applied: string[];
  failed: string[];
  errors: Record<string, string>;
}

let _jsonMode = false;

function die(msg: string, code = 1): never {
  if (_jsonMode) {
    const result: ApplyResult = { success: false, applied: [], failed: [], errors: { _global: msg } };
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(code);
  }
  process.stderr.write(msg + '\n');
  process.exit(code);
  throw new Error(msg);
}

function dbg(enabled: boolean, ...args: any[]) {
  if (!enabled) return;
  process.stderr.write('[apply_patch] ' + args.map(String).join(' ') + '\n');
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function stripBeginEnd(text: string): string {
  const m = text.match(/^\*\*\*\s*Begin Patch\s*$([\s\S]*?)^\*\*\*\s*End Patch\s*$/m);
  return (m ? m[1] : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripCodeFences(payload: string): string {
  return payload
    .split('\n')
    .filter((ln) => !/^```[A-Za-z0-9_-]*\s*$/.test(ln.trim()))
    .join('\n');
}

function norm(s: string): string {
  return s.replace(/\t/g, ' ').trim().replace(/\s+/g, ' ');
}

function findExact(hay: string[], needle: string[]): number {
  if (needle.length === 0) return -1;
  for (let i = 0; i <= hay.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function findFuzzy(hay: string[], needle: string[]): number {
  if (needle.length === 0) return -1;
  const H = hay.map(norm);
  const N = needle.map(norm);
  for (let i = 0; i <= H.length - N.length; i++) {
    let ok = true;
    for (let j = 0; j < N.length; j++) {
      if (H[i + j] !== N[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function containsBlock(hay: string[], block: string[]): boolean {
  return findExact(hay, block) !== -1 || findFuzzy(hay, block) !== -1;
}

function insertTopStrategy(lines: string[]): number {
  let idx = 0;
  if (lines[0]?.startsWith('#!')) idx = 1;

  // skip blank lines, single-line comments, and block comments
  while (
    idx < lines.length &&
    (lines[idx].trim() === '' ||
      lines[idx].trimStart().startsWith('//') ||
      lines[idx].trimStart().startsWith('/*'))
  ) {
    // If this line opens a block comment, skip through to the closing */
    if (lines[idx].trimStart().startsWith('/*')) {
      while (idx < lines.length && !lines[idx].includes('*/')) {
        idx++;
      }
    }
    idx++;
  }

  while (idx < lines.length && /^\s*(import|export\s+\*)\b/.test(lines[idx])) idx++;

  return idx;
}

function findAnchorIndex(lines: string[], anchor: Anchor): number {
  // empty anchor
  if (!('type' in anchor)) return -1;

  if (anchor.type === 'top') return insertTopStrategy(lines);
  if (anchor.type === 'bottom') return lines.length;

  if (anchor.type === 'before' || anchor.type === 'after') {
    let rx: RegExp;
    try {
      rx = new RegExp(anchor.pattern);
    } catch {
      return -1;
    }
    for (let i = 0; i < lines.length; i++) {
      if (rx.test(lines[i])) return anchor.type === 'before' ? i : i + 1;
    }
  }

  return -1;
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!dir || dir === '.') return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    process.stderr.write(`apply_patch: failed to create directory ${dir}: ${err.message}\n`);
    throw err;
  }
}

function pruneOldBackups(filePath: string, maxBackups: number, verbose: boolean) {
  if (maxBackups < 1) return;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const pattern = `${base}.bak.`;

  try {
    const entries = fs.readdirSync(dir);
    const backups = entries
      .filter(name => name.startsWith(pattern))
      .map(name => {
        const fullPath = path.join(dir, name);
        const stat = fs.statSync(fullPath);
        return { name, path: fullPath, mtime: stat.mtime.getTime() };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (backups.length > maxBackups) {
      const toDelete = backups.slice(maxBackups);
      for (const old of toDelete) {
        try {
          fs.rmSync(old.path);
          dbg(verbose, 'pruned old backup', old.path);
        } catch (err: any) {
          dbg(verbose, `failed to prune ${old.path}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    dbg(verbose, `failed to prune backups for ${filePath}: ${err.message}`);
  }
}
function backup(filePath: string, verbose: boolean, maxBackups = -1) {
  if (!fs.existsSync(filePath)) return;
  if (maxBackups === 0) return; // 0 = no backups
  const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 18);
  const bak = `${filePath}.bak.${ts}`;
  ensureDir(bak);
  try {
    fs.copyFileSync(filePath, bak);
  } catch (err: any) {
    process.stderr.write(`apply_patch: failed to backup ${filePath}: ${err.message}\n`);
    throw err;
  }
  dbg(verbose, 'backup', bak);
  if (maxBackups > 0) {
    pruneOldBackups(filePath, maxBackups, verbose);
  } // maxBackups -1 = unlimited, 0 = no backup (handled above)
}

function parseAnchor(header: string): Anchor {
  const h = header.trim();
  if (h.includes('at:top')) return { type: 'top' };
  if (h.includes('at:bottom')) return { type: 'bottom' };
  const mb = h.match(/before:\/(.*?)\//);
  if (mb) return { type: 'before', pattern: mb[1] };
  const ma = h.match(/after:\/(.*?)\//);
  if (ma) return { type: 'after', pattern: ma[1] };
  return {};
}

function parseOps(patchText: string): Op[] {
  const payload = stripCodeFences(stripBeginEnd(patchText));
  const lines = payload.split('\n');

  const ops: Op[] = [];

  function headerRest(kind: string, line: string) {
    const idx = line.indexOf(`${kind}:`);
    return line.slice(idx + kind.length + 1).trim();
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('*** ')) {
      i++;
      continue;
    }

    if (line.includes('Update File:')) {
      const filePath = headerRest('Update File', line);
      const hunks: Hunk[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        if (!lines[i].startsWith('@@')) {
          i++;
          continue;
        }

        const header = lines[i];
        const anchor = parseAnchor(header);
        i++;

        const minus: string[] = [];
        const plus: string[] = [];

        while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('*** ')) {
          const ln = lines[i];
          if (ln.startsWith('+')) plus.push(ln.slice(1));
          else if (ln.startsWith('-')) minus.push(ln.slice(1));
          else if (ln.startsWith(' ')) {
            minus.push(ln.slice(1));
            plus.push(ln.slice(1));
          } else if (ln.trim() === '') {
            minus.push('');
            plus.push('');
          } else {
            minus.push(ln);
            plus.push(ln);
          }
          i++;
        }

        // Trim trailing empty lines (artifacts of stdin's final newline)
        while (minus.length && minus[minus.length - 1] === '') minus.pop();
        while (plus.length && plus[plus.length - 1] === '') plus.pop();

        hunks.push({ minus, plus, anchor });
      }
      ops.push({ op: 'update', filePath, hunks });
      continue;
    }

    if (line.includes('Add File:')) {
      const filePath = headerRest('Add File', line);
      i++;
      const buf: string[] = [];
      while (i < lines.length && !lines[i].startsWith('*** ')) {
        buf.push(lines[i]);
        i++;
      }

      const nonEmpty = buf.filter((b) => b.trim() !== '');
      const plusFrac =
        nonEmpty.length === 0
          ? 0
          : nonEmpty.filter((b) => b.startsWith('+')).length / nonEmpty.length;

      const contentLines = plusFrac > 0.6 ? buf.map((b) => (b.startsWith('+') ? b.slice(1) : b)) : buf;
      ops.push({ op: 'add', filePath, content: contentLines.join('\n') });
      continue;
    }

    if (line.includes('Delete File:')) {
      const filePath = headerRest('Delete File', line);
      ops.push({ op: 'delete', filePath });
      i++;
      continue;
    }

    if (line.includes('Rename File:')) {
      const rest = headerRest('Rename File', line);
      const m = rest.match(/(.+?)(?:\s*->\s*|\s+to\s+)(.+)$/);
      if (m) ops.push({ op: 'rename', from: m[1].trim(), to: m[2].trim() });
      i++;
      continue;
    }

    i++;
  }

  return ops;
}

function applyUpdate(filePath: string, hunks: Hunk[], dryRun: boolean, verbose: boolean, maxBackups: number): { ok: boolean; error?: string } {
  if (!fs.existsSync(filePath)) {
    const msg = `apply_patch: update failed, file not found: ${filePath}`;
    process.stderr.write(msg + '\n');
    return { ok: false, error: msg };
  }

  let original: string;
  try {
    original = fs.readFileSync(filePath, 'utf8');
  } catch (err: any) {
    const msg = `apply_patch: failed to read ${filePath}: ${err.message}`;
    process.stderr.write(msg + '\n');
    return { ok: false, error: msg };
  }

  let lines = original.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines = lines.slice(0, -1);

  let changed = false;

  for (const h of hunks) {
    if (h.plus.length && containsBlock(lines, h.plus)) {
      dbg(verbose, 'hunk already present in', filePath);
      continue;
    }

    if (h.minus.length) {
      let idx = findExact(lines, h.minus);
      if (idx === -1) idx = findFuzzy(lines, h.minus);
      if (idx !== -1) {
        lines.splice(idx, h.minus.length, ...h.plus);
        changed = true;
        continue;
      }
    }

    const aidx = findAnchorIndex(lines, h.anchor);
    if (aidx !== -1) {
      lines.splice(aidx, 0, ...h.plus);
      changed = true;
      continue;
    }

    if (h.minus.length === 0 && h.plus.length) {
      const pos = insertTopStrategy(lines);
      lines.splice(pos, 0, ...h.plus);
      changed = true;
      continue;
    }

    const msg = `apply_patch: hunk not found and no valid anchor in ${filePath}; aborting`;
    process.stderr.write(msg + '\n');
    return { ok: false, error: msg };
  }

  if (!changed) {
    dbg(verbose, 'no changes needed for', filePath);
    return { ok: true };
  }

  if (dryRun) {
    dbg(verbose, '[dry-run] would write', filePath);
    return { ok: true };
  }

  backup(filePath, verbose, maxBackups);
  try {
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  } catch (err: any) {
    const msg = `apply_patch: failed to write ${filePath}: ${err.message}`;
    process.stderr.write(msg + '\n');
    return { ok: false, error: msg };
  }
  return { ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let verbose = false;
  let allowDelete = false;
  let allowRename = false;
  let maxBackups = -1; // -1 = unlimited (default when --max-backups not specified)
  let jsonOutput = false;

  for (const a of args) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--verbose' || a === '-v') verbose = true;
    else if (a === '--allow-delete') allowDelete = true;
    else if (a === '--allow-rename') allowRename = true;
    else if (a.startsWith('--max-backups=')) {
      const val = parseInt(a.slice('--max-backups='.length), 10);
      if (isNaN(val) || val < 0) die('apply_patch: --max-backups requires non-negative integer', 2);
      maxBackups = val;
    }
    else if (a === '--json') jsonOutput = true;
    else die(`apply_patch: unknown arg: ${a}`, 2);
  }

  _jsonMode = jsonOutput;

  const patchText = await readStdin();
  const ops = parseOps(patchText);
  if (!ops.length) die('apply_patch: no operations recognized');

  // Pre-flight: validate all ops before touching any file (atomicity guarantee).
  // Pre-flight: validate all ops before touching any file (atomicity guarantee).
  // Runs unconditionally (including dry-run) so flag violations are caught early.
  const preErrors = validateOps(ops, allowDelete, allowRename);
  if (Object.keys(preErrors).length > 0) {
    const result: ApplyResult = { success: false, applied: [], failed: Object.keys(preErrors), errors: preErrors };
    if (jsonOutput) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      for (const msg of Object.values(preErrors)) {
        process.stderr.write(msg + '\n');
      }
    }
    process.exit(1);
  }

  const result: ApplyResult = { success: true, applied: [], failed: [], errors: {} };

  for (const op of ops) {
    const filePath = op.op === 'rename' ? op.from : op.filePath;
    if (op.op === 'add') {
      if (dryRun) dbg(verbose, '[dry-run] add', op.filePath, `(${op.content.length} bytes)`);
      else {
        ensureDir(op.filePath);
        backup(op.filePath, verbose, maxBackups);
        const c = op.content.endsWith('\n') ? op.content : op.content + '\n';
        try {
          fs.writeFileSync(op.filePath, c, 'utf8');
        } catch (err: any) {
          const msg = `apply_patch: failed to write ${op.filePath}: ${err.message}`;
          process.stderr.write(msg + '\n');
          result.failed.push(op.filePath);
          result.errors[op.filePath] = msg;
          result.success = false;
          continue;
        }
      }
      result.applied.push(op.filePath);
    } else if (op.op === 'update') {
      const r = applyUpdate(op.filePath, op.hunks, dryRun, verbose, maxBackups);
      if (r.ok) {
        result.applied.push(op.filePath);
      } else {
        result.failed.push(op.filePath);
        result.errors[op.filePath] = r.error!;
        result.success = false;
      }
    } else if (op.op === 'delete') {
    } else if (op.op === 'delete') {
      if (fs.existsSync(op.filePath)) {
        if (!dryRun) {
          backup(op.filePath, verbose, maxBackups);
          try {
            fs.rmSync(op.filePath);
          } catch (err: any) {
            const msg = `apply_patch: failed to delete ${op.filePath}: ${err.message}`;
            process.stderr.write(msg + '\n');
            result.failed.push(op.filePath);
            result.errors[op.filePath] = msg;
            result.success = false;
            continue;
          }
        }
      }
      result.applied.push(op.filePath);
    } else if (op.op === 'rename') {
    } else if (op.op === 'rename') {
      if (!fs.existsSync(op.from)) {
        const msg = `apply_patch: rename failed: ${op.from} not found`;
        process.stderr.write(msg + '\n');
        result.failed.push(filePath);
        result.errors[filePath] = msg;
        result.success = false;
      } else {
        ensureDir(op.to);
        if (!dryRun) {
          if (fs.existsSync(op.to)) backup(op.to, verbose, maxBackups);
          try {
            fs.renameSync(op.from, op.to);
          } catch (err: any) {
            const msg = `apply_patch: failed to rename ${op.from} -> ${op.to}: ${err.message}`;
            process.stderr.write(msg + '\n');
            result.failed.push(filePath);
            result.errors[filePath] = msg;
            result.success = false;
            continue;
          }
        }
        result.applied.push(filePath);
      }
    }
  }

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(result) + '\n');
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});

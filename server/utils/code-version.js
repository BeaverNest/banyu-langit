// ═══════════════════════════════════════════════════════════════════════════
// code_version — provenance stamp for every derived figure on the agent rail.
// Resolution order (first hit wins), cached at module load:
//   1. env CODE_VERSION            (injected at deploy)
//   2. <APP_ROOT>/CODE_VERSION      (baked file or bind mount)
//   3. <repo>/CODE_VERSION
//   4. git HEAD — `git rev-parse HEAD`, else .git/HEAD read directly
//      (works when .git is bind-mounted read-only, no git binary needed)
//   5. 'unknown' — the caller must see this, never a fabricated sha.
// A derived metric whose formula is editable but unstamped cannot be audited
// after the fact: this is what makes the rail's `code_version` field truthful.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_DIRS = [process.env.APP_ROOT, '/app', REPO_ROOT, process.cwd()]
  .filter(Boolean)
  .filter((d, i, a) => a.indexOf(d) === i);

function headFromGitDir(gitDir) {
  try {
    const headFile = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headFile)) return null;
    const head = fs.readFileSync(headFile, 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;                    // detached HEAD
    const ref = head.slice(5).trim();
    const refFile = path.join(gitDir, ref);
    if (fs.existsSync(refFile)) return fs.readFileSync(refFile, 'utf8').trim();
    // packed refs — in this gitdir, or in the common gitdir for worktrees
    const commonFile = path.join(gitDir, 'commondir');
    const commonDir = fs.existsSync(commonFile)
      ? path.resolve(gitDir, fs.readFileSync(commonFile, 'utf8').trim())
      : null;
    for (const dir of [gitDir, commonDir]) {
      if (!dir) continue;
      const packed = path.join(dir, 'packed-refs');
      if (!fs.existsSync(packed)) continue;
      for (const line of fs.readFileSync(packed, 'utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length === 2 && parts[1] === ref) return parts[0];
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function gitDirFor(dir) {
  try {
    const g = path.join(dir, '.git');
    if (!fs.existsSync(g)) return null;
    if (fs.statSync(g).isDirectory()) return g;
    const txt = fs.readFileSync(g, 'utf8').trim();                 // "gitdir: <path>"
    const m = txt.match(/^gitdir:\s*(.+)$/m);
    return m ? path.resolve(dir, m[1]) : null;
  } catch (e) {
    return null;
  }
}

function readVersionFile(dir) {
  try {
    const f = path.join(dir, 'CODE_VERSION');
    if (!fs.existsSync(f)) return null;
    const v = fs.readFileSync(f, 'utf8').trim().split('\n')[0].trim();
    return v || null;
  } catch (e) {
    return null;
  }
}

function resolve() {
  const env = (process.env.CODE_VERSION || '').trim();
  if (env) return { version: env, source: 'env:CODE_VERSION' };

  for (const dir of CANDIDATE_DIRS) {
    const v = readVersionFile(dir);
    if (v) return { version: v, source: 'file:' + path.join(dir, 'CODE_VERSION') };
  }

  for (const dir of CANDIDATE_DIRS) {
    try {
      const out = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
      if (out) return { version: out, source: 'git-exec:' + dir };
    } catch (e) { /* git missing or not a repo — try the next strategy */ }
  }

  for (const dir of CANDIDATE_DIRS) {
    const gd = gitDirFor(dir);
    if (!gd) continue;
    const sha = headFromGitDir(gd);
    if (sha) return { version: sha, source: 'git-head:' + gd };
  }

  return { version: 'unknown', source: 'unresolved:no-dev-env-var-no-CODE_VERSION-no-git' };
}

// ── running-code fingerprint ─────────────────────────────────────────────
// code_version above reports the git HEAD of the mounted .git, which does NOT
// move when the working tree has uncommitted edits (bind-mounted dev setup).
// The fingerprint hashes the actual server sources the process is running, so a
// consumer can tell "committed code" from "committed code + uncommitted edits".
function fingerprintServer(rootDir) {
  try {
    const crypto = require('crypto');
    const h = crypto.createHash('sha256');
    const files = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.js')) files.push(p);
      }
    })(rootDir);
    for (const f of files) h.update(path.relative(rootDir, f) + ':' + fs.readFileSync(f));
    return h.digest('hex').slice(0, 12);
  } catch (e) { return 'unknown'; }
}

const RESOLVED = resolve();
const SERVER_ROOT = path.resolve(__dirname, '..');
const FINGERPRINT = fingerprintServer(SERVER_ROOT);

function getCodeVersion() { return RESOLVED.version; }
function getCodeVersionSource() { return RESOLVED.source; }
function getCodeFingerprint() { return FINGERPRINT; }
function getServerRoot() { return SERVER_ROOT; }

module.exports = { getCodeVersion, getCodeVersionSource, getCodeFingerprint, getServerRoot, REPO_ROOT };

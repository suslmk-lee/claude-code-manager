'use strict';
// App updates without a server: the public repo's GitHub Release feed. `latest` asks releases/latest (no token; 60 calls/h is
// plenty for a check at start and every few hours), compares the tag with the running version and picks this machine's
// installer among the assets. `fetchAsset` streams it into ~/Downloads. macOS: `installMac` swaps the app in place and reopens it; elsewhere the file is opened (an exe runs).
const https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
const { execFile, spawn } = require('child_process');
const REPO = 'suslmk-lee/claude-code-manager';
const UA = 'claude-code-manager';
const nums = (v) => (String(v || '').match(/\d+/g) || []).slice(0, 3).map(Number);
// is the tag's x.y.z above the current version's?
function newer(current, tag) { const a = nums(current), b = nums(tag); for (let i = 0; i < 3; i++) { const d = (b[i] || 0) - (a[i] || 0); if (d) return d > 0; } return false; }
// the installer for this machine: macOS → the dmg for its arch (or an unmarked one), Windows → the exe
function pickAsset(assets, platform = process.platform, arch = process.arch) {
  const all = (assets || []).filter((a) => a && a.name);
  if (platform === 'darwin') { const dmgs = all.filter((a) => /\.dmg$/i.test(a.name)); return dmgs.find((a) => a.name.includes(arch)) || dmgs.find((a) => !/arm64|x64|x86/.test(a.name)) || null; }
  if (platform === 'win32') return all.find((a) => /\.exe$/i.test(a.name)) || null;
  return null;
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': UA, accept: 'application/vnd.github+json' }, timeout: 15000 }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`http ${res.statusCode}`)); try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}
let memo = { at: 0, v: null };
async function latest(current, { force = false, fetch = getJson } = {}) {
  if (!force && memo.v && Date.now() - memo.at < 3600000) return memo.v;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  const asset = pickAsset(r.assets);
  const v = { tag: r.tag_name || '', version: String(r.tag_name || '').replace(/^v/, ''), newer: newer(current, r.tag_name), name: r.name || r.tag_name || '', notes: r.body || '', url: r.html_url || `https://github.com/${REPO}/releases`,
    publishedAt: r.published_at || null, asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size || 0 } : null, checkedAt: Date.now() };
  memo = { at: Date.now(), v };
  return v;
}
// GitHub asset URLs redirect to objects.githubusercontent.com: follow up to 5 hops; progress(received, total)
function download(url, dest, progress, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': UA }, timeout: 30000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 5) { res.resume(); return resolve(download(res.headers.location, dest, progress, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`http ${res.statusCode}`)); }
      const total = Number(res.headers['content-length']) || 0; let got = 0;
      const tmp = `${dest}.part`, out = fs.createWriteStream(tmp);
      res.on('data', (d) => { got += d.length; if (progress) progress(got, total); });
      res.pipe(out);
      out.on('finish', () => fs.rename(tmp, dest, (e) => (e ? reject(e) : resolve(dest))));
      out.on('error', reject); res.on('error', reject);
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}
async function fetchAsset(info, dir, progress) {
  if (!info || !info.asset) throw new Error('이 플랫폼용 설치 파일이 릴리스에 없습니다');
  const dest = path.join(dir || path.join(os.homedir(), 'Downloads'), info.asset.name);
  await download(info.asset.url, dest, progress);
  return dest;
}
// ---- install without the user closing the app (macOS) ----
// The running bundle (…/Claude Code Manager.app) when it can be replaced in place: a packaged .app in a writable folder.
function macTarget(execPath = process.execPath) {
  const t = path.resolve(execPath, '../../..');
  if (process.platform !== 'darwin' || !t.endsWith('.app')) return null;
  try { fs.accessSync(path.dirname(t), fs.constants.W_OK); return t; } catch { return null; }
}
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, (e, out, err) => (e ? reject(new Error(`${cmd}: ${String(err || e.message).trim()}`)) : resolve(out))));
// Copies the new app out of the dmg next to the old one (<app>.update) while this app still runs, so a broken download fails
// here and changes nothing. Then leaves a detached shell waiting for `pid` to exit: it swaps the folders (putting the old one
// back if the swap fails) and opens the app again. The caller quits right after.
async function installMac(dmg, target, { pid = process.pid, relaunch = true } = {}) {
  const mnt = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccm-update-'));
  const staged = `${target}.update`;
  await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mnt]);
  try {
    const name = (await fs.promises.readdir(mnt)).find((f) => f.endsWith('.app'));
    if (!name) throw new Error('설치 이미지에 앱이 없습니다');
    await fs.promises.rm(staged, { recursive: true, force: true });
    await run('ditto', [path.join(mnt, name), staged]);
  } finally { await run('hdiutil', ['detach', mnt, '-force']).catch(() => {}); fs.promises.rm(mnt, { recursive: true, force: true }).catch(() => {}); }
  // ponytail: waits up to 30 s for the app to exit, then swaps anyway (a hung quit would otherwise leave the update staged forever)
  const sh = 'n=0; while kill -0 "$2" 2>/dev/null && [ $n -lt 150 ]; do sleep 0.2; n=$((n+1)); done; rm -rf "$1.old"; mv "$1" "$1.old" && { mv "$1.update" "$1" && rm -rf "$1.old" || mv "$1.old" "$1"; }; [ "$3" = 1 ] && open "$1"';
  spawn('/bin/sh', ['-c', sh, 'sh', target, String(pid), relaunch ? '1' : '0'], { detached: true, stdio: 'ignore' }).unref();
  return target;
}
module.exports = { REPO, newer, pickAsset, latest, fetchAsset, download, macTarget, installMac };

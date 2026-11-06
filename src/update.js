'use strict';
// App updates without a server: the public repo's GitHub Release feed. `latest` asks releases/latest (no token; 60 calls/h is
// plenty for a check at start and every few hours), compares the tag with the running version and picks this machine's
// installer among the assets. `fetchAsset` streams it into ~/Downloads; the renderer then opens it (a dmg mounts, an exe runs).
const https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
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
module.exports = { REPO, newer, pickAsset, latest, fetchAsset, download };

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Must match the NSIS installer's appId so Windows taskbar pins work correctly
if (process.platform === 'win32') app.setAppUserModelId('com.andywhite.ridelog');

// Avoid GPU cache permission conflicts when running alongside the installed build
app.commandLine.appendSwitch('disk-cache-dir', path.join(os.tmpdir(), 'ridelog-dev-cache'));

// Locate the personal OneDrive folder by looking for "OneDrive - Andy White" under the user's home dir.
// Falls back to AppData so the app still works if OneDrive is absent.
function getDataDir() {
  const homeDir = os.homedir();
  const personalOneDriveNames = ['OneDrive - Andy White', 'OneDrive'];
  for (const name of personalOneDriveNames) {
    const candidate = path.join(homeDir, name, '#Personal', 'CYCLING', 'APP');
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch (e) {
      // not accessible, try next
    }
  }
  return app.getPath('userData');
}

let _dataDir = null;
function dataFile() {
  if (!_dataDir) _dataDir = getDataDir();
  return path.join(_dataDir, 'ridelog-data.json');
}

// On first run, migrate any existing AppData copy to the OneDrive location.
function migrateFromAppData() {
  const oldPath = path.join(app.getPath('userData'), 'ridelog-data.json');
  const newPath = dataFile();
  if (oldPath !== newPath && fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    try { fs.copyFileSync(oldPath, newPath); } catch (e) { /* keep going */ }
  }
}

ipcMain.handle('load-data', () => {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch (e) {
    // Main file missing/corrupt (e.g. truncated by a crash mid-write) — fall back to the most
    // recent backup rather than silently handing back null, which would read as "first run" and
    // risk the next save overwriting years of history with an empty state.
    try {
      const dir = backupsDir();
      const files = fs.readdirSync(dir).filter(f => f.startsWith('ridelog-data-')).sort();
      if (!files.length) return null;
      return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
    } catch (e2) {
      return null;
    }
  }
});

// Rolling backups of the data file, taken right before each overwrite, so a bad write (crash
// mid-save, or a OneDrive sync race between two devices) has a recent recovery point instead of
// silently destroying the only copy of the ride/weight history.
const MAX_BACKUPS = 8;
function backupsDir() {
  const dir = path.join(_dataDir || getDataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function backupDataFile() {
  const target = dataFile();
  if (!fs.existsSync(target)) return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(target, path.join(backupsDir(), `ridelog-data-${stamp}.json`));
    const files = fs.readdirSync(backupsDir()).filter(f => f.startsWith('ridelog-data-')).sort();
    while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(backupsDir(), files.shift()));
  } catch (e) {
    // a failed backup shouldn't block the save itself
  }
}

ipcMain.handle('save-data', (event, data) => {
  const target = dataFile();
  backupDataFile();
  // Atomic write: write to a temp file then rename, so a crash mid-write can't leave the live
  // file truncated/corrupt (rename is atomic on the same filesystem/directory).
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
  return true;
});

ipcMain.handle('data-file-path', () => dataFile());

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

let audaxWin = null;
let audaxCreds = { username: '', password: '' };

ipcMain.handle('set-audax-creds', (event, creds) => {
  audaxCreds = creds || { username: '', password: '' };
});

function tryAutoLogin(win) {
  if (!audaxCreds.username || !audaxCreds.password) return;
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`
      (function() {
        const p = document.querySelector('input[type="password"]');
        if (!p) return false;
        const form = p.closest('form');
        if (!form) return false;
        const u = form.querySelector('input[name="Username"],input[name="username"],input[name="email"],input[type="email"],input[type="text"]');
        if (!u) return false;
        u.value = ${JSON.stringify(audaxCreds.username)};
        u.dispatchEvent(new Event('input', { bubbles: true }));
        u.dispatchEvent(new Event('change', { bubbles: true }));
        p.value = ${JSON.stringify(audaxCreds.password)};
        p.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('change', { bubbles: true }));
        const btn = form.querySelector('[type="submit"],button[type="submit"],button');
        if (btn) btn.click();
        return true;
      })();
    `).catch(() => {});
  }, 500);
}

ipcMain.handle('open-audax-url', (event, targetUrl) => {
  if (audaxWin && !audaxWin.isDestroyed()) {
    // Window already open — just navigate; if session expired and login page
    // appears, the did-navigate listener below will auto-fill it
    audaxWin.loadURL(targetUrl);
    audaxWin.focus();
    return;
  }

  audaxWin = new BrowserWindow({
    width: 1200, height: 820, show: true,
    title: 'Audax UK',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:audax',
    },
  });

  let pendingTarget = null; // set when we go to login first

  audaxWin.webContents.on('did-navigate', (e, navUrl) => {
    if (navUrl.includes('/login')) {
      // On login page — auto-fill if we have creds
      tryAutoLogin(audaxWin);
    } else if (pendingTarget && navUrl !== pendingTarget) {
      // Login completed (redirected away from login) — now go to the real target
      const dest = pendingTarget;
      pendingTarget = null;
      setTimeout(() => audaxWin && !audaxWin.isDestroyed() && audaxWin.loadURL(dest), 200);
    }
  });

  if (audaxCreds.username && audaxCreds.password) {
    // Navigate to login first; after successful login, go to target
    pendingTarget = targetUrl;
    audaxWin.loadURL('https://www.audax.uk/login/');
  } else {
    audaxWin.loadURL(targetUrl);
  }

  audaxWin.on('closed', () => { audaxWin = null; });
});

const ONEDRIVE_PATH = '%23Personal/Cycling/myride-data.json';

ipcMain.handle('onedrive-save', async (event, { accessToken, data }) => {
  try {
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${ONEDRIVE_PATH}:/content`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const d = await res.json();
    if (d.id || d.name) return { ok: true, lastModified: d.lastModifiedDateTime };
    return { error: d.error?.message || JSON.stringify(d) };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('onedrive-load', async (event, { accessToken }) => {
  try {
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${ONEDRIVE_PATH}:/content`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) {
      const d = await res.json();
      return { error: d.error?.message || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { data };
  } catch (err) { return { error: err.message }; }
});

const ONEDRIVE_FILES_BASE = '%23Personal/Cycling/EventFiles';

ipcMain.handle('onedrive-upload-file', async (event, { accessToken, milestoneId, localPath, fileName }) => {
  try {
    const fileBuffer = fs.readFileSync(localPath);
    const fileSize = fileBuffer.length;
    const encodedPath = `${ONEDRIVE_FILES_BASE}/${encodeURIComponent(milestoneId)}/${encodeURIComponent(fileName)}`;
    if (fileSize <= 4 * 1024 * 1024) {
      // Simple PUT for files ≤ 4 MB
      const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/content`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
        body: fileBuffer,
      });
      const d = await res.json();
      if (d.id) return { ok: true, driveItemId: d.id, size: d.size };
      return { error: d.error?.message || JSON.stringify(d) };
    } else {
      // Upload session for larger files (up to 250 MB)
      const sessionUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/createUploadSession`;
      const sessionRes = await fetch(sessionUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
      });
      const session = await sessionRes.json();
      if (!session.uploadUrl) return { error: session.error?.message || 'Failed to create upload session' };
      const chunkSize = 5 * 1024 * 1024; // 5 MB chunks
      let offset = 0, result = null;
      while (offset < fileSize) {
        const end = Math.min(offset + chunkSize, fileSize);
        const chunk = fileBuffer.slice(offset, end);
        const chunkRes = await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`, 'Content-Length': String(chunk.length) },
          body: chunk,
        });
        if (chunkRes.status === 200 || chunkRes.status === 201) { result = await chunkRes.json(); }
        else if (chunkRes.status !== 202) {
          const d = await chunkRes.json();
          return { error: d.error?.message || `Upload failed at offset ${offset}` };
        }
        offset = end;
      }
      if (result && result.id) return { ok: true, driveItemId: result.id, size: result.size };
      return { error: 'Upload completed but no confirmation received' };
    }
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('onedrive-file-url', async (event, { accessToken, milestoneId, fileName }) => {
  try {
    const encodedPath = `${ONEDRIVE_FILES_BASE}/${encodeURIComponent(milestoneId)}/${encodeURIComponent(fileName)}`;
    const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const d = await res.json();
    if (d['@microsoft.graph.downloadUrl']) return { url: d['@microsoft.graph.downloadUrl'] };
    return { error: d.error?.message || 'File not found' };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  return dialog.showOpenDialog(options);
});

function getZwiftWorkoutDir() {
  try {
    const base = path.join(os.homedir(), 'AppData', 'Local', 'Zwift', 'Workouts');
    const users = fs.readdirSync(base).filter(f => /^\d+$/.test(f));
    if (users.length) return path.join(base, users[0], '325Plan');
  } catch (e) {}
  return null;
}

function getOneDriveWorkoutDir() {
  return path.join(os.homedir(), 'OneDrive - Andy White', 'Documents', 'Zwift', 'Workouts', '105600', '325PLan');
}

ipcMain.handle('save-zwo', (event, { xml, filename }) => {
  const dir = getZwiftWorkoutDir();
  if (!dir) return { error: 'Zwift workout folder not found — is Zwift installed?' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), xml, 'utf8');
  } catch (e) {
    return { error: e.message };
  }
  try {
    const oneDriveDir = getOneDriveWorkoutDir();
    fs.mkdirSync(oneDriveDir, { recursive: true });
    fs.writeFileSync(path.join(oneDriveDir, filename), xml, 'utf8');
  } catch (e) {
    return { ok: true, warning: `Saved to Zwift folder but not to OneDrive copy: ${e.message}` };
  }
  return { ok: true };
});

const GPX_ROUTE_KMS = [22, 34, 49, 72, 95, 134, 159, 199, 228, 286, 344];

ipcMain.handle('save-gpx', async (event, { km }) => {
  const nearest = GPX_ROUTE_KMS.reduce((prev, curr) =>
    Math.abs(curr - km) < Math.abs(prev - km) ? curr : prev
  );
  const homeDir = os.homedir();
  let gpxDir = null;
  for (const name of ['OneDrive - Andy White', 'OneDrive']) {
    const candidate = path.join(homeDir, name, '#Personal', 'CYCLING', 'GPX');
    if (fs.existsSync(candidate)) { gpxDir = candidate; break; }
  }
  if (!gpxDir) return { error: 'GPX folder not found on OneDrive' };
  const srcFile = path.join(gpxDir, `route-${nearest}km.gpx`);
  if (!fs.existsSync(srcFile)) return { error: `route-${nearest}km.gpx not found` };

  const { filePath } = await dialog.showSaveDialog({
    title: 'Save GPX Route',
    defaultPath: path.join(homeDir, 'Desktop', `route-${nearest}km.gpx`),
    filters: [{ name: 'GPX Files', extensions: ['gpx'] }],
  });
  if (!filePath) return { cancelled: true };
  try {
    fs.copyFileSync(srcFile, filePath);
    return { ok: true, nearestKm: nearest };
  } catch (e) {
    return { error: e.message };
  }
});

// Exports a completed ride's own GPS track (built in the renderer from cached streams/polyline) as
// a GPX file, so it can be loaded onto a device and ridden again — distinct from save-gpx above,
// which copies a pre-made route file by nearest distance match.
ipcMain.handle('save-ride-gpx', async (event, { xml, filename }) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Save ride as GPX',
    defaultPath: path.join(os.homedir(), 'Desktop', filename),
    filters: [{ name: 'GPX Files', extensions: ['gpx'] }],
  });
  if (!filePath) return { cancelled: true };
  try {
    fs.writeFileSync(filePath, xml, 'utf8');
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

const AUDAX_EXTRACT_SCRIPT = `(() => {
  const articles = Array.from(document.querySelectorAll('article.mb-2.border.rounded'));
  const events = [];
  articles.forEach(a => {
    const text = a.textContent.replace(/\\s+/g, ' ').trim();
    const kmMatch = text.match(/(\\d{2,5})km/);
    const km = kmMatch ? parseInt(kmMatch[1], 10) : 0;
    if (km < 200) return;
    const dateMatch = text.match(/^([A-Za-z]{3} (\\d{2})\\/(\\d{2})\\/(\\d{4}))/);
    const iso = dateMatch ? \`\${dateMatch[4]}-\${dateMatch[3]}-\${dateMatch[2]}\` : '';
    const rest = dateMatch ? text.slice(dateMatch[1].length).trim() : text;
    const nameMatch = rest.match(/^(.*?\\([^)]+\\))/);
    const name = nameMatch ? nameMatch[1] : rest.slice(0, 60);
    const afterName = rest.slice(name.length);
    // Extract AAA from end, then location from between price and AAA
    const afterStr = afterName.trim();
    const aaaM = afterStr.match(/([\\d.]+)\\s*AAA\\s*$/);
    const aaa = aaaM ? Math.round(parseFloat(aaaM[1])) : null;
    const locStr = aaaM ? afterStr.slice(0, afterStr.length - aaaM[0].length) : afterStr;
    const locM = locStr.match(/£[\\d.]+\\s+(.*)/);
    const loc = locM ? locM[1].trim() : '';
    const link = a.querySelector('a');
    const href = link ? link.href : '';
    const idMatch = href.match(/id=(\\d+)/);
    events.push({
      id: idMatch ? idMatch[1] : href,
      date: iso,
      km: km,
      name: name,
      location: loc,
      aaa: aaa,
      url: href,
    });
  });
  const pag = Array.from(document.querySelectorAll('a.u-pagination-v1__item'));
  const pageEl = pag.find(el => /Page \\d+ of \\d+/.test(el.textContent));
  let currentPage = 1, totalPages = 1;
  if (pageEl) {
    const m = pageEl.textContent.match(/Page (\\d+) of (\\d+)/);
    currentPage = parseInt(m[1], 10);
    totalPages = parseInt(m[2], 10);
  }
  return { events, currentPage, totalPages };
})()`;

const AUDAX_NEXT_SCRIPT = `(() => {
  const next = Array.from(document.querySelectorAll('a.u-pagination-v1__item')).find(el => el.textContent.includes('Next'));
  if (next) { next.click(); return true; }
  return false;
})()`;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Returns { contentType, contentDisposition } from the final response after following redirects
function downloadFileTo(fileUrl, destPath, hops) {
  if ((hops || 0) > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = fileUrl.startsWith('https') ? require('https') : require('http');
    const out = fs.createWriteStream(destPath);
    mod.get(fileUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        out.close(); try { fs.unlinkSync(destPath); } catch (e) {}
        const loc = res.headers.location;
        downloadFileTo(loc.startsWith('http') ? loc : new URL(loc, fileUrl).href, destPath, (hops || 0) + 1)
          .then(resolve).catch(reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        out.close(); try { fs.unlinkSync(destPath); } catch (e) {}
        reject(new Error(`HTTP ${res.statusCode}`)); return;
      }
      const resHeaders = {
        contentType: res.headers['content-type'] || '',
        contentDisposition: res.headers['content-disposition'] || '',
      };
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(resHeaders)));
      out.on('error', err => { try { fs.unlinkSync(destPath); } catch (e) {} reject(err); });
    }).on('error', err => { try { fs.unlinkSync(destPath); } catch (e) {} reject(err); });
  });
}

function getExtFromHeaders(contentType, contentDisposition) {
  // Content-Disposition: check filename*= (RFC 5987) then filename=
  if (contentDisposition) {
    const starMatch = contentDisposition.match(/filename\*\s*=\s*(?:[A-Za-z0-9-]+'')?([^;\r\n]+)/i);
    if (starMatch) {
      try {
        const fn = decodeURIComponent(starMatch[1].trim().replace(/['"]/g, ''));
        const extM = fn.match(/\.(gpx|tcx|kml|kmz|fit|pdf)$/i);
        if (extM) return extM[0].toLowerCase();
      } catch (_) {}
    }
    const fnMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\r\n]*)/i);
    if (fnMatch) {
      const fn = fnMatch[1].replace(/['"]/g, '').trim();
      const extM = fn.match(/\.(gpx|tcx|kml|kmz|fit|pdf)$/i);
      if (extM) return extM[0].toLowerCase();
    }
  }
  // Content-Type mapping
  if (contentType) {
    const ct = contentType.toLowerCase().split(';')[0].trim();
    if (/pdf/.test(ct)) return '.pdf';
    if (/gpx/.test(ct)) return '.gpx';
    if (/kmz/.test(ct)) return '.kmz';
    if (/kml/.test(ct)) return '.kml';
    if (/tcx/.test(ct)) return '.tcx';
    if (/fit/.test(ct)) return '.fit';
    if (ct === 'text/xml' || ct === 'application/xml') return '.gpx';
  }
  return '';
}

// Read first 512 bytes and detect file type from magic bytes / XML content
function sniffFileExt(filePath) {
  try {
    const buf = Buffer.alloc(512);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    const head = buf.slice(0, bytesRead);
    // PDF: %PDF
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return '.pdf';
    // ZIP / KMZ: PK magic
    if (head[0] === 0x50 && head[1] === 0x4B) return '.kmz';
    // XML-based: strip BOM then look at text
    const txt = head.toString('utf8').replace(/^﻿/, '').trimStart();
    if (/^<\?xml|^<gpx\b/i.test(txt)) {
      if (/TrainingCenterDatabase/i.test(txt)) return '.tcx';
      if (/<kml\b/i.test(txt)) return '.kml';
      return '.gpx';
    }
  } catch (_) {}
  return '';
}

const AUDAX_FILE_SCRIPT = `(() => {
  const files = [];
  const seen = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    const href = (a.href || '').trim();
    if (!href || href.startsWith('javascript:') || seen.has(href)) return;
    const text = (a.textContent || a.title || '').replace(/\\s+/g,' ').trim();
    const hrefLow = href.toLowerCase();
    const textLow = text.toLowerCase();
    let type = null;
    if (/\\.(gpx|tcx|kml|kmz|fit)(\\?|$)/i.test(hrefLow)) type = 'GPS';
    else if (/\\.pdf(\\?|$)/i.test(hrefLow) && /route|sheet|brevet|cue|map|ride/i.test(textLow + ' ' + hrefLow)) type = 'Route';
    else if (/\\bgpx\\b|\\bgps\\b|gps.?track|download.{0,20}(route|track|gps)/i.test(textLow)) type = 'GPS';
    else if (/route.?sheet|routesheet|cue.?sheet|brevet.?card/i.test(textLow)) type = 'Route';
    if (type) { seen.add(href); files.push({ url: href, name: text || type, type }); }
  });
  // Extract elevation/climb from page text
  let elevation = null;
  const bodyText = (document.body.innerText || '').replace(/,/g, '');
  const climbPatterns = [
    /Climb\\w*\\s*:?\\s*(\\d+)\\s*m\\b/i,
    /(?:Total\\s+)?(?:Ascent|Elevation)\\s*:?\\s*(\\d+)\\s*m\\b/i,
    /(\\d{3,})\\s*m\\s+(?:of\\s+)?(?:climb|ascent|elevation)/i,
  ];
  for (const pat of climbPatterns) {
    const m = bodyText.match(pat);
    if (m) { elevation = parseInt(m[1], 10); break; }
  }
  return { files, elevation };
})()`;

ipcMain.handle('audax-check-files', async (event, url) => {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(url);
    await delay(2500);
    const result = await win.webContents.executeJavaScript(AUDAX_FILE_SCRIPT);
    win.destroy();
    return { files: result.files || [], elevation: result.elevation };
  } catch (err) {
    if (!win.isDestroyed()) win.destroy();
    return { files: [], elevation: null, error: err.message };
  }
});

ipcMain.handle('audax-download-file', async (event, { fileUrl, fileName, eventName, fileType }) => {
  const tempPath = path.join(require('os').tmpdir(), 'ridelog-dl-' + Date.now());
  try {
    const downloadsDir = 'F:\\Cycling\\#Audax\\Events';
    const folder = (eventName || 'Audax Event')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
    const eventDir = path.join(downloadsDir, folder);
    fs.mkdirSync(eventDir, { recursive: true });

    // Download to a temp file so we can read response headers before naming the final file
    const resHeaders = await downloadFileTo(fileUrl, tempPath);

    // Priority chain: URL path → response headers → magic bytes → link type label
    const urlBase = fileUrl.split('?')[0];
    const urlExtM = urlBase.match(/\.(gpx|tcx|kml|kmz|fit|pdf)$/i);
    let ext = urlExtM ? urlExtM[0].toLowerCase() : '';
    if (!ext) ext = getExtFromHeaders(resHeaders.contentType, resHeaders.contentDisposition);
    if (!ext) ext = sniffFileExt(tempPath);
    if (!ext && fileType === 'Route') ext = '.pdf';
    if (!ext && fileType === 'GPS') ext = '.gpx';

    let safe = (fileName || 'route-file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 120);
    if (fileType === 'Route' && !/route.?sheet/i.test(safe)) safe = `${safe} routesheet`;
    const finalName = safe + (ext && !safe.toLowerCase().endsWith(ext) ? ext : '');
    const dest = path.join(eventDir, finalName);

    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    try {
      fs.renameSync(tempPath, dest);
    } catch (e) {
      fs.copyFileSync(tempPath, dest);
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }

    shell.showItemInFolder(dest);
    return { ok: true, path: dest };
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (_) {}
    return { error: err.message };
  }
});

ipcMain.handle('audax-fetch', async () => {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL('https://www.audax.uk/choose-a-ride/calendar-events/');
    await delay(4000);
    let all = [];
    let info = await win.webContents.executeJavaScript(AUDAX_EXTRACT_SCRIPT);
    all = all.concat(info.events);
    let guard = 0;
    while (info.currentPage < info.totalPages && guard < 30) {
      const clicked = await win.webContents.executeJavaScript(AUDAX_NEXT_SCRIPT);
      if (!clicked) break;
      await delay(1200);
      info = await win.webContents.executeJavaScript(AUDAX_EXTRACT_SCRIPT);
      all = all.concat(info.events);
      guard++;
    }
    win.destroy();
    return { events: all };
  } catch (err) {
    if (!win.isDestroyed()) win.destroy();
    return { error: err.message };
  }
});

// Per-ride time-series streams (HR/power/cadence/altitude/GPS/etc.) are cached one file per
// activity under streams/ next to the main data file, rather than inside the big activityDetails
// blob — that blob round-trips through IPC and gets rewritten on every persist(), and full-resolution
// streams for hundreds of rides would make that slow. Each stream file is written once and never
// touched again, so this cache only grows, it's never rewritten wholesale.
function streamsDir() {
  const dir = path.join(_dataDir || getDataDir(), 'streams');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function streamFilePath(activityId) {
  return path.join(streamsDir(), `${activityId}.json`);
}
function streamsExist(activityId) {
  try { return fs.existsSync(streamFilePath(activityId)); } catch (e) { return false; }
}

const STREAM_KEYS = 'time,distance,latlng,altitude,heartrate,cadence,watts,temp,moving,grade_smooth';
// Strava's default rate limit is 100 requests/15min and 1000/day. The activity list fetch above
// already used a handful; cap stream backfill per sync so a fresh install with years of history
// doesn't blow through the 15-minute window — remaining rides get picked up on the next sync.
const MAX_STREAM_FETCHES_PER_SYNC = 80;
const STREAM_FETCH_DELAY_MS = 200;

async function backfillStreams(cyclingActivities, accessToken) {
  const missing = cyclingActivities.filter(a => !streamsExist(a.id));
  const fetchedIds = new Set();
  let rateLimited = false;
  const toFetch = missing.slice(0, MAX_STREAM_FETCHES_PER_SYNC);
  for (const a of toFetch) {
    try {
      const res = await fetch(
        `https://www.strava.com/api/v3/activities/${a.id}/streams?keys=${STREAM_KEYS}&key_by_type=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res.status === 429) { rateLimited = true; break; }
      if (!res.ok) continue; // e.g. activity has no streams at all (manual entry) — skip, not fatal
      const streams = await res.json();
      fs.writeFileSync(streamFilePath(a.id), JSON.stringify(streams));
      fetchedIds.add(a.id);
    } catch (e) {
      // network hiccup on one activity shouldn't abort the whole sync
    }
    await delay(STREAM_FETCH_DELAY_MS);
  }
  return { fetchedIds, remaining: missing.length - fetchedIds.size, rateLimited };
}

ipcMain.handle('get-activity-streams', (event, activityId) => {
  try {
    return JSON.parse(fs.readFileSync(streamFilePath(activityId), 'utf8'));
  } catch (e) {
    return null;
  }
});

// Strava's own weighted_average_watts can disagree meaningfully with the standard Coggan
// normalized-power algorithm (30s rolling average of power, raised to the 4th power, averaged,
// then 4th-rooted) — enough to throw off TSS/CTL. Recompute it from the raw per-second power
// stream, which is already cached on disk for every ride with power data.
function computeNormalizedPower(watts) {
  const window = 30;
  if (!Array.isArray(watts) || watts.length < window) return null;
  let sum = 0;
  let count = 0;
  let fourthPowerSum = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i];
    if (i >= window) sum -= watts[i - window];
    if (i >= window - 1) {
      const rollingAvg = sum / window;
      fourthPowerSum += rollingAvg ** 4;
      count++;
    }
  }
  if (!count) return null;
  return Math.round((fourthPowerSum / count) ** 0.25);
}

function recomputeNormalizedPowerFromStreams(activityDetails) {
  activityDetails.forEach(d => {
    if (!streamsExist(d.id)) return;
    try {
      const stream = JSON.parse(fs.readFileSync(streamFilePath(d.id), 'utf8'));
      const np = computeNormalizedPower(stream.watts && stream.watts.data);
      if (np != null) d.np = np;
    } catch (e) {
      // corrupt/unreadable stream file — keep Strava's reported np
    }
  });
}

ipcMain.handle('strava-sync', async (event, creds) => {
  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { error: tokenData.message || JSON.stringify(tokenData) };
    }
    const accessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token;

    const after = Math.floor(Date.now() / 1000) - 365 * 86400; // last 12 months
    let all = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(
        `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200&page=${page}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        return { error: `Strava API error ${res.status}: ${await res.text()}` };
      }
      const acts = await res.json();
      if (!Array.isArray(acts) || acts.length === 0) break;
      all = all.concat(acts);
      if (acts.length < 200) break;
    }

    const byDate = {};
    const activityDetails = [];
    const cyclingActivities = [];
    let rideCount = 0;
    all.forEach(a => {
      const type = (a.sport_type || a.type || '').toLowerCase();
      if (!/ride|cycl/.test(type)) return;
      const date = (a.start_date_local || a.start_date || '').slice(0, 10);
      if (!date) return;
      const km = (a.distance || 0) / 1000;
      byDate[date] = (byDate[date] || 0) + km;
      rideCount++;
      cyclingActivities.push(a);
      activityDetails.push({
        id: a.id,
        date,
        name: a.name || '',
        km: Math.round(km * 10) / 10,
        movingTime: a.moving_time || 0,
        elapsedTime: a.elapsed_time || 0,
        np: a.weighted_average_watts ? Math.round(a.weighted_average_watts) : null,
        avgWatts: a.average_watts ? Math.round(a.average_watts) : null,
        maxWatts: a.max_watts ? Math.round(a.max_watts) : null,
        kilojoules: a.kilojoules ? Math.round(a.kilojoules) : null,
        deviceWatts: a.device_watts || false,
        isVirtual: type.includes('virtual'),
        trainer: a.trainer || false,
        commute: a.commute || false,
        avgHr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        hasHeartrate: a.has_heartrate || false,
        avgCadence: a.average_cadence ? Math.round(a.average_cadence) : null,
        avgSpeedKmh: a.average_speed ? Math.round(a.average_speed * 3.6 * 10) / 10 : null,
        maxSpeedKmh: a.max_speed ? Math.round(a.max_speed * 3.6 * 10) / 10 : null,
        elevGainM: a.total_elevation_gain != null ? Math.round(a.total_elevation_gain) : null,
        elevHighM: a.elev_high != null ? Math.round(a.elev_high) : null,
        elevLowM: a.elev_low != null ? Math.round(a.elev_low) : null,
        avgTemp: a.average_temp != null ? a.average_temp : null,
        sufferScore: a.suffer_score != null ? a.suffer_score : null,
        polyline: (a.map && (a.map.summary_polyline || a.map.polyline)) || null,
        startLatLng: a.start_latlng || null,
        endLatLng: a.end_latlng || null,
        hasStreams: streamsExist(a.id),
      });
    });

    const streamResult = await backfillStreams(cyclingActivities, accessToken);
    activityDetails.forEach(d => { if (streamResult.fetchedIds.has(d.id)) d.hasStreams = true; });
    recomputeNormalizedPowerFromStreams(activityDetails);

    return {
      activities: byDate,
      activityDetails,
      newRefreshToken,
      rideCount,
      totalFetched: all.length,
      streamsFetched: streamResult.fetchedIds.size,
      streamsRemaining: streamResult.remaining,
      streamsRateLimited: streamResult.rateLimited,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// Whoop OAuth2 — spins up a local HTTP server on port 8788, opens a BrowserWindow for login,
// then captures the callback at http://localhost:8788/callback
const http = require('http');
const crypto = require('crypto');
ipcMain.handle('whoop-auth', async (event, { clientId, clientSecret }) => {
  const REDIRECT = 'http://localhost:8788/callback';
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = 'https://api.prod.whoop.com/oauth/oauth2/auth?' +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT)}&` +
    'response_type=code&' +
    `scope=${encodeURIComponent('offline read:profile read:recovery read:sleep read:body_measurement')}&` +
    `state=${state}`;

  return new Promise((resolve) => {
    let win;
    let settled = false;
    function settle(result) {
      if (settled) return;
      settled = true;
      try { server.close(); } catch (_) {}
      try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
      resolve(result);
    }

    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url, 'http://localhost:8788');
      if (reqUrl.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

      const code = reqUrl.searchParams.get('code');
      const oauthError = reqUrl.searchParams.get('error');
      const returnedState = reqUrl.searchParams.get('state');
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;padding:40px;"><h2>State mismatch</h2><p>Please close this window and try again.</p></body></html>');
        settle({ error: 'State mismatch — please try again' });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;padding:40px;"><h2>Authorised ✓</h2><p>You can close this window and return to RideLog.</p></body></html>');

      if (oauthError || !code) { settle({ error: oauthError || 'No code in callback' }); return; }

      try {
        const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT,
            client_id: clientId,
            client_secret: clientSecret,
          }).toString(),
        });
        const data = await tokenRes.json();
        if (data.access_token) settle({ accessToken: data.access_token, refreshToken: data.refresh_token || '' });
        else settle({ error: data.error_description || JSON.stringify(data) });
      } catch (err) { settle({ error: err.message }); }
    });

    server.on('error', (err) => settle({ error: 'Could not start local server on port 8788: ' + err.message }));

    server.listen(8788, '127.0.0.1', () => {
      console.log('[Whoop] Auth URL:', authUrl);
      win = new BrowserWindow({
        width: 560, height: 680, show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      win.setMenuBarVisibility(false);
      win.on('closed', () => settle({ error: 'Window closed' }));
      win.loadURL(authUrl);
    });
  });
});

// Microsoft Graph OAuth2 PKCE — public client, no secret needed
// Azure AD app: 726ecfd2-1b76-499b-9ef4-3dbd26a18097, redirect: http://localhost:49152
const MS_CLIENT_ID = '726ecfd2-1b76-499b-9ef4-3dbd26a18097';
const MS_REDIRECT  = 'http://localhost:49152';
const MS_SCOPE     = 'Calendars.ReadWrite offline_access';
function msB64url(buf) { return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

ipcMain.handle('microsoft-auth', async (event, { tenantId } = {}) => {
  const tenant  = (tenantId || 'common').trim();
  const verifier   = msB64url(crypto.randomBytes(32));
  const challenge  = msB64url(crypto.createHash('sha256').update(verifier).digest());
  const state      = crypto.randomBytes(16).toString('hex');
  const authUrl    = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?` +
    `client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT)}&` +
    `scope=${encodeURIComponent('https://graph.microsoft.com/Calendars.ReadWrite offline_access')}&` +
    `state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;

  console.log('[MS Auth] auth URL:', authUrl);

  return new Promise((resolve) => {
    let win, settled = false;
    function settle(r) {
      if (settled) return; settled = true;
      try { msServer.close(); } catch (_) {}
      try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
      resolve(r);
    }
    const msServer = http.createServer(async (req, res) => {
      const u = new URL(req.url, MS_REDIRECT);
      const code    = u.searchParams.get('code');
      const oauthErr = u.searchParams.get('error');
      const errDesc  = u.searchParams.get('error_description');
      const st       = u.searchParams.get('state');

      // Ignore browser resource requests (favicon etc.) — only process auth callbacks
      if (!code && !oauthErr) { res.writeHead(200); res.end(); return; }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;padding:40px;"><h2>Connected ✓</h2><p>Return to RideLog.</p></body></html>');

      // Show OAuth error before state check — Microsoft includes state in error redirects but surface the real error first
      if (oauthErr) {
        console.error('[MS Auth] OAuth error:', oauthErr, errDesc);
        settle({ error: oauthErr + (errDesc ? ' — ' + errDesc : '') });
        return;
      }
      if (st !== state) { settle({ error: 'State mismatch — try again' }); return; }
      if (!code) { settle({ error: 'No auth code received' }); return; }

      try {
        const tr = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: MS_REDIRECT, client_id: MS_CLIENT_ID, code_verifier: verifier, scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access' }).toString(),
        });
        const d = await tr.json();
        console.log('[MS Auth] token response received:', d.access_token ? 'ok' : (d.error || 'unknown error'));
        if (d.access_token) settle({ accessToken: d.access_token, refreshToken: d.refresh_token || '', expiresAt: Date.now() + (d.expires_in || 3600) * 1000 });
        else settle({ error: d.error_description || d.error || JSON.stringify(d) });
      } catch (err) { settle({ error: err.message }); }
    });
    msServer.on('error', (err) => settle({ error: 'Port 49152 in use: ' + err.message }));
    msServer.listen(49152, '127.0.0.1', () => {
      win = new BrowserWindow({ width: 560, height: 700, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true } });
      win.setMenuBarVisibility(false);
      win.on('closed', () => settle({ error: 'Window closed' }));
      win.loadURL(authUrl);
    });
  });
});

ipcMain.handle('microsoft-refresh', async (event, { refreshToken, tenantId }) => {
  const tenant = (tenantId || 'common').trim();
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: MS_CLIENT_ID, scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access' }).toString(),
    });
    const d = await res.json();
    if (d.access_token) return { accessToken: d.access_token, refreshToken: d.refresh_token || refreshToken, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
    return { error: d.error_description || JSON.stringify(d) };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('microsoft-get-events', async (event, { accessToken, startIso, endIso }) => {
  try {
    const headers = { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="Europe/London"' };

    // Step 1 — list all calendars the user has access to
    const calsRes = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name&$top=50', { headers });
    const calsData = await calsRes.json();
    if (!calsData.value) return { error: calsData.error?.message || 'Could not list calendars: ' + JSON.stringify(calsData) };

    console.log(`[MS Calendar] found ${calsData.value.length} calendars:`, calsData.value.map(c => c.name).join(', '));

    // Step 2 — fetch events from every calendar in parallel
    const params = `startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}&$select=subject,start,end,showAs&$top=100`;
    const results = await Promise.all(calsData.value.map(async (cal) => {
      try {
        const url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(cal.id)}/calendarView?${params}`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        if (data.value) {
          console.log(`[MS Calendar] ${cal.name}: ${data.value.length} events`);
          return data.value.map(ev => ({ ...ev, calendarName: cal.name }));
        }
        console.warn(`[MS Calendar] ${cal.name}: error`, data.error?.message);
        return [];
      } catch (err) {
        console.warn(`[MS Calendar] ${cal.name}: fetch failed`, err.message);
        return [];
      }
    }));

    const events = results.flat();
    console.log(`[MS Calendar] total events across all calendars: ${events.length}`);
    return { events };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('microsoft-get-user', async (event, { accessToken }) => {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const d = await res.json();
    return { displayName: d.displayName || '', mail: d.mail || '', userPrincipalName: d.userPrincipalName || '' };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('microsoft-add-event', async (event, { accessToken, subject, startIso, endIso, bodyText }) => {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, start: { dateTime: startIso, timeZone: 'Europe/London' }, end: { dateTime: endIso, timeZone: 'Europe/London' }, body: { contentType: 'text', content: bodyText || '' } }),
    });
    const d = await res.json();
    if (d.id) return { ok: true, id: d.id };
    return { error: d.error?.message || JSON.stringify(d) };
  } catch (err) { return { error: err.message }; }
});

function withTimeout(promise, ms, msg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

const GARMIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
const GARMIN_CSRF_RE   = /name="_csrf"\s+value="(.+?)"/;
const GARMIN_TICKET_RE = /ticket=([^"]+)"/;
const GARMIN_MFA_RE    = /action="([^"]*(?:verifyMFA|loginEnterMfa)[^"]*)"/i;

// Saved between the first (no-code) and second (with-code) garmin-sync IPC calls.
// Holds the live axios instance whose cookie jar captured the SSO session.
let _garminMfaState = null;

// Runs SSO steps 1-3 with cookie tracking via a fresh axios instance.
// Returns { ticket } on success, or { needsMFA, mfaState } when MFA is required.
async function garminDoLogin(username, password, url) {
  const qs = require('qs');
  const axios = require('axios');

  const cookieJar = {};
  const parseCookies = (hdrs) => {
    for (const c of (Array.isArray(hdrs) ? hdrs : hdrs ? [hdrs] : [])) {
      const eq = c.indexOf('='); const sc = c.indexOf(';');
      if (eq > -1) cookieJar[c.slice(0, eq).trim()] = c.slice(eq + 1, sc > -1 ? sc : undefined).trim();
    }
  };
  const cookieHdr = () => Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  const ax = axios.create({ maxRedirects: 5 });

  // Step 1 — init SSO session
  const r1 = await ax.get(`${url.GARMIN_SSO_EMBED}?${qs.stringify({ clientId: 'GarminConnect', locale: 'en', service: url.GC_MODERN })}`);
  parseCookies(r1.headers['set-cookie']);

  // Step 2 — login page + CSRF token
  const r2 = await ax.get(`${url.SIGNIN_URL}?${qs.stringify({ id: 'gauth-widget', embedWidget: true, locale: 'en', gauthHost: url.GARMIN_SSO_EMBED })}`, {
    headers: { Cookie: cookieHdr() },
  });
  parseCookies(r2.headers['set-cookie']);
  const csrfMatch = GARMIN_CSRF_RE.exec(r2.data);
  if (!csrfMatch) throw new Error('Garmin login — CSRF token not found');
  const csrf = csrfMatch[1];

  // Step 3 — submit credentials
  const signinParams = {
    id: 'gauth-widget', embedWidget: true, clientId: 'GarminConnect', locale: 'en',
    gauthHost: url.GARMIN_SSO_EMBED, service: url.GARMIN_SSO_EMBED,
    source: url.GARMIN_SSO_EMBED,
    redirectAfterAccountLoginUrl: url.GARMIN_SSO_EMBED,
    redirectAfterAccountCreationUrl: url.GARMIN_SSO_EMBED,
  };
  const step3Url = `${url.SIGNIN_URL}?${qs.stringify(signinParams)}`;
  const r3 = await ax.post(step3Url, qs.stringify({ username, password, embed: 'true', _csrf: csrf }), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'Dnt': '1',
      'Origin': url.GARMIN_SSO_ORIGIN, 'Referer': url.SIGNIN_URL,
      'User-Agent': GARMIN_UA, 'Cookie': cookieHdr(),
    },
  });
  parseCookies(r3.headers['set-cookie']);

  const ticketDirect = GARMIN_TICKET_RE.exec(r3.data);
  if (ticketDirect) return { ticket: ticketDirect[1] };

  // MFA required — extract the form details and save session for the second call
  const mfaActionMatch = GARMIN_MFA_RE.exec(r3.data);
  const rawAction = mfaActionMatch ? mfaActionMatch[1] : '/sso/verifyMFA/loginEnterMfaCode';
  const mfaAction = rawAction.startsWith('http') ? rawAction : `${url.GARMIN_SSO_ORIGIN}${rawAction}`;

  const hiddenFields = {};
  const hiddenRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let hm;
  while ((hm = hiddenRe.exec(r3.data)) !== null) {
    const nm = /\bname=["']([^"']+)["']/.exec(hm[0]);
    const vm = /\bvalue=["']([^"']*)["']/.exec(hm[0]);
    if (nm) hiddenFields[nm[1]] = vm ? vm[1] : '';
  }
  // Also extract the queryString hidden field (set by JS in browser from window.location.search,
  // but we need to populate it manually since we run server-side without JS execution).
  // The signinParams query string is what the browser would have in window.location.search.
  const signinParamStr = qs.stringify(signinParams);

  console.log('[Garmin MFA] action:', mfaAction, '| hidden:', JSON.stringify(hiddenFields));
  console.log('[Garmin MFA] cookies captured:', Object.keys(cookieJar));

  return { needsMFA: true, mfaState: { ax, cookieJar, cookieHdr, hiddenFields, mfaAction, step3Url, ssoOrigin: url.GARMIN_SSO_ORIGIN, signinParamStr } };
}

// Submits the MFA code using the axios instance (and cookies) from the first login call.
async function garminSubmitMFA({ ax, cookieHdr, hiddenFields, mfaAction, step3Url, ssoOrigin, signinParamStr }, mfaCode) {
  const qs = require('qs');
  // Include signinParamStr as `queryString` — JS normally reads window.location.search to populate
  // this hidden field in the browser; we supply it manually to give the server the embed context.
  const body = qs.stringify({
    ...hiddenFields,
    'mfa-code': mfaCode.trim(),
    embed: 'true',
    queryString: signinParamStr,
  });

  // Post to action URL with embed params in query string too (belt-and-braces)
  const mfaUrl = signinParamStr ? `${mfaAction}?${signinParamStr}` : mfaAction;

  const r4 = await ax.post(mfaUrl, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'Dnt': '1',
      'Origin': ssoOrigin, 'Referer': step3Url,
      'User-Agent': GARMIN_UA, 'Cookie': cookieHdr(),
    },
    maxRedirects: 0,
    validateStatus: () => true,
  });

  let resp = r4;
  // Follow up to 5 redirects manually so we can send cookies at each hop
  for (let hop = 0; hop < 5; hop++) {
    const loc = resp.headers?.location || '';
    const bodyStr = String(resp.data || '');
    console.log(`[Garmin MFA] hop${hop} status:`, resp.status, '| location:', loc);

    // Ticket in redirect Location header
    if (loc) {
      const mLoc = GARMIN_TICKET_RE.exec(loc);
      if (mLoc) return mLoc[1];
    }
    // Ticket in response body
    const mBody = GARMIN_TICKET_RE.exec(bodyStr);
    if (mBody) return mBody[1];

    // Not a redirect — no ticket found
    if (resp.status < 300 || resp.status >= 400 || !loc) {
      const hint = bodyStr.slice(0, 400).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error(`MFA failed (status ${resp.status}) — ${hint || 'no ticket returned'}`);
    }

    // Follow the redirect with cookies
    const nextUrl = loc.startsWith('http') ? loc : `${ssoOrigin}${loc}`;
    resp = await ax.get(nextUrl, {
      headers: { 'User-Agent': GARMIN_UA, 'Cookie': cookieHdr() },
      maxRedirects: 0,
      validateStatus: () => true,
    });
  }
  throw new Error('MFA redirect loop — gave up after 5 hops');
}

// Garmin Connect sync — body composition from Garmin Index scale
ipcMain.handle('garmin-sync', async (event, { username, password, mfaCode }) => {
  try {
    const { GarminConnect } = require('garmin-connect');
    let ticket;

    if (mfaCode && _garminMfaState) {
      // Second call: submit code against the saved session (no new login attempt)
      try {
        ticket = await withTimeout(
          garminSubmitMFA(_garminMfaState, mfaCode),
          20000, 'Garmin MFA submission timed out'
        );
      } catch (mfaErr) {
        _garminMfaState = null;
        if (mfaErr.response?.status === 429) {
          throw new Error('Garmin is rate-limiting requests — wait 10–15 minutes then try again');
        }
        throw mfaErr;
      }
      _garminMfaState = null;
    } else {
      // First call: fresh login, capture session for potential MFA
      _garminMfaState = null;
      const probe = new GarminConnect({ username, password });
      const loginResult = await withTimeout(
        garminDoLogin(username, password, probe.client.url),
        35000, 'Garmin login timed out — check credentials and try again'
      );
      if (loginResult.needsMFA) {
        _garminMfaState = loginResult.mfaState;
        return { needsMFA: true };
      }
      ticket = loginResult.ticket;
    }

    // Complete the OAuth flow using the library (getOauth1Token + exchange)
    const client = new GarminConnect({ username, password });
    client.client.getLoginTicket = async () => ticket;
    await withTimeout(client.login(), 35000, 'Garmin login timed out — check credentials and try again');

    const today = new Date().toISOString().slice(0, 10);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const startDate = twoYearsAgo.toISOString().slice(0, 10);

    const url = `https://connectapi.garmin.com/weight-service/weight/dateRange?startDate=${startDate}&endDate=${today}`;
    const data = await withTimeout(client.get(url), 30000, 'Garmin data fetch timed out');

    if (!data) return { error: 'Empty response from Garmin — check credentials' };

    // Log first record so we can verify field names
    const list = data.dateWeightList || data.weightList || [];
    if (list.length > 0) console.log('[Garmin] sample record:', JSON.stringify(list[0]));

    const daily = {};
    for (const r of list) {
      const date = r.calendarDate;
      if (!date) continue;
      const weightKg = r.weight != null ? +r.weight.toFixed(1)
        : r.weightKg != null ? +r.weightKg.toFixed(1)
        : r.weightInKg != null ? +r.weightInKg.toFixed(1)
        : r.bodyWeight != null ? +r.bodyWeight.toFixed(1)
        : null;
      daily[date] = {
        weightKg,
        bodyWater:  r.bodyWater  != null ? +r.bodyWater.toFixed(1)          : null,
        bodyFat:    r.bodyFat    != null ? +r.bodyFat.toFixed(1)            : null,
        muscleMass: r.muscleMass != null ? +(r.muscleMass / 1000).toFixed(1): null,
        boneMass:   r.boneMass   != null ? +(r.boneMass  / 1000).toFixed(2) : null,
      };
    }

    console.log(`[Garmin] synced ${Object.keys(daily).length} body comp records`);
    return { daily, recordCount: Object.keys(daily).length };
  } catch (err) {
    console.error('[Garmin] sync error:', err.message);
    return { error: err.message };
  }
});

// Whoop sync — paginates recovery records, refreshes token if needed
ipcMain.handle('whoop-sync', async (event, { clientId, clientSecret, accessToken, refreshToken }) => {
  let token = accessToken;
  let newRefresh = refreshToken;

  // Returns { ok: true } or { ok: false, reason: string }
  async function doRefresh() {
    if (!newRefresh) return { ok: false, reason: 'No refresh token stored — please re-authorise' };
    try {
      const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: newRefresh,
          redirect_uri: 'http://localhost:8788/callback',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) {
        console.log('[Whoop] refresh status:', res.status, '(unparseable response)');
        return { ok: false, reason: 'Refresh response was not valid JSON' };
      }
      console.log('[Whoop] refresh status:', res.status, data.access_token ? 'ok' : (data.error || 'unknown error'));
      if (data.access_token) {
        token = data.access_token;
        newRefresh = data.refresh_token || newRefresh;
        return { ok: true };
      }
      return { ok: false, reason: data.error_description || data.error || text };
    } catch (err) { return { ok: false, reason: err.message }; }
  }

  const WHOOP_BASE = 'https://api.prod.whoop.com/developer/v1';

  // Helper: fetch with automatic one-shot token refresh on 401
  async function whoopFetch(url, retriesLeft = 3) {
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    console.log('[Whoop] GET', url, '→', res.status);
    if (res.status === 401) {
      const r = await doRefresh();
      if (!r.ok) return { error: `Token refresh failed: ${r.reason}` };
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      console.log('[Whoop] retry →', res.status);
    }
    if (res.status === 429) {
      if (retriesLeft <= 0) return { error: 'Whoop API 429: rate limited', rateLimited: true };
      const retryAfterSec = parseInt(res.headers.get('retry-after'), 10);
      await delay((Number.isFinite(retryAfterSec) ? retryAfterSec : 5) * 1000);
      return whoopFetch(url, retriesLeft - 1);
    }
    if (!res.ok) {
      const body = await res.text();
      return { error: `Whoop API ${res.status}: ${body}` };
    }
    return { data: await res.json() };
  }

  try {
    // Probe v1, fall back to v2 if 404
    let recoveryBase = `${WHOOP_BASE}/recovery`;
    const probe = await whoopFetch(`${recoveryBase}?limit=1`);
    if (probe.error) {
      if (probe.error.includes('404')) {
        const v2url = 'https://api.prod.whoop.com/developer/v2/recovery?limit=1';
        const probe2 = await whoopFetch(v2url);
        if (probe2.error) return { error: `Recovery not found on v1 or v2.\nv1: ${probe.error}\nv2: ${probe2.error}` };
        recoveryBase = 'https://api.prod.whoop.com/developer/v2/recovery';
      } else {
        return { error: probe.error };
      }
    }

    // ---- Recovery records ----
    const daily = {};
    let nextToken = null;
    let recordCount = 0;
    let pages = 0;
    do {
      let url = `${recoveryBase}?limit=25`;
      if (nextToken) url += `&nextToken=${encodeURIComponent(nextToken)}`;
      const result = await whoopFetch(url);
      if (result.error) {
        if (pages === 0) return { error: result.error }; // failed before gathering anything — surface it
        console.log('[Whoop] recovery pagination stopped early (non-fatal):', result.error);
        break; // keep whatever pages we already gathered instead of discarding them
      }
      const body = result.data;
      if (pages === 0 && body.records && body.records.length > 0) {
        // Log sample score to diagnose missing HRV
        console.log('[Whoop] sample score keys:', Object.keys(body.records[0].score || {}));
        console.log('[Whoop] sample score:', JSON.stringify(body.records[0].score));
      }
      for (const r of (body.records || [])) {
        const date = (r.created_at || '').slice(0, 10);
        if (!date || !r.score) continue;
        daily[date] = {
          hrv: r.score.hrv_rmssd_milli != null ? Math.round(r.score.hrv_rmssd_milli) : null,
          rhr: r.score.resting_heart_rate != null ? Math.round(r.score.resting_heart_rate) : null,
          recoveryScore: r.score.recovery_score != null ? Math.round(r.score.recovery_score) : null,
          spo2: r.score.spo2_percentage != null ? +r.score.spo2_percentage.toFixed(1) : null,
        };
        recordCount++;
      }
      nextToken = body.next_token || null;
      pages++;
    } while (nextToken && pages < 100);

    // ---- Sleep records — probe several candidate paths ----
    const sleepCandidates = [
      recoveryBase.replace('/recovery', '/activity/sleep'),   // v2/activity/sleep
      `${WHOOP_BASE}/activity/sleep`,                          // v1/activity/sleep
      recoveryBase.replace('/recovery', '/sleep'),             // v2/sleep (tried, likely 404)
    ];
    let sleepBase = null;
    for (const candidate of sleepCandidates) {
      const probe = await whoopFetch(`${candidate}?limit=1`);
      console.log('[Whoop] sleep probe', candidate, '→', probe.error ? probe.error.slice(0, 40) : 'OK');
      if (!probe.error) { sleepBase = candidate; break; }
    }
    if (!sleepBase) { console.log('[Whoop] sleep endpoint not found — skipping'); }

    let sleepNext = null, sleepPages = 0;
    while (sleepBase) {
      let url = `${sleepBase}?limit=25`;
      if (sleepNext) url += `&nextToken=${encodeURIComponent(sleepNext)}`;
      const result = await whoopFetch(url);
      if (result.error) { console.log('[Whoop] sleep error (non-fatal):', result.error); break; }
      const body = result.data;
      if (sleepPages === 0 && body.records && body.records.length > 0) {
        console.log('[Whoop] sample sleep score:', JSON.stringify(body.records[0].score));
      }
      for (const r of (body.records || [])) {
        if (r.nap) continue;
        const date = (r.created_at || '').slice(0, 10);
        if (!date || !r.score) continue;
        const stages = r.score.stage_summary || {};
        const sleepMs = (stages.total_in_bed_time_milli || 0) - (stages.total_awake_time_milli || 0);
        const entry = daily[date] || { hrv: null, rhr: null, recoveryScore: null, spo2: null };
        entry.sleepScore = r.score.sleep_performance_percentage != null ? Math.round(r.score.sleep_performance_percentage) : null;
        entry.respRate   = r.score.respiratory_rate != null ? +r.score.respiratory_rate.toFixed(1) : null;
        entry.sleepHours = sleepMs > 0 ? Math.round(sleepMs / 360000) / 10 : null;
        daily[date] = entry;
      }
      sleepNext = body.next_token || null;
      sleepPages++;
      if (!sleepNext || sleepPages >= 100) break;
    }

    const sleepDates = Object.keys(daily).filter(d => daily[d].sleepScore != null);
    const recDates   = Object.keys(daily).filter(d => daily[d].recoveryScore != null);
    console.log(`[Whoop] daily summary: ${Object.keys(daily).length} total dates, ${recDates.length} with recovery, ${sleepDates.length} with sleep`);
    if (sleepDates.length > 0) console.log('[Whoop] sample sleep entry:', JSON.stringify(daily[sleepDates[0]]));
    return { daily, recordCount, newAccessToken: token, newRefreshToken: newRefresh };
  } catch (err) { return { error: err.message }; }
});

// Lightweight elevation + file-link fetch — uses plain HTTP, no BrowserWindow, ~10× faster than checkAudaxFiles
ipcMain.handle('audax-fetch-elevation', async (event, url) => {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? require('https') : require('http');
      const req = mod.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 12000,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const html = Buffer.concat(chunks).toString('utf8');
          const text = html.replace(/<[^>]+>/g, ' ').replace(/,/g, '').replace(/\s+/g, ' ');
          const patterns = [
            /Climb\w*\s*:?\s*(\d+)\s*m\b/i,
            /(?:Total\s+)?(?:Ascent|Elevation)\s*:?\s*(\d+)\s*m\b/i,
            /(\d{3,})\s*m\s+(?:of\s+)?(?:climb|ascent|elevation)/i,
          ];
          let elevation = null;
          for (const pat of patterns) {
            const m = text.match(pat);
            if (m) { elevation = parseInt(m[1], 10); break; }
          }
          // Extract file links from raw HTML (mirrors AUDAX_FILE_SCRIPT patterns)
          const files = [];
          const seen = new Set();
          const linkRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
          let lm;
          while ((lm = linkRe.exec(html)) !== null) {
            const rawHref = lm[1].trim();
            if (!rawHref || rawHref.startsWith('javascript:')) continue;
            let href = rawHref;
            try { href = new URL(rawHref, url).href; } catch (_) {}
            if (seen.has(href)) continue;
            const linkText = lm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            const hrefLow = href.toLowerCase();
            const textLow = linkText.toLowerCase();
            let type = null;
            if (/\.(gpx|tcx|kml|kmz|fit)(\?|$)/i.test(hrefLow)) type = 'GPS';
            else if (/\.pdf(\?|$)/i.test(hrefLow) && /route|sheet|brevet|cue|map|ride/i.test(textLow + ' ' + hrefLow)) type = 'Route';
            else if (/\bgpx\b|\bgps\b|gps.?track|download.{0,20}(route|track|gps)/i.test(textLow)) type = 'GPS';
            else if (/route.?sheet|routesheet|cue.?sheet|brevet.?card/i.test(textLow)) type = 'Route';
            if (type) { seen.add(href); files.push({ url: href, name: linkText || type, type }); }
          }
          resolve({ elevation, files });
        });
        res.on('error', () => resolve({ elevation: null, files: [] }));
      });
      req.on('error', () => resolve({ elevation: null, files: [] }));
      req.on('timeout', () => { req.destroy(); resolve({ elevation: null, files: [] }); });
    } catch (_) {
      resolve({ elevation: null, files: [] });
    }
  });
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#F5F0E6',
    icon: path.join(__dirname, 'assets', 'bicyclist.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.loadFile('index.html');
}

// Auto-update configuration
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let updateInfo = null;

autoUpdater.on('update-available', (info) => {
  console.log('[Update] Available:', info.version);
  updateInfo = info;
  if (BrowserWindow.getAllWindows().length > 0) {
    BrowserWindow.getAllWindows()[0].webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('[Update] No updates available');
  updateInfo = null;
});

autoUpdater.on('download-progress', (progress) => {
  console.log('[Update] Download progress:', Math.round(progress.percent) + '%');
  if (BrowserWindow.getAllWindows().length > 0) {
    BrowserWindow.getAllWindows()[0].webContents.send('update-download-progress', progress);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Update] Downloaded:', info.version);
  if (BrowserWindow.getAllWindows().length > 0) {
    BrowserWindow.getAllWindows()[0].webContents.send('update-downloaded', info);
  }
});

autoUpdater.on('error', (err) => {
  console.error('[Update] Error:', err.message);
  if (BrowserWindow.getAllWindows().length > 0) {
    BrowserWindow.getAllWindows()[0].webContents.send('update-error', err.message);
  }
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: result?.updateInfo != null, info: result?.updateInfo };
  } catch (err) {
    console.error('[Update] Check failed:', err.message);
    return { error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

app.whenReady().then(() => {
  migrateFromAppData();
  createWindow();

  // Check for updates on launch (after a short delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.log('[Update] Auto-check failed:', err.message);
    });
  }, 3000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

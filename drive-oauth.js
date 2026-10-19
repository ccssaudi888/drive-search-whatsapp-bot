// Google Drive backend via official OAuth 2.0 (for production hosting, e.g. Render).
// Same interface as drive.js (CLI backend): searchDrive, downloadDriveFile,
// checkConnection, isSendable, formatResults.
//
// Env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function oauth2Client(redirectUri) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || `${process.env.PUBLIC_URL || ''}/oauth/callback`
  );
}

function driveClient() {
  const auth = oauth2Client();
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

function consentUrl(redirectUri) {
  return oauth2Client(redirectUri).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function exchangeCode(code, redirectUri) {
  const { tokens } = await oauth2Client(redirectUri).getToken(code);
  return tokens;
}

function escapeQuery(q) {
  return String(q).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function checkConnection() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return false;
  try {
    await driveClient().about.get({ fields: 'user' });
    return true;
  } catch {
    return false;
  }
}

async function searchDrive(query, pageSize = 5) {
  const safe = escapeQuery(query.trim());
  const q = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
  const res = await driveClient().files.list({
    q,
    pageSize,
    fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)',
    orderBy: 'modifiedTime desc',
  });
  return (res.data.files || []).map(f => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink,
    size: f.size,
  }));
}

const GOOGLE_NATIVE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

function isSendable(file) {
  return !GOOGLE_NATIVE.has(file.mimeType);
}

async function downloadDriveFile(file, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const safeName = file.name.replace(/[^\w.\- ()[\]]+/g, '_');
  const dest = path.join(destDir, `${file.id}_${safeName}`);
  const res = await driveClient().files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(dest);
    res.data.on('end', resolve).on('error', reject).pipe(w);
    w.on('error', reject);
  });
  return dest;
}

function formatResults(files) {
  return files
    .map((f, i) => `${i + 1}. ${f.name}${f.size ? ` (${fmtSize(f.size)})` : ''}`)
    .join('\n');
}

function fmtSize(bytes) {
  const n = Number(bytes);
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let s = n, k = 0;
  while (s >= 1024 && k < u.length - 1) { s /= 1024; k++; }
  return `${s.toFixed(1)} ${u[k]}`;
}

module.exports = { searchDrive, downloadDriveFile, checkConnection, isSendable, formatResults, consentUrl, exchangeCode };

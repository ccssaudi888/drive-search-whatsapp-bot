// WhatsApp bot — official Cloud API adapter.
// Meta sends incoming messages to POST /webhook; we reply via the Graph API.
//
// Env vars:
//   WHATSAPP_TOKEN   - permanent access token (System User) from Meta App Dashboard
//   PHONE_NUMBER_ID  - Phone Number ID from WhatsApp > API Setup
//   VERIFY_TOKEN     - any secret string you choose (must match Meta webhook config)
//   PORT             - default 3000
//
// Meta webhook setup: Callback URL = https://<your-public-host>/webhook
// Subscribe to the "messages" field.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { executeCommand } = require('../commands');

// OAuth backend helpers (only used when DRIVE_BACKEND=oauth)
let driveOauth = null;
try { driveOauth = require('../drive-oauth'); } catch { /* cli backend in use */ }

const { WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN } = process.env;
const PORT = process.env.PORT || 3000;
const GRAPH = 'https://graph.facebook.com/v21.0';

const results = new Map(); // chatId -> last search results

async function graphFetch(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Graph API ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function sendText(to, text) {
  await graphFetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  });
}

async function uploadMedia(localPath, mimeType) {
  const buf = fs.readFileSync(localPath);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeType }), path.basename(localPath));
  form.append('messaging_product', 'whatsapp');
  const j = await graphFetch(`${GRAPH}/${PHONE_NUMBER_ID}/media`, { method: 'POST', body: form });
  if (!j.id) throw new Error('media upload failed: ' + JSON.stringify(j).slice(0, 200));
  return j.id;
}

async function sendDocument(to, localPath, filename, mimeType) {
  const mediaId = await uploadMedia(localPath, mimeType);
  await graphFetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { id: mediaId, filename },
    }),
  });
}

const app = express();
app.use(express.json());

// Webhook verification (Meta calls this once when you configure the webhook)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Incoming messages
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // ack immediately; process async
  (async () => {
    try {
      const changes = req.body.entry?.[0]?.changes || [];
      for (const ch of changes) {
        const messages = ch.value?.messages || [];
        for (const m of messages) {
          if (m.type !== 'text' || !m.text?.body) continue;
          await executeCommand(
            {
              results,
              replyText: (to, t) => sendText(to, t),
              replyFile: (to, p, name, mime) => sendDocument(to, p, name, mime),
            },
            m.from,
            m.text.body
          );
        }
      }
    } catch (e) {
      console.error('webhook error:', e.message);
    }
  })();
});

app.get('/health', (_req, res) => res.send('ok'));

// Privacy policy page (required by Meta to switch the app to Live mode)
app.get('/privacy', (_req, res) => {
  res.send(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DriveBot — Privacy Policy</title></head>' +
    '<body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 16px">' +
    '<h1>DriveBot — Privacy Policy</h1>' +
    '<p><b>Last updated:</b> October 2026</p>' +
    '<p>DriveBot is a personal WhatsApp bot that searches your Google Drive and sends you files on request.</p>' +
    '<h3>Data we collect</h3>' +
    '<ul><li>Your WhatsApp phone number and the text of messages you send to the bot (needed to reply to you).</li>' +
    '<li>Google Drive file names and metadata from the Google account you connect (needed to search your Drive).</li></ul>' +
    '<h3>How we use it</h3>' +
    '<p>Your data is used only to operate the bot: receiving your WhatsApp messages and searching your Google Drive. ' +
    'We do not sell, rent, or share your data with third parties for marketing.</p>' +
    '<h3>Data storage</h3>' +
    '<p>Messages are processed in memory and not stored. Google Drive access uses OAuth tokens stored securely on our hosting provider.</p>' +
    '<h3>Contact</h3>' +
    '<p>For privacy questions, contact: shaizalhafeez@gmail.com</p>' +
    '</body></html>'
  );
});

// Public homepage (so the public URL validates as a real website)
app.get('/', (_req, res) => {
  res.send(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>DriveBot — WhatsApp Google Drive Search</title></head>' +
    '<body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 16px">' +
    '<h1>DriveBot</h1>' +
    '<p>WhatsApp bot that searches your Google Drive and sends you files instantly.</p>' +
    '<p>Message the bot on WhatsApp with commands like <b>dhoondo &lt;filename&gt;</b>, ' +
    '<b>bhejo &lt;n&gt;</b>, <b>link &lt;n&gt;</b> or <b>madad</b>.</p>' +
    '<p style="color:#666">Service status: <a href="/health">operational</a></p>' +
    '</body></html>'
  );
});

// ---- Google Drive OAuth (DRIVE_BACKEND=oauth) ----
// 1. Visit /oauth -> Google consent screen -> redirect back to /oauth/callback
// 2. Callback shows a refresh token -> save it as GOOGLE_REFRESH_TOKEN env var -> redeploy
app.get('/oauth', (req, res) => {
  if (!driveOauth) return res.status(500).send('OAuth backend available nahi (DRIVE_BACKEND=oauth set karein).');
  const redirectUri = `${process.env.PUBLIC_URL}/oauth/callback`;
  res.redirect(driveOauth.consentUrl(redirectUri));
});

app.get('/oauth/callback', async (req, res) => {
  try {
    const redirectUri = `${process.env.PUBLIC_URL}/oauth/callback`;
    const tokens = await driveOauth.exchangeCode(req.query.code, redirectUri);
    if (!tokens.refresh_token) {
      return res.send('Refresh token nahi mila. <a href="/oauth">Dobara try karein</a>.');
    }
    res.send(
      '<h3>Google Drive connect ho gaya!</h3>' +
      '<p>Neeche wala <b>refresh token</b> copy karke hosting ke Environment me ' +
      '<b>GOOGLE_REFRESH_TOKEN</b> naam se save karein, phir redeploy/restart karein:</p>' +
      `<pre style="word-break:break-all">${tokens.refresh_token}</pre>`
    );
  } catch (e) {
    res.status(500).send('OAuth error: ' + e.message);
  }
});

if (require.main === module) {
  if (!process.env.VERIFY_TOKEN) {
    console.error('Missing env var: VERIFY_TOKEN');
    process.exit(1);
  }
  if (!process.env.WHATSAPP_TOKEN || !process.env.PHONE_NUMBER_ID) {
    console.warn('WARNING: WHATSAPP_TOKEN / PHONE_NUMBER_ID missing — webhook verification will work, but sending messages will fail until they are set.');
  }
  app.listen(PORT, () => console.log(`Cloud API bot webhook sun raha hai: :${PORT}/webhook`));
}

module.exports = { app };

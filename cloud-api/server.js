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

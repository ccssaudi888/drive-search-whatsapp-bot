// Shared bot command logic — transport-agnostic.
// Both adapters (whatsapp-web.js and Cloud API) call executeCommand().
//
// deps = {
//   results:   Map(chatId -> [{id,name,mimeType,webViewLink,...}])  // per-chat last search
//   replyText: async (chatId, text) => void
//   replyFile: async (chatId, localPath, fileName, mimeType) => void
// }
const fs = require('fs');
const path = require('path');
// Drive backend: 'oauth' for production hosting (Render etc.), 'cli' for local dev on this VM.
const drive = process.env.DRIVE_BACKEND === 'oauth' ? require('./drive-oauth') : require('./drive');
const { searchDrive, downloadDriveFile, checkConnection, isSendable, formatResults } = drive;

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

const HELP = [
  'Drive Search Bot',
  '',
  'dhoondo <naam> - Drive me file dhoondo',
  'bhejo <number> - result wali file WhatsApp par bhejo',
  'link <number> - file ka Drive link do',
  'madad - yeh madad dobara dekho',
  '',
  'Ya seedha file ka naam likh do, main dhoond dunga.',
].join('\n');

function parseCommand(text) {
  const t = String(text || '').trim();
  let m;
  if (/^(madad|help)$/i.test(t)) return { cmd: 'help' };
  if ((m = t.match(/^(dhoondo|dhoond|find|search|talash)\s+(.+)$/i))) return { cmd: 'search', query: m[2] };
  if ((m = t.match(/^(bhejo|send|bhej)\s+(\d+)$/i))) return { cmd: 'send', index: Number(m[2]) - 1 };
  if ((m = t.match(/^(link)\s+(\d+)$/i))) return { cmd: 'link', index: Number(m[2]) - 1 };
  if (t.length >= 2) return { cmd: 'search', query: t }; // plain text = search
  return { cmd: 'help' };
}

async function executeCommand(deps, chatId, text) {
  const { cmd, query, index } = parseCommand(text);
  const results = deps.results;

  if (cmd === 'help') {
    await deps.replyText(chatId, HELP);
    return;
  }

  if (cmd === 'search') {
    if (!(await checkConnection())) {
      await deps.replyText(chatId, 'Google Drive abhi connect nahi hai. Pehle Muse chat me Drive connect karein, phir dobara try karein.');
      return;
    }
    await deps.replyText(chatId, `Dhoond raha hun: "${query}" ...`);
    let files;
    try {
      files = await searchDrive(query, 5);
    } catch (e) {
      await deps.replyText(chatId, 'Drive search me masla hua: ' + e.message);
      return;
    }
    if (!files.length) {
      await deps.replyText(chatId, `Kuch nahi mila "${query}" ke liye. Koi aur naam try karein.`);
      return;
    }
    results.set(chatId, files);
    await deps.replyText(
      chatId,
      `Mil gaye (${files.length}):\n${formatResults(files)}\n\n"bhejo 1" likhein file WhatsApp par pane ke liye, ya "link 2" link ke liye.`
    );
    return;
  }

  if (cmd === 'send') {
    const files = results.get(chatId);
    if (!files || !files[index]) {
      await deps.replyText(chatId, 'Pehle kuch dhoondein, phir "bhejo <number>" likhein.');
      return;
    }
    const file = files[index];
    if (!isSendable(file)) {
      await deps.replyText(chatId, `"${file.name}" Google Doc/Sheet/Slides hai, WhatsApp par file ki tarah nahi bhej sakta.\nLink: ${file.webViewLink}`);
      return;
    }
    await deps.replyText(chatId, `Bhej raha hun: ${file.name} ...`);
    try {
      const local = await downloadDriveFile(file, DOWNLOAD_DIR);
      await deps.replyFile(chatId, local, file.name, file.mimeType || 'application/octet-stream');
      fs.unlinkSync(local);
    } catch (e) {
      await deps.replyText(chatId, 'File bhejne me masla hua: ' + e.message);
    }
    return;
  }

  if (cmd === 'link') {
    const files = results.get(chatId);
    if (!files || !files[index]) {
      await deps.replyText(chatId, 'Pehle kuch dhoondein, phir "link <number>" likhein.');
      return;
    }
    const file = files[index];
    await deps.replyText(chatId, `${file.name}\n${file.webViewLink}`);
    return;
  }
}

module.exports = { parseCommand, executeCommand, HELP };

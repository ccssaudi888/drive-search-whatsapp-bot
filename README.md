# Drive Search WhatsApp Bot

A WhatsApp bot that searches **your Google Drive** and sends files on request.
Two WhatsApp adapters, same Drive-search brain (`commands.js` + `drive.js`):

- **Route A — whatsapp-web.js** (`npm start`): personal number, QR scan. Unofficial.
- **Route B — official Cloud API** (`npm run start:cloud`): separate business number. Official, no ban risk.

## Commands (English + Roman Urdu)

| Message | Kya hota hai |
|---|---|
| `dhoondo <naam>` / `find <naam>` | Drive me file dhoondo (top 5 results) |
| `<seedha naam likh do>` | Bina command ke bhi search ho jata hai |
| `bhejo 1` / `send 2` | Result wali file WhatsApp par document ki tarah bhejo |
| `link 1` | File ka Drive link bhejo |
| `madad` / `help` | Madad dobara dekho |

Google Docs/Sheets/Slides WhatsApp par file ki tarah nahi bheje ja sakte —
un ke liye bot Drive link bhejta hai.

## Route B: Official WhatsApp Cloud API (recommended)

**Aapko chahiye:**
1. Ek **alag phone number** (spare SIM/eSIM) jo WhatsApp par registered **na** ho aur SMS/voice OTP receive kar sake.
2. [developers.facebook.com](https://developers.facebook.com) par developer account → **Create App** (Business type) → **WhatsApp** product add karein.
3. **WhatsApp > API Setup** me woh number add karke OTP se verify karein.
4. Wahan se note karein: **Phone Number ID** aur **Access Token** (pehle temporary token se test, phir permanent System User token banayein).
5. **Webhook**: Callback URL = `https://<aapka-server>/webhook`, Verify Token = koi secret string (`.env` me `VERIFY_TOKEN` se match hona chahiye). **messages** field subscribe karein.

**Server chalana:**
```sh
cd whatsapp-drive-bot
npm install
WHATSAPP_TOKEN=... PHONE_NUMBER_ID=... VERIFY_TOKEN=... npm run start:cloud
```

Google Drive search isi machine ke Drive connector CLI se hota hai — jahan
bot chale, wahan Drive connected hona chahiye.

## Route A: whatsapp-web.js (personal number, local dev)

> Note: is route ke liye alag se install karein: `npm i whatsapp-web.js qrcode-terminal`

1. Node.js 20+ install karein.
2. Is folder me `npm install` chalayein.
3. `npm start` chalayein — terminal me QR code aayega.
4. Apne phone par **WhatsApp > Linked Devices > Link a device** se QR scan karein.
5. Jis number se scan kiya, bot usi number par chalega.

Google Drive connector CLI (`/opt/hatch/bin/hatch_gws_cli`) isi machine par
authenticated hona chahiye — Drive search usi account me hota hai.

## 24/7 chalane ke liye

- VPS/Render/Railway par deploy karein aur process manager use karein:
  `pm2 start ... --name drive-bot` ya systemd service.
- Route A me `.wwebjs_auth/` folder me login session save rehta hai — QR dobara
  scan nahi karna parta jab tak logout na ho.

## Zaroori note (Route A ka risk)

whatsapp-web.js **unofficial** API hai. WhatsApp automation ko officially
support nahi karta — rare cases me number par temporary ban lag sakta hai.
Agar number buhat ahem hai to alag number use karein, ya Route B chunein.

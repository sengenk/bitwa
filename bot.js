// Bot WhatsApp Baileys - Fitur: .ai, .stiker, .toimg, .termbin, .wiki, .play
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const sharp = require('sharp');
const FormData = require('form-data');
const net = require('net');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const puppeteer = require('puppeteer');
ffmpeg.setFfmpegPath(ffmpegPath);

const createLogger = (prefix) => ({
  trace: (msg, ...args) => console.debug(`[${prefix}] TRACE`, msg, ...args),
  debug: (msg, ...args) => console.debug(`[${prefix}] DEBUG`, msg, ...args),
  info: (msg, ...args) => console.log(`[${prefix}] INFO`, msg, ...args),
  warn: (msg, ...args) => console.warn(`[${prefix}] WARN`, msg, ...args),
  error: (msg, ...args) => console.error(`[${prefix}] ERROR`, msg, ...args),
  fatal: (msg, ...args) => console.error(`[${prefix}] FATAL`, msg, ...args),
  child: (bindings) => createLogger(`${prefix}:${bindings?.tags || ''}`)
});

const logger = createLogger('BOT');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const sock = makeWASocket({ auth: state, logger, printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (!messages || !messages[0]) return;
    const msg = messages[0];
    const from = msg.key.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

    if (text.startsWith('.ai ')) {
      const query = text.slice(4);
      try {
        const res = await axios.post('http://192.168.1.2:1234/v1/chat/completions', {
          model: "deepseek-r1-distill-qwen-7b",
          messages: [
            { role: "system", content: "Bro, lo adalah AI paling keren yang cuma boleh jawab pakai bahasa Indonesia. Jangan pernah pakai bahasa lain!" },
            { role: "user", content: query }
          ]
        }, { headers: { 'Content-Type': 'application/json' } });

        const reply = res.data.choices[0].message.content;
        await sock.sendMessage(from, { text: reply });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ AI error. Coba lagi nanti.' });
      }
    }

    if (text === '.stiker') {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.imageMessage) {
        const media = await downloadMediaMessage({ key: msg.key, message: quoted }, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        const webp = await sharp(media).resize(512, 512).webp().toBuffer();
        await sock.sendMessage(from, { sticker: webp, quoted: msg });
      }
    }

    if (text === '.toimg') {
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (quoted?.stickerMessage) {
        const media = await downloadMediaMessage({ key: msg.key, message: quoted }, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
        const jpeg = await sharp(media).jpeg().toBuffer();
        await sock.sendMessage(from, { image: jpeg, caption: '✅ Stiker berhasil diubah ke gambar.', quoted: msg });
      }
    }

    if (text === '.termbin') {
      let content = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || '';

      if (!content) return sock.sendMessage(from, { text: '❌ Balas pesan teks dengan ".termbin"', quoted: msg });

      const client = new net.Socket();
      let response = '';

      client.connect(9999, 'termbin.com', () => client.write(content + '\n'));
      client.on('data', (data) => response += data.toString());
      client.on('end', () => sock.sendMessage(from, { text: `✅ Uploaded:
${response.trim()}`, quoted: msg }));
      client.on('error', () => sock.sendMessage(from, { text: '❌ Gagal menghubungi Termbin.', quoted: msg }));
    }

    if (text.startsWith('.wiki ')) {
      const keyword = text.slice(6);
      try {
        const res = await axios.get(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(keyword)}`);
        const data = res.data;
        if (data.type === 'standard') {
          const result = `📚 *${data.title}*
${data.extract}
🔗 ${data.content_urls.desktop.page}`;
          await sock.sendMessage(from, { text: result, quoted: msg });
        } else throw new Error('Not standard');
      } catch {
        await sock.sendMessage(from, { text: '❌ Artikel tidak ditemukan.', quoted: msg });
      }
    }

    if (text.startsWith('.play ')) {
      const query = text.slice(6);
      try {
        const r = await yts(query);
        const video = r.videos[0];
        const info = await ytdl.getInfo(video.url);
        const stream = ytdl.downloadFromInfo(info, { quality: 'highestaudio' });
        const path = `/tmp/${Date.now()}.mp3`;

        await new Promise((resolve, reject) => {
          ffmpeg(stream).audioBitrate(128).save(path).on('end', resolve).on('error', reject);
        });

        const audio = fs.readFileSync(path);
        fs.unlinkSync(path);
        await sock.sendMessage(from, { audio, mimetype: 'audio/mp4', ptt: false, quoted: msg });
      } catch (e) {
        await sock.sendMessage(from, { text: '❌ Gagal memutar lagu.', quoted: msg });
      }
    }

    if (text === '.menu') {
      const menuText = `📌 *Menu Bot:*

🧠 .ai [tanya] - Chat dengan AI
🎵 .play [lagu] - Cari dan download lagu
🖼️ .stiker - Ubah gambar jadi stiker
🧩 .toimg - Ubah stiker jadi gambar
📚 .wiki [topik] - Cari info Wikipedia
📄 .termbin - Upload teks ke Termbin

Balas gambar/stiker/teks sesuai fitur.`;
      await sock.sendMessage(from, { text: menuText, quoted: msg });
    }
  });
}

startBot().catch(err => {
  logger.fatal('Gagal memulai bot:', err);
  process.exit(1);
});


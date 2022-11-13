const prefix = "/";
const { WAConnection, MessageType } = require("@adiwajshing/baileys");
const axios = require("axios");
const fs = require("fs");
const didYouMean = require("didyoumean");

WAConnection.prototype.get = function (message, callback) {
  if (!this.commands) this.commands = {};
  this.commands[message] = callback;
};

const conn = new WAConnection();

conn.on("qr", () => {
  console.log("Scan QR");
});

conn.on("open", () => {
  console.log("Open");
  const authInfo = conn.base64EncodedAuthInfo();

  fs.writeFileSync("./session.json", JSON.stringify(authInfo, null, "\t"));
});

fs.existsSync("./session.json") && conn.loadAuthInfo("./session.json");

conn.connect();

conn.on("chat-update", async (chat) => {
  if (!chat.hasNewMessage) return;

  if (!chat.messages && !chat.count) return;

  if (!chat) return;

  const content = chat.messages.all()[0];
  const mtype = Object.keys(content.message)[0];

  const body =
    mtype == "conversation" && content.message.conversation.startsWith(prefix)
      ? content.message.conversation
      : mtype == "extendedTextMessage" &&
        content.message.extendedTextMessage.text.startsWith(prefix)
      ? content.message.extendedTextMessage.text
      : mtype == "imageMessage" &&
        content.message.imageMessage.caption.startsWith(prefix)
      ? content.message.imageMessage.caption
      : mtype == "videoMessage" &&
        content.message.videoMessage.caption.startsWith(prefix)
      ? content.message.videoMessage.caption
      : "";
  const from = content.key.remoteJid.includes("@s.whatsapp.net")
    ? content.key.remoteJid.replace("@s.whatsapp.net", "@c.us")
    : content.key.remoteJid;
  const argv = body.slice(1).trim().split(/ +/).shift().toLowerCase();
  const args = body.trim().split(/ +/).slice(1);

  const mean = Object.keys(conn.commands);
  if (didYouMean(argv, mean) in conn.commands && !(argv in conn.commands)) {
    conn.sendMessage(
      from,
      `Mungkin yang anda maksud adalah ${prefix}${didYouMean(argv, mean)}`,
      "conversation",
      { quoted: content }
    );
  }
  if (argv in conn.commands) {
    conn.commands[argv](content, args);
    console.log(`[ USED COMMAND ] ${argv}`);
    await conn.chatRead(from);
  }
});

conn.on("message-delete", (tes) => {
  console.log(tes);
});

conn.get("help", (m) => {
  conn.sendMessage(m.key.remoteJid, "Hello", MessageType.extendedText);
});

conn.get("eval", (m, args) => {
  const code = args.join` `;
  const evaled = eval(code);

  conn.sendMessage(m.key.remoteJid, evaled, MessageType.extendedText);
});

conn.get("conv", async (m) => {
  const media = JSON.parse(JSON.stringify(m).replace("quotedM", "m")).message
    .extendedTextMessage.contextInfo;

  await conn.downloadAndSaveMediaMessage(media);
});

conn.get("liat", async (m) => {
  if (!m.message.extendedTextMessage.contextInfo) return;
  const { stanzaId: messageId } = m.message.extendedTextMessage.contextInfo;

  const loadM = await conn.loadMessage(m.key.remoteJid, messageId);
  const media = JSON.parse(JSON.stringify(loadM).replace("quotedM", "m"))
    .message.extendedTextMessage.contextInfo;
  const buff = await conn.downloadMediaMessage(media);

  conn.sendMessage(m.key.remoteJid, buff, MessageType.image);
});

conn.get("curi", async (m, args) => {
  if (!m.message.extendedTextMessage) return;
  const mtype = Object.keys(
    m.message.extendedTextMessage.contextInfo.quotedMessage
  )[0];
  if (mtype != "stickerMessage") return;

  let author;
  let pack;
  try {
    author = args.join` `.split("|")[0];
    pack = args.join` `.split("|")[1];
  } catch {
    author = "\u2800";
    pack = "@mrr_rizqi_7387";
  }

  function convertSticker(base64, author = "\u2800", pack = "@mrr_rizqi_7387") {
    return new Promise((resolve, reject) => {
      axios("https://sticker-api-tpe3wet7da-uc.a.run.app/prepareWebp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",

          "Content-Type": "application/json;charset=utf-8",

          "User-Agent": "axios/0.21.1",

          "Content-Length": 151330,
        },

        data: `{"image": "${base64}","stickerMetadata":{"author":"${author}","pack":"${pack}","keepScale":true,"removebg":"HQ"},"sessionInfo":{"WA_VERSION":"2.2106.5","PAGE_UA":"WhatsApp/2.2037.6 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36","WA_AUTOMATE_VERSION":"3.6.10 UPDATE AVAILABLE: 3.6.11","BROWSER_VERSION":"HeadlessChrome/88.0.4324.190","OS":"Windows Server 2016","START_TS":1614310326309,"NUM":"6247","LAUNCH_TIME_MS":7934,"PHONE_VERSION":"2.20.205.16"},"config":{"sessionId":"session","headless":true,"qrTimeout":20,"authTimeout":0,"cacheEnabled":false,"useChrome":true,"killProcessOnBrowserClose":true,"throwErrorOnTosBlock":false,"chromiumArgs":["--no-sandbox","--disable-setuid-sandbox","--aggressive-cache-discard","--disable-cache","--disable-application-cache","--disable-offline-load-stale-cache","--disk-cache-size=0"],"executablePath":"C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe","skipBrokenMethodsCheck":true,"stickerServerEndpoint":true}}`,
      })
        .then(({ data }) => {
          resolve(data.webpBase64);
        })
        .catch(reject);
    });
  }

  const media = JSON.parse(JSON.stringify(m).replace("quotedM", "m")).message
    .extendedTextMessage.contextInfo;
  const encmed = await conn.downloadMediaMessage(media);
  convertSticker(encmed.toString("base64"), author, pack).then((data) => {
    const buff = Buffer.from(data, "base64");
    // console.log(buff)
    // fs.writeFileSync("./im.jpeg", buff)
    conn.sendMessage(m.key.remoteJid, buff, MessageType.sticker);
  });
});

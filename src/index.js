const {
  default: WASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
} = require("@adiwajshing/baileys");
const Pino = require("pino");
const { Boom } = require("@hapi/boom");
const path = require("path").join;
const axios = require("axios");
const { serialize, store } = require("../function/index.js");

const start = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(path("./session"));
  let { version, isLatest } = await fetchLatestWaWebVersion();

  console.log(`Using: ${version}, newer: ${isLatest}`);

  const sock = WASocket({
    printQRInTerminal: true,
    auth: state,
    logger: Pino({ level: "silent" }),
    version,
  });

  store.bind(sock.ev);
  sock.chats = store.chats;

  // console.log(sock.ev);
  // creds.update
  sock.ev.on("creds.update", saveCreds);

  // connection.update
  sock.ev.on("connection.update", async (up) => {
    const { lastDisconnect, connection } = up;
    if (connection) {
      console.log("Connection Status: ", connection);
    }

    if (connection === "close") {
      let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(`Bad Session File, Please Delete session and Scan Again`);
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Connection closed, reconnecting....");
        start();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Connection Lost from Server, reconnecting...");
        start();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Connection Replaced, Another New Session Opened, Please Close Current Session First"
        );
        sock.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(`Device Logged Out, Please Delete session and Scan Again.`);
        sock.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Restart Required, Restarting...");
        start();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Connection TimedOut, Reconnecting...");
        start();
      } else {
        sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      if (m.type !== "notify") return;
      let msg = serialize(JSON.parse(JSON.stringify(m.messages[0])), sock);
      if (!msg.message) return;
      if (msg.key && msg.key.remoteJid === "status@broadcast") return;
      if (
        msg.type === "protocolMessage" ||
        msg.type === "senderKeyDistributionMessage" ||
        !msg.type ||
        msg.type === ""
      )
        return;
      const { body } = msg;
      const prefix = "/";
      const argv = body.startsWith(prefix)
        ? body.slice(1).trim().split(/ +/).shift().toLowerCase()
        : "";
      const args = body.startsWith(prefix)
        ? body.trim().split(/ +/).slice(1)
        : "";

      // if (argv in msg.commands) {
      // msg.commands[argv](body, args);
      // }
      function clean(code) {
        if (typeof code === "string")
          return code
            .replace(/`/g, `\`${String.fromCharCode(8203)}`)
            .replace(/@/g, `@${String.fromCharCode(8203)}`);
        else return code;
      }

      function convertSticker(
        base64,
        author = "\u2800",
        pack = "@mrizqirmdhn_"
      ) {
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

      switch (argv) {
        case "eval":
          let code = args.join(" ");
          let text = "";
          try {
            const input = clean(code);
            if (!code) return await msg.reply("What your JavaScript code?");
            text = `*INPUT*\n\`\`\`${input}\`\`\`\n`;

            let evaled;
            if (code.includes("-s") && code.includes("-as")) {
              code = code.replace("-as", "").replace("-s", "");

              return await eval(`(async() => { ${code} })()`);
            } else if (code.includes("-as")) {
              code = code.replace("-as", "");

              evaled = await eval(`(async() => { ${code} })()`);
            } else if (code.includes("-s")) {
              code = code.replace("-s", "");

              return await eval(code);
            } else evaled = await eval(code);

            if (typeof evaled !== "string")
              evaled = require("util").inspect(evaled, { depth: 0 });

            let output = clean(evaled);
            text += `\n*OUTPUT*\n\`\`\`${output}\n\`\`\``;
            await msg.reply(text);
          } catch (e) {
            const err = clean(e);
            text += `\n*ERROR*\n\`\`\`${err}\n\`\`\``;
            await msg.reply(text);
          }
          break;
        case "s":
          var author;
          var pack;
          try {
            author = args.join` `.split("|")[0];
            pack = args.join` `.split("|")[1];
          } catch {
            author = "\u2800";
            pack = "@mrizqirmdhn_";
          }
          convertSticker(
            (msg.quoted
              ? await msg.quoted.download()
              : await msg.download()
            ).toString("base64"),
            author,
            pack
          ).then(async (data) => {
            const buff = Buffer.from(data, "base64");
            await sock.sendMessage(
              msg.from,
              { sticker: buff },
              { quoted: msg }
            );
          });
          break;
        case "curi":
          if (msg.quoted.mtype != "stickerMessage") return;
          var author;
          var pack;
          try {
            author = args.join` `.split("|")[0];
            pack = args.join` `.split("|")[1];
          } catch {
            author = "\u2800";
            pack = "@mrr_rizqi_7387";
          }
          convertSticker((await msg.quoted.download()).toString("base64")).then(
            async (data) => {
              const buff = Buffer.from(data, "base64");
              await sock.sendMessage(
                msg.from,
                { sticker: buff },
                { quoted: msg }
              );
            }
          );
      }
    } catch (e) {
      console.error(e);
    }
  });
};

start();

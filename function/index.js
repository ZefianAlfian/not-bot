const fs = require("fs");
const Bluebird = require("bluebird");
const {
  proto,
  getContentType,
  jidDecode,
  downloadContentFromMessage,
} = require("@whiskeysockets/baileys");

/**
 * Custom memoryStore
 * Source @adiwajshing/baileys/src/Store
 */
const { default: KeyedDB } = require("@adiwajshing/keyed-db");
const { existsSync, promises } = require("fs");
const { join } = require("path");
const waChatKey = (pin) => ({
  key: (c) =>
    (pin ? (c.pin ? "1" : "0") : "") +
    (c.archive ? "0" : "1") +
    (c.conversationTimestamp
      ? c.conversationTimestamp.toString(16).padStart(8, "0")
      : "") +
    c.id,
  compare: (k1, k2) => k2.localeCompare(k1),
});
let chatKey = waChatKey(true);

const chats = new KeyedDB(chatKey, (c) => c.id);

const toJSON = () => ({
  chats,
});

const fromJSON = (json) => {
  chats.upsert(...json.chats);
};

const bind = (ev) => {
  ev.on("chats.set", ({ chats: newChats, isLatest }) => {
    if (isLatest) {
      chats.clear();
    }
    const chatsAdded = chats.insertIfAbsent(...newChats).length;
    console.log(chatsAdded, "synced chats");
  });
  ev.on("chats.upsert", (newChats) => {
    chats.upsert(...newChats);
  });
  ev.on("chats.update", (updates) => {
    for (let update of updates) {
      const result = chats.update(update.id, (chat) => {
        if (update.unreadCount > 0) {
          update = { ...update };
          update.unreadCount = chat.unreadCount + update.unreadCount;
        }

        Object.assign(chat, update);
      });
      if (!result) {
        // console.log('got update for non-existant chat')
      }
    }
  });
  ev.on("chats.delete", (deletions) => {
    for (const item of deletions) {
      chats.deleteById(item);
    }
  });
};
async function writeToFile(filename) {
  let $path = join(__dirname, filename ? filename : "baileys-store.json");
  await promises.writeFile($path, JSON.stringify(toJSON(), null, "\t"));
  console.log("write store to: ", $path);
}
async function readFromFile(filename) {
  let $path = join(__dirname, filename ? filename : "baileys-store.json");
  if (existsSync($path)) {
    console.log("read store from: ", $path);
    const jsonStr = await promises.readFile($path, { encoding: "utf-8" });
    const json = JSON.parse(jsonStr);
    fromJSON(json);
  }
}

/**
 * downloadMediaMessage
 * @param {proto.IMessage} message
 * @param {string} pathFile
 * @returns
 */
const downloadMedia = (message, pathFile) =>
  new Bluebird(async (resolve, reject) => {
    const type = Object.keys(message)[0];
    let mimeMap = {
      imageMessage: "image",
      videoMessage: "video",
      stickerMessage: "sticker",
      documentMessage: "document",
      audioMessage: "audio",
    };
    try {
      if (pathFile) {
        const stream = await downloadContentFromMessage(
          message[type],
          mimeMap[type]
        );
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        await fs.promises.writeFile(pathFile, buffer);
        resolve(pathFile);
      } else {
        const stream = await downloadContentFromMessage(
          message[type],
          mimeMap[type]
        );
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        resolve(buffer);
      }
    } catch (e) {
      reject(e);
    }
  });

const decodeJid = (jid) => {
  if (/:\d+@/gi.test(jid)) {
    const decode = jidDecode(jid) || {};
    return (
      (decode.user && decode.server && decode.user + "@" + decode.server) ||
      jid
    ).trim();
  } else return jid.trim();
};

/**
 * parse message for easy use
 * @param {proto.IWebMessageInfo} msg
 * @param sock
 */
function serialize(msg, sock) {
  if (msg.key) {
    msg.id = msg.key.id;
    msg.isSelf = msg.key.fromMe;
    msg.from = decodeJid(msg.key.remoteJid);
    msg.isGroup = msg.from.endsWith("@g.us");
    msg.sender = msg.isGroup
      ? decodeJid(msg.key.participant)
      : msg.isSelf
      ? decodeJid(sock.user.id)
      : msg.from;
  }
  if (msg.message) {
    msg.type = getContentType(msg.message);
    if (msg.type === "ephemeralMessage") {
      msg.message = msg.message[msg.type].message;
      const tipe = Object.keys(msg.message)[0];
      msg.type = tipe;
      if (tipe === "viewOnceMessage") {
        msg.message = msg.message[msg.type].message;
        msg.type = getContentType(msg.message);
      }
    }
    if (msg.type === "viewOnceMessage") {
      msg.message = msg.message[msg.type].message;
      msg.type = getContentType(msg.message);
    }

    msg.mentions = msg.message[msg.type]?.contextInfo
      ? msg.message[msg.type]?.contextInfo.mentionedJid
      : null;
    try {
      const quoted = msg.message[msg.type]?.contextInfo;
      if (quoted.quotedMessage["ephemeralMessage"]) {
        const tipe = Object.keys(
          quoted.quotedMessage.ephemeralMessage.message
        )[0];
        if (tipe === "viewOnceMessage") {
          msg.quoted = {
            type: "view_once",
            stanzaId: quoted.stanzaId,
            participant: decodeJid(quoted.participant),
            message:
              quoted.quotedMessage.ephemeralMessage.message.viewOnceMessage
                .message,
          };
        } else {
          msg.quoted = {
            type: "ephemeral",
            stanzaId: quoted.stanzaId,
            participant: decodeJid(quoted.participant),
            message: quoted.quotedMessage.ephemeralMessage.message,
          };
        }
      } else if (quoted.quotedMessage["viewOnceMessage"]) {
        msg.quoted = {
          type: "view_once",
          stanzaId: quoted.stanzaId,
          participant: decodeJid(quoted.participant),
          message: quoted.quotedMessage.viewOnceMessage.message,
        };
      } else {
        msg.quoted = {
          type: "normal",
          stanzaId: quoted.stanzaId,
          participant: decodeJid(quoted.participant),
          message: quoted.quotedMessage,
        };
      }
      msg.quoted.isSelf = msg.quoted.participant === decodeJid(sock.user.id);
      msg.quoted.mtype = Object.keys(msg.quoted.message).filter(
        (v) => v.includes("Message") || v.includes("conversation")
      )[0];
      msg.quoted.text =
        msg.quoted.message[msg.quoted.mtype]?.text ||
        msg.quoted.message[msg.quoted.mtype]?.description ||
        msg.quoted.message[msg.quoted.mtype]?.caption ||
        msg.quoted.message[msg.quoted.mtype]?.hydratedTemplate
          ?.hydratedContentText ||
        msg.quoted.message[msg.quoted.mtype] ||
        "";
      msg.quoted.key = {
        id: msg.quoted.stanzaId,
        fromMe: msg.quoted.isSelf,
        remoteJid: msg.from,
      };
      msg.quoted.delete = () =>
        sock.sendMessage(msg.from, { delete: msg.quoted.key });
      msg.quoted.download = (pathFile) =>
        downloadMedia(msg.quoted.message, pathFile);
    } catch {
      msg.quoted = null;
    }
    msg.body =
      msg.message?.conversation ||
      msg.message?.[msg.type]?.text ||
      msg.message?.[msg.type]?.caption ||
      (msg.type === "listResponseMessage" &&
        msg.message?.[msg.type]?.singleSelectReply?.selectedRowId) ||
      (msg.type === "buttonsResponseMessage" &&
        msg.message?.[msg.type]?.selectedButtonId?.includes("SMH") &&
        msg.message?.[msg.type]?.selectedButtonId) ||
      (msg.type === "templateButtonReplyMessage" &&
        msg.message?.[msg.type]?.selectedId) ||
      "";
    msg.reply = (text) => sock.sendMessage(msg.from, { text }, { quoted: msg });
    msg.download = (pathFile) => downloadMedia(msg.message, pathFile);
    msg.get = function (message, callback) {
      if (!this.commands) this.commands = {};
      this.commands[message] = callback;
    };
  }
  return msg;
}

module.exports = {
  store: { chats, bind, writeToFile, readFromFile },
  serialize,
};

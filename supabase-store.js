const path = require("node:path");
const {
  appendFile: appendLocalFile,
  mkdir: mkdirLocal,
  readFile: readLocalFile,
  unlink: unlinkLocal,
  writeFile: writeLocalFile
} = require("node:fs/promises");

const STATE_FILES = new Set([
  "saved-messages.json",
  "pinned-messages.json",
  "message-reactions.json",
  "uploads.json",
  "tic-tac-toe.json",
  "party-games.json"
]);

function createSupabaseStore({ url, serviceKey, dataDirectory }) {
  const enabled = Boolean(url && serviceKey);
  const uploadDirectory = path.join(dataDirectory, "uploads");
  const messagesFile = path.join(dataDirectory, "messages.jsonl");
  const usernamesFile = path.join(dataDirectory, "usernames.json");
  const groupsFile = path.join(dataDirectory, "groups.json");

  async function request(resource, { method = "GET", body, prefer, headers = {} } = {}) {
    const response = await fetch(`${url}/rest/v1/${resource}`, {
      method,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(prefer ? { Prefer: prefer } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }

  async function requestAll(resource) {
    const pageSize = 500;
    const records = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await request(resource, { headers: { "Range-Unit": "items", Range: `${offset}-${offset + pageSize - 1}` } });
      records.push(...page);
      if (page.length < pageSize) return records;
    }
  }

  function isDataPath(file) {
    const resolved = path.resolve(file);
    return resolved === dataDirectory || resolved.startsWith(`${dataDirectory}${path.sep}`);
  }

  async function readState(key) {
    const rows = await request(`chatly_app_state?key=eq.${encodeURIComponent(key)}&select=value`);
    if (!rows.length) {
      const error = new Error(`No saved state for ${key}`);
      error.code = "ENOENT";
      throw error;
    }
    return JSON.stringify(rows[0].value);
  }

  async function writeState(key, contents) {
    const value = JSON.parse(String(contents));
    await request("chatly_app_state?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { key, value, updated_at: new Date().toISOString() }
    });
  }

  async function ensureConversations(conversations) {
    const records = conversations.filter((conversation) => !conversation.startsWith("group:")).map((conversation) => {
      const kind = conversation.startsWith("dm:") ? "direct" : "room";
      const members = kind === "direct" ? conversation.split(":").slice(1) : [];
      return { id: conversation, kind, member_ids: members, record: { id: conversation } };
    });
    if (!records.length) return;
    await request("chatly_conversations?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: records
    });
  }

  async function ensureConversation(conversation) {
    await ensureConversations([conversation]);
  }

  async function upsertMessages(records) {
    const conversations = [...new Set(records.map((message) => message.conversation).filter(Boolean))];
    await ensureConversations(conversations);
    for (let offset = 0; offset < records.length; offset += 100) {
      const rows = records.slice(offset, offset + 100).map((message) => ({
        id: message.id,
        conversation_id: message.conversation,
        sender_id: message.senderId || null,
        created_at: message.time,
        record: message
      }));
      await request("chatly_messages?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: rows
      });
    }
  }

  async function upsertProfileRecords(entries) {
    if (entries.length) {
      await request("chatly_profiles?on_conflict=user_id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: entries.map((entry) => ({
          user_id: entry.id,
          username: entry.name,
          username_normalized: entry.name.toLocaleLowerCase(),
          record: entry
        }))
      });
    }
  }

  async function readProfiles() {
    const rows = await requestAll("chatly_profiles?select=record");
    return JSON.stringify(rows.map((row) => row.record));
  }

  async function writeConversationRecords(groups) {
    const entries = Object.values(groups);
    if (entries.length) {
      await request("chatly_conversations?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: entries.map((group) => ({
          id: `group:${group.id}`,
          kind: "group",
          member_ids: group.memberIds || [],
          record: group
        }))
      });
    }
  }

  async function readConversations() {
    const rows = await requestAll("chatly_conversations?kind=eq.group&select=record");
    return JSON.stringify(Object.fromEntries(rows.map((row) => [row.record.id, row.record])));
  }

  async function readUpload(file) {
    const id = path.basename(file);
    const response = await fetch(`${url}/storage/v1/object/chatly-uploads/${encodeURIComponent(id)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!response.ok) throw new Error(`Supabase Storage read failed (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  async function writeUpload(file, contents, contentType) {
    const id = path.basename(file);
    const response = await fetch(`${url}/storage/v1/object/chatly-uploads/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType || "application/octet-stream",
        "x-upsert": "true"
      },
      body: contents
    });
    if (!response.ok) throw new Error(`Supabase Storage write failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  async function removeUpload(file) {
    const id = path.basename(file);
    const response = await fetch(`${url}/storage/v1/object/chatly-uploads/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!response.ok && response.status !== 404) throw new Error(`Supabase Storage delete failed (${response.status}).`);
  }

  return {
    enabled,
    async readFile(file, encoding) {
      if (!enabled || !isDataPath(file)) return readLocalFile(file, encoding);
      if (path.resolve(file) === path.resolve(messagesFile)) {
        const rows = await requestAll("chatly_messages?select=record&order=created_at.asc,id.asc");
        return rows.map((row) => JSON.stringify(row.record)).join("\n") + (rows.length ? "\n" : "");
      }
      if (path.resolve(file) === path.resolve(usernamesFile)) return readProfiles();
      if (path.resolve(file) === path.resolve(groupsFile)) return readConversations();
      if (path.resolve(file).startsWith(`${uploadDirectory}${path.sep}`)) return readUpload(file);
      if (!STATE_FILES.has(path.basename(file))) return readLocalFile(file, encoding);
      return readState(path.basename(file));
    },
    async writeFile(file, contents, encoding) {
      if (!enabled || !isDataPath(file)) return writeLocalFile(file, contents, encoding);
      if (path.resolve(file) === path.resolve(messagesFile)) {
        const records = String(contents).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        return upsertMessages(records);
      }
      if (path.resolve(file) === path.resolve(usernamesFile)) return upsertProfileRecords(JSON.parse(String(contents)));
      if (path.resolve(file) === path.resolve(groupsFile)) return writeConversationRecords(JSON.parse(String(contents)));
      if (path.resolve(file).startsWith(`${uploadDirectory}${path.sep}`)) return writeUpload(file, contents, encoding);
      if (STATE_FILES.has(path.basename(file))) return writeState(path.basename(file), contents);
      return writeLocalFile(file, contents, encoding);
    },
    async appendFile(file, contents, encoding) {
      if (!enabled || path.resolve(file) !== path.resolve(messagesFile)) return appendLocalFile(file, contents, encoding);
      const message = JSON.parse(String(contents).trim());
      await upsertMessages([message]);
    },
    async mkdir(directory, options) {
      if (enabled && isDataPath(directory)) return;
      return mkdirLocal(directory, options);
    },
    async unlink(file) {
      if (enabled && path.resolve(file).startsWith(`${uploadDirectory}${path.sep}`)) return removeUpload(file);
      return unlinkLocal(file);
    },
    async ensureConversation(conversation) {
      if (!enabled) return;
      await ensureConversation(conversation);
    },
    async deleteMessage(messageId) {
      if (!enabled) return;
      await request(`chatly_messages?id=eq.${encodeURIComponent(messageId)}`, { method: "DELETE" });
    }
  };
}

module.exports = { createSupabaseStore };

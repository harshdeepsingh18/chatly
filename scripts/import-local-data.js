const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");
const { createSupabaseStore } = require("../supabase-store");

const projectDirectory = path.resolve(__dirname, "..");
const dataDirectory = path.join(projectDirectory, "data");

function loadEnvFile(file) {
  let contents;
  try { contents = readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
}

async function readOptional(file, encoding = "utf8") {
  try { return await readFile(file, encoding); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function importLocalData() {
  loadEnvFile(path.join(projectDirectory, ".env"));
  const store = createSupabaseStore({
    url: process.env.SUPABASE_URL || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    dataDirectory
  });
  if (!store.enabled) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment before importing.");
  }

  const usernameFile = path.join(dataDirectory, "usernames.json");
  const groupsFile = path.join(dataDirectory, "groups.json");
  const messagesFile = path.join(dataDirectory, "messages.jsonl");
  const usernames = await readOptional(usernameFile);
  const groups = await readOptional(groupsFile);
  const messages = await readOptional(messagesFile);
  if (groups !== null) await store.writeFile(groupsFile, groups, "utf8");
  if (usernames !== null) await store.writeFile(usernameFile, usernames, "utf8");

  let messageCount = 0;
  if (messages !== null) {
    const records = messages.split(/\r?\n/).filter(Boolean).map((line, index) => {
      let message;
      try { message = JSON.parse(line); }
      catch (error) { throw new Error(`Invalid message on line ${index + 1}: ${error.message}`); }
      const id = message.id || crypto.createHash("sha256")
        .update(`${message.user}\n${message.time}\n${message.text}`).digest("hex").slice(0, 32);
      return { ...message, id, conversation: message.conversation || message.room || "general" };
    });
    await store.writeFile(messagesFile, records.map((message) => JSON.stringify(message)).join("\n") + (records.length ? "\n" : ""), "utf8");
    messageCount = records.length;
  }

  for (const fileName of [
    "saved-messages.json",
    "pinned-messages.json",
    "message-reactions.json",
    "tic-tac-toe.json",
    "party-games.json"
  ]) {
    const file = path.join(dataDirectory, fileName);
    const contents = await readOptional(file);
    if (contents !== null) await store.writeFile(file, contents, "utf8");
  }

  const uploadsFile = path.join(dataDirectory, "uploads.json");
  const uploadsContents = await readOptional(uploadsFile);
  let uploadCount = 0;
  if (uploadsContents !== null) {
    const uploads = JSON.parse(uploadsContents);
    for (const upload of Object.values(uploads)) {
      if (!/^[\w-]+$/.test(upload.id || "")) throw new Error("An upload has an invalid ID; no upload data was imported.");
      const file = path.join(dataDirectory, "uploads", upload.id);
      const contents = await readFile(file);
      await store.writeFile(file, contents, upload.type || "application/octet-stream");
      uploadCount++;
    }
    await store.writeFile(uploadsFile, uploadsContents, "utf8");
  }

  console.log(`Imported ${messageCount} messages and ${uploadCount} uploads. Existing local files were left unchanged.`);
}

importLocalData().catch((error) => {
  console.error("Local data import failed:", error);
  process.exitCode = 1;
});

module.exports = (_req, res) => {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";
  const apiUrl = (process.env.CHATLY_API_URL || "").replace(/\/$/, "");
  const realtimeUrl = (process.env.CHATLY_REALTIME_URL || "").replace(/\/$/, "");
  const auraEnabled = Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 200;
  res.end(`window.CHATLY_SUPABASE_URL = ${JSON.stringify(supabaseUrl)}; window.CHATLY_SUPABASE_ANON_KEY = ${JSON.stringify(supabaseAnonKey)}; window.CHATLY_ROOMS = ${JSON.stringify(["general", "doubts", "notes"])}; window.CHATLY_AURA_ENABLED = ${auraEnabled}; window.CHATLY_API_URL = ${JSON.stringify(apiUrl)}; window.CHATLY_REALTIME_URL = ${JSON.stringify(realtimeUrl)};`);
};

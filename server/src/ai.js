// AI 提供方：Claude（Anthropic）与 DeepSeek（OpenAI 兼容接口）
// 配置存于 settings 表，API Key 用 AES-256-GCM 加密；也兼容 .env 中的 ANTHROPIC_API_KEY / DEEPSEEK_API_KEY
import crypto from "node:crypto";
import { q } from "./db.js";

export const PROVIDERS = {
  claude: {
    label: "Claude", baseUrl: "https://api.anthropic.com", envKey: "ANTHROPIC_API_KEY", envModel: "ANTHROPIC_MODEL",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"],
  },
  deepseek: {
    label: "DeepSeek", baseUrl: "https://api.deepseek.com", envKey: "DEEPSEEK_API_KEY", envModel: "DEEPSEEK_MODEL",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
};

// 加密密钥：优先 APP_SECRET，否则由数据库连接串派生（同一部署内稳定）
const KEY = crypto.createHash("sha256").update(process.env.APP_SECRET || process.env.DATABASE_URL || "gastronomique").digest();
const encrypt = text => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString("base64")).join(".");
};
const decrypt = blob => {
  try {
    const [iv, tag, data] = blob.split(".").map(s => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch { return ""; }
};

async function load() {
  const r = (await q("SELECT value FROM settings WHERE key='ai'")).rows[0];
  return r?.value || { default: "", providers: {} };
}

// 实际可用的配置（数据库优先，其次环境变量）
async function resolved() {
  const s = await load(), out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const c = s.providers?.[id] || {};
    const key = (c.key && decrypt(c.key)) || process.env[p.envKey] || "";
    out[id] = { key, model: c.model || process.env[p.envModel] || p.models[0], baseUrl: (c.baseUrl || p.baseUrl).replace(/\/+$/, ""), fromEnv: !c.key && !!process.env[p.envKey] };
  }
  const available = Object.keys(out).filter(id => out[id].key);
  const def = available.includes(s.default) ? s.default : available[0] || "";
  return { providers: out, default: def, available };
}

// 返回给前端：只给出密钥末四位
export async function publicConfig() {
  const r = await resolved();
  const providers = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const c = r.providers[id];
    providers[id] = { label: p.label, models: p.models, defaultBaseUrl: p.baseUrl, model: c.model, baseUrl: c.baseUrl,
      hasKey: !!c.key, keyHint: c.key ? "…" + c.key.slice(-4) : "", fromEnv: c.fromEnv };
  }
  return { default: r.default, available: r.available, providers };
}

export async function saveConfig(body = {}) {
  const s = await load();
  s.providers ||= {};
  for (const id of Object.keys(PROVIDERS)) {
    const inp = body.providers?.[id]; if (!inp) continue;
    const cur = s.providers[id] || {};
    if (inp.clearKey) delete cur.key;
    else if (typeof inp.key === "string" && inp.key.trim()) cur.key = encrypt(inp.key.trim().slice(0, 500));
    if (typeof inp.model === "string") cur.model = inp.model.trim().slice(0, 100);
    if (typeof inp.baseUrl === "string") {
      const u = inp.baseUrl.trim();
      if (u && !/^https?:\/\/[^\s]+$/.test(u)) throw Object.assign(new Error("接口地址格式不正确"), { statusCode: 400 });
      cur.baseUrl = u;
    }
    s.providers[id] = cur;
  }
  if (body.default !== undefined) s.default = PROVIDERS[body.default] ? body.default : "";
  await q("INSERT INTO settings(key,value,updated_at) VALUES ('ai',$1,now()) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()", [s]);
  return publicConfig();
}

export async function hasAI() { return (await resolved()).available.length > 0; }

const err = (msg, code = 502) => Object.assign(new Error(msg), { statusCode: code, expose: true });   // expose：把上游错误原因展示给馆长

export async function complete({ prompt, system, provider, maxTokens = 4000 }) {
  const r = await resolved();
  const id = provider && r.providers[provider]?.key ? provider : r.default;
  if (!id) throw err("尚未配置 AI：请在「AI 探索 → ⚙ 设置」中填写 Claude 或 DeepSeek 的 API Key", 501);
  const c = r.providers[id];
  const ctl = AbortSignal.timeout(120e3);
  let res, j;
  try {
    if (id === "claude") {
      res = await fetch(`${c.baseUrl}/v1/messages`, {
        method: "POST", signal: ctl,
        headers: { "content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system: String(system || ""), messages: [{ role: "user", content: String(prompt || "") }] }),
      });
      j = await res.json().catch(() => ({}));
      if (!res.ok) throw err(`Claude：${j.error?.message || res.status}`);
      return { provider: id, model: c.model, text: (j.content || []).filter(x => x.type === "text").map(x => x.text).join("") };
    }
    res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: "POST", signal: ctl,
      headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ model: c.model, max_tokens: maxTokens, stream: false,
        messages: [...(system ? [{ role: "system", content: String(system) }] : []), { role: "user", content: String(prompt || "") }] }),
    });
    j = await res.json().catch(() => ({}));
    if (!res.ok) throw err(`DeepSeek：${j.error?.message || res.status}`);
    return { provider: id, model: c.model, text: j.choices?.[0]?.message?.content || "" };
  } catch (e) {
    if (e.statusCode) throw e;
    throw err(`${PROVIDERS[id].label} 连接失败：${e.name === "TimeoutError" ? "超时" : e.message}`);
  }
}

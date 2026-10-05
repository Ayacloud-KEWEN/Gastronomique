import crypto from "node:crypto";
import { promisify } from "node:util";
import { q } from "./db.js";

const scrypt = promisify(crypto.scrypt);
export const SESSION_DAYS = 90;
export const token = (n = 32) => crypto.randomBytes(n).toString("base64url");

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [, s, k] = stored.split("$");
  const key = await scrypt(pw, Buffer.from(s, "base64"), 64);
  return crypto.timingSafeEqual(key, Buffer.from(k, "base64"));
}

export async function createSession(userId) {
  const t = token();
  await q("INSERT INTO sessions(token,user_id,expires_at) VALUES ($1,$2, now() + $3::interval)", [t, userId, `${SESSION_DAYS} days`]);
  return t;
}
export async function userFromSession(t) {
  if (!t) return null;
  const r = await q("SELECT u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at > now()", [t]);
  return r.rows[0] || null;
}

// 首次启动时根据环境变量创建管理员
export async function ensureAdmin(log) {
  const { rows } = await q("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
  if (rows.length) return;
  const name = process.env.ADMIN_USER || "admin", pw = process.env.ADMIN_PASSWORD;
  if (!pw) { log.warn("尚无管理员：请设置 ADMIN_PASSWORD 环境变量后重启"); return; }
  await q("INSERT INTO users(name,role,password_hash) VALUES ($1,'admin',$2)", [name, await hashPassword(pw)]);
  log.info(`管理员 ${name} 已创建`);
}

// 简单的登录限速：每个 IP 15 分钟内最多 10 次失败
const fails = new Map();
export function tooManyAttempts(ip) {
  const f = fails.get(ip); if (!f) return false;
  if (Date.now() - f.t > 15 * 60e3) { fails.delete(ip); return false; }
  return f.n >= 10;
}
export function recordFail(ip) { const f = fails.get(ip) || { n: 0, t: Date.now() }; f.n++; fails.set(ip, f); }
export function clearFails(ip) { fails.delete(ip); }

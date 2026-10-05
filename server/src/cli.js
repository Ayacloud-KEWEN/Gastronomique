// 用法：node src/cli.js passwd <用户名> <新密码>   （用户不存在时创建为管理员）
import { q, pool, migrate } from "./db.js";
import { hashPassword } from "./auth.js";

const [cmd, name, pw] = process.argv.slice(2);
if (cmd !== "passwd" || !name || !pw) { console.log("用法: node src/cli.js passwd <用户名> <新密码>"); process.exit(1); }
await migrate({ info: () => {} });
const h = await hashPassword(pw);
const r = await q("UPDATE users SET password_hash=$2 WHERE name=$1", [name, h]);
if (!r.rowCount) await q("INSERT INTO users(name,role,password_hash) VALUES ($1,'admin',$2)", [name, h]);
await q("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE name=$1)", [name]);
console.log(r.rowCount ? `已重置 ${name} 的密码` : `已创建管理员 ${name}`);
await pool.end();

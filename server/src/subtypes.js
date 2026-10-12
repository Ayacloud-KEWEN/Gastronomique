// 食材小类：固定选项 + 规则归类（名称、外文名、标签） + AI 补充
import { q } from "./db.js";
import * as ai from "./ai.js";

export const SUBTYPES = {
  fish: "鱼类", shellfish: "贝类与软体", crustacean: "虾蟹", seaother: "其他海产", roe: "鱼子酱与鱼卵",
  preserved: "水产罐头与加工", meat: "肉类", cured: "火腿与腌制肉", dairy: "奶酪与乳制品", fungi: "蘑菇与菌类",
  produce: "蔬果与香草", grain: "谷物、面与豆", condiment: "调味品与酱料", sweet: "甜点与零食", other: "其他",
};
export const SUBTYPE_KEYS = Object.keys(SUBTYPES);
export const SUBTYPE_SRC = ["", "auto", "ai", "manual"];   // 未分类 / 规则自动 / AI / 人工确认

// 规则按顺序匹配，先到先得：鱼子酱先于罐头，罐头与调味品先于鱼类，鱼类先于肉类（避免「鱼肉」）
const RULES = [
  ["roe",        /鱼子|鱼卵|caviar|kaviar|\broe\b|ikura|鲑鱼子|鳟鱼子|鳕鱼子|oscietre|ossetra|beluga|sévruga|sevruga|baeri|kaluga|naccari|persicus|sterlet|white sturgeon/i],
  ["preserved",  /罐头|烟熏|熏鱼|腌鲱|鱼肝|sill\b|matjes|klippfisk|tørrfisk|boknafisk|bacalhau|干鳕|conserve|sardines|sardinhas|sardinas|fumé|smoked/i],
  ["cured",      /火腿|jamón|jamon|prosciutto|salami|萨拉米|腊肉|腊肠|咸肉|培根|lardo|guanciale/i],
  ["dairy",      /奶酪|干酪|芝士|乳酪|奶油|黄油|cheese|fromage|formaggio|mozzarella|ricotta|burrata|comté|yogurt|酸奶/i],
  ["fungi",      /蘑菇|菌|菇|松露|truffe|truffle|girolle|morille|cèpe|maitake|shiitak|pleurote|enoki|coulemelle|lactaire|champignon/i],
  ["condiment",  /鱼酱|酱油|豆瓣|醋|香料|花椒|胡椒|辣椒酱|colatura|garum|nuoc|酱$|盐$/i],
  ["seaother",   /海胆|海参|海藻|海带|紫菜|海苔|oursin|uni\b|algue|concombre de mer/i],
  ["crustacean", /虾|蟹|homard|langoust|crevette|gamba|crabe|tourteau|araignée|reker|krabbe|kongekrabbe|lobster|shrimp/i],
  ["shellfish",  /贝|蚝|牡蛎|蛤|蚌|螺|蛏|鱿|章鱼|墨鱼|乌贼|huître|moule|palourde|coque|couteau|bulot|praire|calmar|poulpe|seiche|encornet|blåskjell|kamskjell|oyster|scallop|mussel|squid|octopus/i],
  ["fish",       /鱼|鳕|鲑|鳟|鲈|鲷|鲽|鲆|鳎|鳗|鲭|鲱|鲨|鲟|鳇|沙丁|金枪|三文|鳐|鲻|鲇|鲶|鳜|鲫|鲤|鳙|鲢|halibut|kveite|\bsei\b|hyse|skrei|cabillaud|saumon|truite|bar\b|sole|lotte|merlu|merlan|maquereau|hareng|thon|raie|rouget|anchois|dorade|daurade|sandre|fish/i],
  ["meat",       /牛|猪|羊|鸡|鸭|鹅|鹿|兔|肉|bœuf|boeuf|beef|pork|lamb|agneau|veau|wagyu|canard|duck|chicken/i],
  ["sweet",      /糖|巧克力|蜂蜜|蜜|chocolat|miel|honey/i],
  ["grain",      /米|面|麦|豆|谷|粉|riz|rice|pasta|farine|blé|lentil/i],
  ["produce",    /菜|果|莓|瓜|柑|橘|柠檬|姜|蒜|葱|笋|萝卜|番茄|土豆|香草|叶|fruit|légume|herb|tomate/i],
];
// 标签直接对应小类（比规则更可靠）
const TAG_MAP = { "鱼子酱": "roe", "鱼罐头": "preserved", "烟熏鱼": "preserved", "奶酪": "dairy", "蘑菇": "fungi", "牛肉": "meat",
  "淡水鱼": "fish", "海鱼": "fish", "鱼": "fish", "贝类": "shellfish", "头足类": "shellfish", "甲壳类": "crustacean", "虾": "crustacean", "海产": "seaother" };

export function guessSubtype(it) {
  // 名字就是酱料的（鱼酱、Colatura di Alici）先认定为调味品，不让「鱼」这类标签抢走
  if (/鱼酱|酱油|豆瓣|colatura|garum|nuoc ?mam/i.test(`${it.name} ${it.alt || ""}`)) return "condiment";
  for (const t of it.tags || []) if (TAG_MAP[t]) return TAG_MAP[t];
  const text = [it.name, it.alt, ...(it.tags || [])].join(" ");
  for (const [k, re] of RULES) if (re.test(text)) return k;
  return "";
}

// 对还没人工确认的食材重新归类：先规则，规则分不出的交给 AI
export async function autoClassify({ useAI = true, provider } = {}) {
  const rows = (await q("SELECT id, name, alt, tags, summary FROM items WHERE type='ingredient' AND subtype_src <> 'manual'")).rows;
  let rule = 0, viaAI = 0; const left = [];
  for (const it of rows) {
    const s = guessSubtype(it);
    if (s) { await q("UPDATE items SET subtype=$2, subtype_src='auto' WHERE id=$1", [it.id, s]); rule++; }
    else left.push(it);
  }
  let warning = "";
  if (useAI && left.length && await ai.hasAI()) {
    const list = SUBTYPE_KEYS.map(k => `${k}=${SUBTYPES[k]}`).join("，");
    for (let i = 0; i < left.length; i += 60) {
      const batch = left.slice(i, i + 60);
      try {
        const r = await ai.complete({ provider, maxTokens: 8000, timeoutMs: 180e3,
          system: "你是食物博物馆的编目员。把每件食材归入一个小类，只输出 JSON。",
          prompt: `小类：${list}\n\n食材（id | 名称 | 外文名 | 简介）：\n${batch.map(x => `${x.id} | ${x.name} | ${x.alt || ""} | ${String(x.summary || "").slice(0, 60)}`).join("\n")}\n\n输出：{"items":[{"id":"…","subtype":"小类英文键"}]}` });
        const s = String(r.text); const j = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
        for (const x of j.items || []) if (SUBTYPE_KEYS.includes(x.subtype) && batch.some(b => b.id === x.id)) {
          await q("UPDATE items SET subtype=$2, subtype_src='ai' WHERE id=$1 AND subtype_src <> 'manual'", [x.id, x.subtype]); viaAI++;
        }
      } catch (e) { warning = `AI 归类失败：${e.message}`; break; }
    }
  }
  return { total: rows.length, rule, ai: viaAI, left: rows.length - rule - viaAI, warning };
}

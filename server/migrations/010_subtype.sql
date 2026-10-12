-- 食材小类：subtype 为小类键（如 fish、roe），subtype_src 记录来源：'' 未分类 / auto 规则 / ai / manual 人工确认
ALTER TABLE items ADD COLUMN subtype text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN subtype_src text NOT NULL DEFAULT '';

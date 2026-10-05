-- 坐标：{ lat, lng, label }，主要用于餐馆、产区、生产者
ALTER TABLE items ADD COLUMN geo jsonb;
CREATE INDEX items_geo_idx ON items ((geo IS NOT NULL));

-- 品尝日志：价格、币种、份量、在哪买
ALTER TABLE journal ADD COLUMN price    numeric(12,2);
ALTER TABLE journal ADD COLUMN currency text NOT NULL DEFAULT '';
ALTER TABLE journal ADD COLUMN amount   text NOT NULL DEFAULT '';
ALTER TABLE journal ADD COLUMN shop     text NOT NULL DEFAULT '';

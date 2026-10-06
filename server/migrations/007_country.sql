-- 国家（ISO 3166-1 alpha-2，如 NO、FR、CN；XX 表示多国/全球），用于馆藏目录的地区索引
ALTER TABLE items ADD COLUMN country text NOT NULL DEFAULT '';
CREATE INDEX items_country_idx ON items(country);

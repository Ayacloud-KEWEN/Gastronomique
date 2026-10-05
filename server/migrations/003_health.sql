-- 健康印象：主要配料、热量/营养的大致水平、饮食标签（刻意不做精确营养成分表）
ALTER TABLE items ADD COLUMN health jsonb NOT NULL DEFAULT '{}';

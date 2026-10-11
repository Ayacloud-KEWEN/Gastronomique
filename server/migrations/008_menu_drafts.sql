-- 菜单扫描的草稿箱：识别出的新菜先放这里，馆长整理后再转为藏品
CREATE TABLE drafts (
  id              bigserial PRIMARY KEY,
  name            text NOT NULL,                 -- 中文名
  orig            text NOT NULL DEFAULT '',      -- 菜单原文
  note            text NOT NULL DEFAULT '',      -- AI 解释：是什么、怎么做
  price           text NOT NULL DEFAULT '',
  section         text NOT NULL DEFAULT '',      -- 菜单分区：前菜 / 主菜 / 甜点 / 酒……
  type            text NOT NULL DEFAULT 'dish',
  tags            text[] NOT NULL DEFAULT '{}',
  ingredients     text[] NOT NULL DEFAULT '{}',
  related         text[] NOT NULL DEFAULT '{}', -- AI 认为相关的已有藏品 id
  restaurant_id   text REFERENCES items(id) ON DELETE SET NULL,
  restaurant_name text NOT NULL DEFAULT '',
  scanned_on      date NOT NULL DEFAULT current_date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drafts_created_idx ON drafts(created_at DESC);

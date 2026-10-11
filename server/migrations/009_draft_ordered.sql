-- 草稿：是否在店里点了这道菜（转为藏品时决定标记「已品尝」还是「想尝」）
ALTER TABLE drafts ADD COLUMN ordered boolean NOT NULL DEFAULT false;

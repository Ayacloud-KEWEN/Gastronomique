-- 缩略图与尺寸
ALTER TABLE media ADD COLUMN thumb  text;     -- 缩略图相对路径（视频为封面帧）
ALTER TABLE media ADD COLUMN width  int;
ALTER TABLE media ADD COLUMN height int;
ALTER TABLE media ADD COLUMN thumb_failed boolean NOT NULL DEFAULT false;

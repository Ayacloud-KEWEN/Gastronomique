-- Gastronomique 初始结构
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id            serial PRIMARY KEY,
  name          text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('admin','viewer')),
  password_hash text,                       -- viewer 通过邀请链接登录，可为空
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token      text PRIMARY KEY,
  user_id    int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE invites (
  token      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_by    int REFERENCES users(id) ON DELETE SET NULL
);

-- 藏品：九种类型统一一张表，风味用 JSONB
CREATE TABLE items (
  id         text PRIMARY KEY,
  type       text NOT NULL CHECK (type IN ('ingredient','dish','beverage','restaurant','producer','region','culture','event','story')),
  name       text NOT NULL,
  alt        text NOT NULL DEFAULT '',
  region     text NOT NULL DEFAULT '',
  tags       text[] NOT NULL DEFAULT '{}',
  status     text NOT NULL DEFAULT '' CHECK (status IN ('','tried','want')),
  rating     smallint NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  flavor     jsonb NOT NULL DEFAULT '{}',
  summary    text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  story      text NOT NULL DEFAULT '',
  source     text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_type_idx ON items(type);
CREATE INDEX items_tags_idx ON items USING gin(tags);
-- 中文友好的模糊搜索（三元组索引）
CREATE INDEX items_search_idx ON items USING gin ((name || ' ' || alt || ' ' || region || ' ' || summary || ' ' || body || ' ' || story) gin_trgm_ops);

-- 知识网络的边
CREATE TABLE relations (
  from_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id   text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label   text NOT NULL DEFAULT '相关',
  pos     int  NOT NULL DEFAULT 0,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX relations_to_idx ON relations(to_id);

-- 品尝日志
CREATE TABLE journal (
  id         serial PRIMARY KEY,
  item_id    text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  date       date NOT NULL,
  place      text NOT NULL DEFAULT '',
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_item_idx ON journal(item_id);

-- 媒体：文件在磁盘上，数据库只存元数据；item_id 为空表示刚上传、尚未保存到藏品
CREATE TABLE media (
  id         text PRIMARY KEY,
  item_id    text REFERENCES items(id) ON DELETE SET NULL,
  pos        int  NOT NULL DEFAULT 0,
  kind       text NOT NULL CHECK (kind IN ('image','video')),
  name       text NOT NULL DEFAULT '',
  caption    text NOT NULL DEFAULT '',
  file       text,          -- 磁盘相对路径（本地文件）
  url        text,          -- 外链
  mime       text,
  size       bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (file IS NOT NULL OR url IS NOT NULL)
);
CREATE INDEX media_item_idx ON media(item_id, pos);

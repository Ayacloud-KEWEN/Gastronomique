-- 应用设置（键值），AI 密钥以 AES-GCM 加密后存放
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

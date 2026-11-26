-- Esquema inicial de la app de ejemplo de PL3.
-- Cada proyecto publicado tiene su propia base: no hay `project_id` aquí.

CREATE TABLE app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE app_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE app_files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

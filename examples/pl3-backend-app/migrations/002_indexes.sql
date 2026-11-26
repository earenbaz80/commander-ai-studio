-- Las consultas de la app siempre filtran por `user_id`: sin estos índices la
-- lista de notas y archivos de una cuenta escanea la tabla entera.

CREATE INDEX ix_app_sessions_user ON app_sessions(user_id);
CREATE INDEX ix_app_notes_user ON app_notes(user_id, created_at DESC);
CREATE INDEX ix_app_files_user ON app_files(user_id, created_at DESC);

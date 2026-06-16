import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.TURSO_URL;
const authToken = process.env.TURSO_TOKEN;

if (!url) {
  throw new Error("TURSO_URL 환경변수가 설정되지 않았습니다.");
}
if (!/^(libsql|wss?|https?|file):/.test(url)) {
  throw new Error(
    `TURSO_URL 형식이 올바르지 않습니다 (libsql://... 형태여야 함). ` +
      `현재 값: '${url.slice(0, 20)}...' — TURSO_URL과 TURSO_TOKEN이 뒤바뀌지 않았는지 확인하세요.`
  );
}

export const db = createClient({ url, authToken });

export async function initSchema() {
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS notebooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notebook_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        content_text TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_trashed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS note_tags (
        note_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (note_id, tag_id),
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)`,
    ],
    "write"
  );

  // 기본 노트북 생성 (없을 경우)
  const { rows } = await db.execute("SELECT COUNT(*) AS c FROM notebooks");
  if (Number(rows[0].c) === 0) {
    await db.execute({
      sql: "INSERT INTO notebooks (name) VALUES (?)",
      args: ["내 노트"],
    });
  }
}

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { db, initSchema } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// 텍스트만 추출 (검색/미리보기용)
function stripHtml(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

/* ----------------------------- 노트북 ----------------------------- */
app.get(
  "/api/notebooks",
  wrap(async (req, res) => {
    const { rows } = await db.execute(`
      SELECT nb.id, nb.name, nb.created_at,
        (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.is_trashed = 0) AS note_count
      FROM notebooks nb
      ORDER BY nb.name COLLATE NOCASE
    `);
    res.json(rows);
  })
);

app.post(
  "/api/notebooks",
  wrap(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "이름이 필요합니다." });
    const r = await db.execute({
      sql: "INSERT INTO notebooks (name) VALUES (?)",
      args: [name],
    });
    res.json({ id: Number(r.lastInsertRowid), name });
  })
);

app.put(
  "/api/notebooks/:id",
  wrap(async (req, res) => {
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "이름이 필요합니다." });
    await db.execute({
      sql: "UPDATE notebooks SET name = ? WHERE id = ?",
      args: [name, req.params.id],
    });
    res.json({ ok: true });
  })
);

app.delete(
  "/api/notebooks/:id",
  wrap(async (req, res) => {
    // 노트북 삭제 시 소속 노트는 휴지통으로
    await db.execute({
      sql: "UPDATE notes SET is_trashed = 1, notebook_id = NULL WHERE notebook_id = ?",
      args: [req.params.id],
    });
    await db.execute({
      sql: "DELETE FROM notebooks WHERE id = ?",
      args: [req.params.id],
    });
    res.json({ ok: true });
  })
);

/* ------------------------------ 태그 ------------------------------ */
app.get(
  "/api/tags",
  wrap(async (req, res) => {
    const { rows } = await db.execute(`
      SELECT t.id, t.name,
        (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
         WHERE nt.tag_id = t.id AND n.is_trashed = 0) AS note_count
      FROM tags t
      ORDER BY t.name COLLATE NOCASE
    `);
    res.json(rows);
  })
);

async function syncTags(noteId, tagNames = []) {
  await db.execute({ sql: "DELETE FROM note_tags WHERE note_id = ?", args: [noteId] });
  for (const raw of tagNames) {
    const name = String(raw).trim();
    if (!name) continue;
    await db.execute({
      sql: "INSERT OR IGNORE INTO tags (name) VALUES (?)",
      args: [name],
    });
    const { rows } = await db.execute({
      sql: "SELECT id FROM tags WHERE name = ?",
      args: [name],
    });
    await db.execute({
      sql: "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)",
      args: [noteId, rows[0].id],
    });
  }
}

async function getNoteTags(noteId) {
  const { rows } = await db.execute({
    sql: `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
          WHERE nt.note_id = ? ORDER BY t.name COLLATE NOCASE`,
    args: [noteId],
  });
  return rows.map((r) => r.name);
}

/* ------------------------------ 노트 ------------------------------ */
// 목록: ?notebook=, ?tag=, ?q=, ?trash=1
app.get(
  "/api/notes",
  wrap(async (req, res) => {
    const { notebook, tag, q, trash } = req.query;
    const where = [];
    const args = [];

    where.push(`n.is_trashed = ${trash === "1" ? 1 : 0}`);

    if (notebook) {
      where.push("n.notebook_id = ?");
      args.push(notebook);
    }
    if (q) {
      where.push("(n.title LIKE ? OR n.content_text LIKE ?)");
      args.push(`%${q}%`, `%${q}%`);
    }
    let join = "";
    if (tag) {
      join = "JOIN note_tags nt ON nt.note_id = n.id JOIN tags t ON t.id = nt.tag_id";
      where.push("t.name = ?");
      args.push(tag);
    }

    const sql = `
      SELECT DISTINCT n.id, n.title, n.notebook_id, n.is_pinned, n.updated_at,
        substr(n.content_text, 1, 200) AS preview,
        nb.name AS notebook_name
      FROM notes n
      ${join}
      LEFT JOIN notebooks nb ON nb.id = n.notebook_id
      WHERE ${where.join(" AND ")}
      ORDER BY n.is_pinned DESC, n.updated_at DESC
    `;
    const { rows } = await db.execute({ sql, args });
    res.json(rows);
  })
);

app.get(
  "/api/notes/:id",
  wrap(async (req, res) => {
    const { rows } = await db.execute({
      sql: "SELECT * FROM notes WHERE id = ?",
      args: [req.params.id],
    });
    if (!rows.length) return res.status(404).json({ error: "노트를 찾을 수 없습니다." });
    const note = rows[0];
    note.tags = await getNoteTags(note.id);
    res.json(note);
  })
);

app.post(
  "/api/notes",
  wrap(async (req, res) => {
    const { title = "", content = "", notebook_id = null, tags = [] } = req.body;
    const r = await db.execute({
      sql: `INSERT INTO notes (notebook_id, title, content, content_text)
            VALUES (?, ?, ?, ?)`,
      args: [notebook_id, title, content, stripHtml(content)],
    });
    const id = Number(r.lastInsertRowid);
    await syncTags(id, tags);
    res.json({ id });
  })
);

app.put(
  "/api/notes/:id",
  wrap(async (req, res) => {
    const id = req.params.id;
    const { title, content, notebook_id, tags } = req.body;
    const fields = [];
    const args = [];
    if (title !== undefined) {
      fields.push("title = ?");
      args.push(title);
    }
    if (content !== undefined) {
      fields.push("content = ?", "content_text = ?");
      args.push(content, stripHtml(content));
    }
    if (notebook_id !== undefined) {
      fields.push("notebook_id = ?");
      args.push(notebook_id);
    }
    if (fields.length) {
      fields.push("updated_at = datetime('now')");
      args.push(id);
      await db.execute({
        sql: `UPDATE notes SET ${fields.join(", ")} WHERE id = ?`,
        args,
      });
    }
    if (tags !== undefined) await syncTags(id, tags);
    res.json({ ok: true });
  })
);

// 핀 고정 토글
app.post(
  "/api/notes/:id/pin",
  wrap(async (req, res) => {
    await db.execute({
      sql: "UPDATE notes SET is_pinned = CASE is_pinned WHEN 1 THEN 0 ELSE 1 END WHERE id = ?",
      args: [req.params.id],
    });
    res.json({ ok: true });
  })
);

// 휴지통으로 이동 / 복원
app.post(
  "/api/notes/:id/trash",
  wrap(async (req, res) => {
    const trashed = req.body.trashed ? 1 : 0;
    await db.execute({
      sql: "UPDATE notes SET is_trashed = ?, updated_at = datetime('now') WHERE id = ?",
      args: [trashed, req.params.id],
    });
    res.json({ ok: true });
  })
);

// 영구 삭제
app.delete(
  "/api/notes/:id",
  wrap(async (req, res) => {
    await db.execute({ sql: "DELETE FROM notes WHERE id = ?", args: [req.params.id] });
    res.json({ ok: true });
  })
);

/* ------------------------------ 기타 ------------------------------ */
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`✅ memojang 실행 중: http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("DB 초기화 실패:", err);
    process.exit(1);
  });

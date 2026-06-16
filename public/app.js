/* ===================== 상태 ===================== */
const state = {
  view: "all", // all | trash | notebook | tag
  notebookId: null,
  tag: null,
  query: "",
  currentNote: null, // 열려있는 노트 객체
  notes: [],
};

let quill;
let saveTimer = null;

/* ===================== API ===================== */
const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async send(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
};

/* ===================== 유틸 ===================== */
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z");
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

const $ = (sel) => document.querySelector(sel);

/* ===================== 사이드바 로드 ===================== */
async function loadNotebooks() {
  const notebooks = await api.get("/api/notebooks");
  const ul = $("#notebookList");
  ul.innerHTML = "";
  for (const nb of notebooks) {
    const li = document.createElement("li");
    li.className = state.view === "notebook" && state.notebookId === nb.id ? "active" : "";
    li.innerHTML = `<span class="name">📔 ${escapeHtml(nb.name)}</span><span class="count">${nb.note_count}</span>`;
    li.onclick = () => selectNotebook(nb.id, nb.name);
    li.ondblclick = () => renameNotebook(nb);
    ul.appendChild(li);
  }
  // 에디터의 노트북 셀렉트도 갱신
  const sel = $("#notebookSelect");
  sel.innerHTML = `<option value="">노트북 없음</option>`;
  for (const nb of notebooks) {
    const opt = document.createElement("option");
    opt.value = nb.id;
    opt.textContent = nb.name;
    sel.appendChild(opt);
  }
  return notebooks;
}

async function loadTags() {
  const tags = await api.get("/api/tags");
  const ul = $("#tagList");
  ul.innerHTML = "";
  for (const t of tags) {
    const li = document.createElement("li");
    li.className = state.view === "tag" && state.tag === t.name ? "active" : "";
    li.innerHTML = `<span class="name"># ${escapeHtml(t.name)}</span><span class="count">${t.note_count}</span>`;
    li.onclick = () => selectTag(t.name);
    ul.appendChild(li);
  }
}

/* ===================== 노트 목록 ===================== */
async function loadNotes() {
  const params = new URLSearchParams();
  if (state.view === "trash") params.set("trash", "1");
  if (state.view === "notebook") params.set("notebook", state.notebookId);
  if (state.view === "tag") params.set("tag", state.tag);
  if (state.query) params.set("q", state.query);

  state.notes = await api.get("/api/notes?" + params.toString());
  renderNoteList();
}

function renderNoteList() {
  const ul = $("#noteList");
  ul.innerHTML = "";
  if (!state.notes.length) {
    ul.innerHTML = `<li class="empty">노트가 없습니다.</li>`;
    return;
  }
  for (const n of state.notes) {
    const li = document.createElement("li");
    if (state.currentNote && state.currentNote.id === n.id) li.className = "active";
    li.innerHTML = `
      <div class="n-title">${n.is_pinned ? "📌" : ""}${escapeHtml(n.title || "제목 없음")}</div>
      <div class="n-preview">${escapeHtml(n.preview || "")}</div>
      <div class="n-foot"><span>${escapeHtml(n.notebook_name || "")}</span><span>${fmtDate(n.updated_at)}</span></div>`;
    li.onclick = () => openNote(n.id);
    ul.appendChild(li);
  }
}

/* ===================== 네비게이션 ===================== */
function setActiveNav(view) {
  document.querySelectorAll(".nav-item").forEach((el) =>
    el.classList.toggle("active", el.dataset.view === view)
  );
}

async function selectView(view) {
  state.view = view;
  state.notebookId = null;
  state.tag = null;
  setActiveNav(view);
  $("#listHeader").textContent = view === "trash" ? "🗑️ 휴지통" : "모든 노트";
  await Promise.all([loadNotebooks(), loadTags(), loadNotes()]);
}

async function selectNotebook(id, name) {
  state.view = "notebook";
  state.notebookId = id;
  state.tag = null;
  setActiveNav(null);
  $("#listHeader").textContent = "📔 " + name;
  await Promise.all([loadNotebooks(), loadTags(), loadNotes()]);
}

async function selectTag(name) {
  state.view = "tag";
  state.tag = name;
  state.notebookId = null;
  setActiveNav(null);
  $("#listHeader").textContent = "# " + name;
  await Promise.all([loadNotebooks(), loadTags(), loadNotes()]);
}

/* ===================== 노트 열기/편집 ===================== */
async function openNote(id) {
  await flushSave(); // 이전 노트 저장
  const note = await api.get("/api/notes/" + id);
  state.currentNote = note;

  $("#emptyState").classList.add("hidden");
  $("#editor").classList.remove("hidden");

  $("#titleInput").value = note.title || "";
  quill.root.innerHTML = note.content || "";
  $("#notebookSelect").value = note.notebook_id || "";
  renderTagChips(note.tags || []);
  $("#noteMeta").textContent = "수정: " + fmtDate(note.updated_at);

  // 휴지통 여부에 따른 버튼
  const trashed = note.is_trashed === 1;
  $("#pinBtn").classList.toggle("active", note.is_pinned === 1);
  $("#pinBtn").classList.toggle("hidden", trashed);
  $("#trashBtn").classList.toggle("hidden", trashed);
  $("#restoreBtn").classList.toggle("hidden", !trashed);
  $("#deleteBtn").classList.toggle("hidden", !trashed);

  renderNoteList();
}

function renderTagChips(tags) {
  const wrap = $("#tagChips");
  wrap.innerHTML = "";
  for (const t of tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(t)} <span>×</span>`;
    chip.querySelector("span").onclick = () => {
      state.currentNote.tags = state.currentNote.tags.filter((x) => x !== t);
      renderTagChips(state.currentNote.tags);
      scheduleSave();
    };
    wrap.appendChild(chip);
  }
}

/* ===================== 저장 (debounce) ===================== */
function scheduleSave() {
  if (!state.currentNote) return;
  $("#noteMeta").textContent = "저장 중...";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const note = state.currentNote;
  if (!note) return;

  const payload = {
    title: $("#titleInput").value,
    content: quill.root.innerHTML,
    notebook_id: $("#notebookSelect").value || null,
    tags: note.tags || [],
  };
  // 변경 없으면 스킵
  note.title = payload.title;
  note.content = payload.content;
  note.notebook_id = payload.notebook_id;

  await api.send("PUT", "/api/notes/" + note.id, payload);
  $("#noteMeta").textContent = "저장됨 · " + fmtDate(new Date().toISOString().replace("T", " "));
  await Promise.all([loadNotebooks(), loadTags()]);
  // 목록의 제목/미리보기 갱신
  const item = state.notes.find((x) => x.id === note.id);
  if (item) {
    item.title = payload.title;
    item.preview = quill.getText().slice(0, 200);
    renderNoteList();
  }
}

/* ===================== 액션 ===================== */
async function newNote() {
  await flushSave();
  const body = {
    title: "",
    content: "",
    notebook_id: state.view === "notebook" ? state.notebookId : null,
    tags: state.view === "tag" ? [state.tag] : [],
  };
  const { id } = await api.send("POST", "/api/notes", body);
  if (state.view === "trash") await selectView("all");
  await loadNotes();
  await openNote(id);
  $("#titleInput").focus();
}

async function newNotebook() {
  const name = prompt("새 노트북 이름:");
  if (!name) return;
  await api.send("POST", "/api/notebooks", { name });
  await loadNotebooks();
}

async function renameNotebook(nb) {
  const name = prompt("노트북 이름 변경:", nb.name);
  if (!name || name === nb.name) return;
  await api.send("PUT", "/api/notebooks/" + nb.id, { name });
  await loadNotebooks();
}

/* ===================== 초기화 ===================== */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function init() {
  quill = new Quill("#quillEditor", {
    theme: "snow",
    placeholder: "여기에 메모를 작성하세요...",
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ color: [] }, { background: [] }],
        [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
        ["blockquote", "code-block"],
        ["link", "image"],
        ["clean"],
      ],
    },
  });

  quill.on("text-change", (d, o, source) => {
    if (source === "user") scheduleSave();
  });

  $("#titleInput").addEventListener("input", scheduleSave);
  $("#notebookSelect").addEventListener("change", scheduleSave);

  // 태그 입력
  $("#tagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && state.currentNote) {
        state.currentNote.tags = state.currentNote.tags || [];
        if (!state.currentNote.tags.includes(val)) {
          state.currentNote.tags.push(val);
          renderTagChips(state.currentNote.tags);
          scheduleSave();
        }
      }
      e.target.value = "";
    }
  });

  // 버튼들
  $("#newNoteBtn").onclick = newNote;
  $("#newNotebookBtn").onclick = newNotebook;

  document.querySelectorAll(".nav-item").forEach((el) => {
    el.onclick = () => selectView(el.dataset.view);
  });

  $("#pinBtn").onclick = async () => {
    if (!state.currentNote) return;
    await api.send("POST", `/api/notes/${state.currentNote.id}/pin`);
    state.currentNote.is_pinned = state.currentNote.is_pinned ? 0 : 1;
    $("#pinBtn").classList.toggle("active", state.currentNote.is_pinned === 1);
    await loadNotes();
  };

  $("#trashBtn").onclick = async () => {
    if (!state.currentNote) return;
    await api.send("POST", `/api/notes/${state.currentNote.id}/trash`, { trashed: true });
    closeEditor();
    await loadNotes();
  };

  $("#restoreBtn").onclick = async () => {
    if (!state.currentNote) return;
    await api.send("POST", `/api/notes/${state.currentNote.id}/trash`, { trashed: false });
    closeEditor();
    await loadNotes();
  };

  $("#deleteBtn").onclick = async () => {
    if (!state.currentNote) return;
    if (!confirm("이 노트를 완전히 삭제합니다. 되돌릴 수 없습니다.")) return;
    await api.send("DELETE", `/api/notes/${state.currentNote.id}`);
    closeEditor();
    await loadNotes();
  };

  // 검색 (debounce)
  let searchTimer;
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      loadNotes();
    }, 250);
  });

  // 첫 로드
  selectView("all");
}

function closeEditor() {
  state.currentNote = null;
  $("#editor").classList.add("hidden");
  $("#emptyState").classList.remove("hidden");
}

// 페이지 떠나기 전 저장
window.addEventListener("beforeunload", () => {
  if (saveTimer) flushSave();
});

init();

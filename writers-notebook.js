(function () {
  const SUPABASE_URL = "https://rjkzlpdoaldwbgjpicrv.supabase.co";
  const SUPABASE_KEY = "sb_publishable_o-ayN4jSeqDkAWSP2W4uNA_-Dsl624v";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const roomGrid = document.querySelector("#writer-room-grid");
  const filter = document.querySelector("#note-filter");
  const publicList = document.querySelector("#public-note-list");
  const loginForm = document.querySelector("#writer-login");
  const loginNote = document.querySelector("#login-note");
  const sessionBox = document.querySelector("#writer-session");
  const sessionName = document.querySelector("#session-writer-name");
  const logoutButton = document.querySelector("#writer-logout");
  const studio = document.querySelector("#writer-studio");
  const noteForm = document.querySelector("#note-editor");
  const editorNote = document.querySelector("#editor-note");
  const noteCount = document.querySelector(".note-count");
  const myList = document.querySelector("#my-note-list");
  const newNoteButton = document.querySelector("#new-note-button");
  const cancelNoteButton = document.querySelector("#cancel-note-button");
  const noteReader = document.querySelector("#note-reader");
  const noteReaderClose = document.querySelector("#note-reader-close");
  const noteReaderTitle = document.querySelector("#note-reader-title");
  const noteReaderMeta = document.querySelector("#note-reader-meta");
  const noteReaderContent = document.querySelector("#note-reader-content");
  let profiles = [];
  let publicNotes = [];
  let myNotes = [];
  let currentProfile = null;
  let activeAuthor = "all";
  const burritoProfile = { user_id: "burrito-static", display_name: "브리또", slot_number: 1, bio: "브리또의 공개 습작" };
  const burritoNotes = Array.isArray(window.BURRITO_PUBLIC_NOTES) ? window.BURRITO_PUBLIC_NOTES : [];

  function setMessage(element, message, type) {
    element.textContent = message;
    element.classList.toggle("is-error", type === "error");
    element.classList.toggle("is-success", type === "success");
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
  }

  function excerpt(text, limit) {
    const clean = text.trim();
    return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
  }

  function emptyBox(target, text) {
    target.replaceChildren();
    const box = document.createElement("div");
    box.className = "writers-empty";
    const copy = document.createElement("p");
    copy.textContent = text;
    box.append(copy);
    target.append(box);
  }

  function authorName(note) {
    return note.writer_profiles?.display_name || "인투뎀 작가";
  }

  function openNoteReader(note, updateAddress = true) {
    noteReaderTitle.textContent = note.title;
    noteReaderMeta.textContent = `${authorName(note)} · ${formatDate(note.created_at)}`;
    noteReaderContent.textContent = note.content.replace(/\n{2,}/g, "\n");
    if (!noteReader.open) noteReader.showModal();
    document.body.classList.add("is-reading-note");
    if (updateAddress) {
      const url = new URL(window.location.href);
      url.searchParams.set("author", note.author_id);
      url.searchParams.set("note", note.id);
      window.history.pushState({ noteId: note.id }, "", url);
    }
  }

  function closeNoteReader(updateAddress = true) {
    if (noteReader.open) noteReader.close();
    document.body.classList.remove("is-reading-note");
    if (updateAddress) {
      const url = new URL(window.location.href);
      url.searchParams.delete("note");
      window.history.pushState({}, "", url);
    }
  }

  function renderRooms() {
    roomGrid.replaceChildren();
    for (let slot = 1; slot <= 5; slot += 1) {
      const profile = profiles.find((item) => item.slot_number === slot);
      const count = profile ? publicNotes.filter((note) => note.author_id === profile.user_id).length : 0;
      const room = document.createElement("article");
      room.className = "writer-room";
      room.tabIndex = 0;
      room.dataset.author = profile?.user_id || "";
      const number = document.createElement("span");
      const name = document.createElement("h3");
      const copy = document.createElement("p");
      number.textContent = String(slot).padStart(2, "0");
      name.textContent = profile?.display_name || (slot === 1 ? "브리또의 방" : `작가 ${String(slot).padStart(2, "0")}`);
      copy.textContent = profile ? `공개된 글 ${count}편` : "작가를 기다리고 있습니다.";
      room.append(number, name, copy);
      if (profile) {
        const selectRoom = () => selectAuthor(profile.user_id);
        room.addEventListener("click", selectRoom);
        room.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") selectRoom(); });
      }
      roomGrid.append(room);
    }
  }

  function renderFilters() {
    filter.replaceChildren();
    const options = [{ id: "all", name: "전체" }, ...profiles.map((profile) => ({ id: profile.user_id, name: profile.display_name }))];
    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.author = option.id;
      button.textContent = option.name;
      button.classList.toggle("is-active", activeAuthor === option.id);
      button.addEventListener("click", () => selectAuthor(option.id));
      filter.append(button);
    });
  }

  function selectAuthor(authorId) {
    activeAuthor = authorId;
    document.querySelectorAll(".writer-room").forEach((room) => room.classList.toggle("is-active", room.dataset.author === authorId));
    renderFilters();
    renderPublicNotes();
    document.querySelector("#public-notes-title").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderPublicNotes() {
    const notes = activeAuthor === "all" ? publicNotes : publicNotes.filter((note) => note.author_id === activeAuthor);
    if (!notes.length) {
      emptyBox(publicList, "아직 공개된 습작이 없습니다.");
      return;
    }
    publicList.replaceChildren();
    notes.forEach((note) => {
      const article = document.createElement("article");
      article.className = "public-note";
      article.id = `note-${note.id}`;
      const meta = document.createElement("div");
      meta.className = "public-note-meta";
      const writer = document.createElement("strong");
      const date = document.createElement("time");
      writer.textContent = authorName(note);
      date.dateTime = note.created_at;
      date.textContent = formatDate(note.created_at);
      meta.append(writer, document.createElement("br"), date);
      const body = document.createElement("div");
      const title = document.createElement("h3");
      const preview = document.createElement("p");
      const read = document.createElement("button");
      title.textContent = note.title;
      preview.className = "public-note-excerpt";
      preview.textContent = excerpt(note.content, 220);
      read.type = "button";
      read.className = "read-note-button";
      read.textContent = "글 전체 읽기 →";
      read.addEventListener("click", () => openNoteReader(note));
      body.append(title, preview, read);
      article.append(meta, body);
      publicList.append(article);
    });

    const requestedNote = new URLSearchParams(window.location.search).get("note");
    if (requestedNote) {
      const requested = notes.find((note) => note.id === requestedNote);
      if (requested && !noteReader.open) openNoteReader(requested, false);
    }
  }

  async function loadPublicData() {
    const [{ data: profileData, error: profileError }, { data: noteData, error: noteError }] = await Promise.all([
      client.from("writer_profiles").select("user_id,display_name,slot_number,bio").order("slot_number"),
      client.from("writer_notes").select("id,author_id,title,content,is_public,created_at,updated_at,writer_profiles(display_name)").eq("is_public", true).order("created_at", { ascending: false }).limit(50)
    ]);
    const remoteProfiles = profileError ? [] : (profileData || []);
    const remoteNotes = noteError ? [] : (noteData || []);
    profiles = [burritoProfile, ...remoteProfiles.filter((profile) => profile.slot_number !== 1)];
    const importedTitles = new Set(burritoNotes.map((note) => note.title));
    publicNotes = [...burritoNotes, ...remoteNotes.filter((note) => !importedTitles.has(note.title))]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const requestedAuthor = new URLSearchParams(window.location.search).get("author");
    if (requestedAuthor && profiles.some((profile) => profile.user_id === requestedAuthor)) activeAuthor = requestedAuthor;
    renderRooms();
    renderFilters();
    renderPublicNotes();
  }

  function closeEditor() {
    noteForm.hidden = true;
    noteForm.reset();
    noteForm.elements.id.value = "";
    noteCount.textContent = "0 / 5000";
    setMessage(editorNote, "공개 여부는 언제든 변경할 수 있습니다.");
  }

  function openEditor(note) {
    noteForm.hidden = false;
    noteForm.elements.id.value = note?.id || "";
    noteForm.elements.title.value = note?.title || "";
    noteForm.elements.content.value = note?.content || "";
    noteForm.elements.visibility.value = note?.is_public ? "public" : "private";
    noteCount.textContent = `${noteForm.elements.content.value.length} / 5000`;
    noteForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderMyNotes() {
    if (!myNotes.length) {
      emptyBox(myList, "아직 저장한 습작이 없습니다.");
      return;
    }
    myList.replaceChildren();
    myNotes.forEach((note) => {
      const article = document.createElement("article");
      article.className = "my-note";
      const visibility = document.createElement("span");
      const body = document.createElement("div");
      const title = document.createElement("h3");
      const preview = document.createElement("p");
      const actions = document.createElement("div");
      const edit = document.createElement("button");
      const remove = document.createElement("button");
      visibility.className = `visibility ${note.is_public ? "public" : ""}`;
      visibility.textContent = note.is_public ? "PUBLIC" : "PRIVATE";
      title.textContent = note.title;
      preview.textContent = excerpt(note.content, 130);
      body.append(title, preview);
      actions.className = "my-note-actions";
      edit.type = remove.type = "button";
      edit.textContent = "수정";
      remove.textContent = "삭제";
      edit.addEventListener("click", () => openEditor(note));
      remove.addEventListener("click", () => deleteNote(note));
      actions.append(edit, remove);
      article.append(visibility, body, actions);
      myList.append(article);
    });
  }

  async function loadMyNotes() {
    const { data, error } = await client.from("writer_notes").select("id,title,content,is_public,created_at,updated_at").eq("author_id", currentProfile.user_id).order("updated_at", { ascending: false });
    if (error) {
      emptyBox(myList, "나의 습작을 불러오지 못했습니다.");
      return;
    }
    myNotes = data || [];
    renderMyNotes();
  }

  async function applySession(session) {
    if (!session?.user) {
      currentProfile = null;
      loginForm.hidden = false;
      sessionBox.hidden = true;
      studio.hidden = true;
      return;
    }
    const { data, error } = await client.from("writer_profiles").select("user_id,display_name,slot_number").eq("user_id", session.user.id).maybeSingle();
    if (error || !data) {
      await client.auth.signOut();
      setMessage(loginNote, "등록된 작가 계정이 아닙니다.", "error");
      return;
    }
    currentProfile = data;
    loginForm.hidden = true;
    sessionBox.hidden = false;
    studio.hidden = false;
    sessionName.textContent = data.display_name;
    await loadMyNotes();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector("button");
    button.disabled = true;
    setMessage(loginNote, "로그인하고 있습니다.");
    const { data, error } = await client.auth.signInWithPassword({ email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value });
    button.disabled = false;
    if (error) {
      setMessage(loginNote, "이메일 또는 비밀번호를 확인해주세요.", "error");
      return;
    }
    loginForm.reset();
    setMessage(loginNote, "로그인되었습니다.", "success");
    await applySession(data.session);
  });

  logoutButton.addEventListener("click", async () => { await client.auth.signOut(); await applySession(null); });
  noteReaderClose.addEventListener("click", () => closeNoteReader());
  noteReader.addEventListener("cancel", (event) => { event.preventDefault(); closeNoteReader(); });
  noteReader.addEventListener("close", () => document.body.classList.remove("is-reading-note"));
  window.addEventListener("popstate", () => {
    const requestedNote = new URLSearchParams(window.location.search).get("note");
    const note = publicNotes.find((item) => item.id === requestedNote);
    if (note) openNoteReader(note, false);
    else closeNoteReader(false);
  });
  newNoteButton.addEventListener("click", () => openEditor());
  cancelNoteButton.addEventListener("click", closeEditor);
  noteForm.elements.content.addEventListener("input", () => { noteCount.textContent = `${noteForm.elements.content.value.length} / 5000`; });

  noteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentProfile) return;
    const id = noteForm.elements.id.value;
    const payload = { author_id: currentProfile.user_id, title: noteForm.elements.title.value.trim(), content: noteForm.elements.content.value.trim(), is_public: noteForm.elements.visibility.value === "public" };
    if (!payload.title || !payload.content) {
      setMessage(editorNote, "제목과 본문을 입력해주세요.", "error");
      return;
    }
    const save = noteForm.querySelector("button[type=submit]");
    save.disabled = true;
    const result = id ? await client.from("writer_notes").update({ title: payload.title, content: payload.content, is_public: payload.is_public }).eq("id", id).eq("author_id", currentProfile.user_id) : await client.from("writer_notes").insert(payload);
    save.disabled = false;
    if (result.error) {
      setMessage(editorNote, "글을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.", "error");
      return;
    }
    closeEditor();
    await Promise.all([loadMyNotes(), loadPublicData()]);
  });

  async function deleteNote(note) {
    if (!window.confirm(`「${note.title}」 글을 삭제할까요?`)) return;
    const { error } = await client.from("writer_notes").delete().eq("id", note.id).eq("author_id", currentProfile.user_id);
    if (error) {
      window.alert("글을 삭제하지 못했습니다.");
      return;
    }
    await Promise.all([loadMyNotes(), loadPublicData()]);
  }

  client.auth.onAuthStateChange((_event, session) => { window.setTimeout(() => applySession(session), 0); });
  loadPublicData();
  client.auth.getSession().then(({ data }) => applySession(data.session));
})();

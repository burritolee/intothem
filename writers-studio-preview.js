(function () {
  const STORAGE_KEY = "intothem-writers-preview-notes";
  const BASE_PUBLIC_COUNT = 4;
  const form = document.querySelector("#preview-note-editor");
  const list = document.querySelector("#preview-note-list");
  const message = document.querySelector("#preview-save-note");
  const saveStatus = document.querySelector("#preview-save-status");
  const count = form.querySelector(".note-count");
  const tabs = document.querySelectorAll(".preview-tabs button");
  const paper = document.querySelector("#writing-paper");
  const openPaperButton = document.querySelector("#open-writing-paper");
  const closePaperButton = document.querySelector("#close-writing-paper");
  const paperMode = document.querySelector("#writing-paper-mode");
  const reader = document.querySelector("#preview-note-reader");
  const readerClose = document.querySelector("#preview-reader-close");
  const readerTitle = document.querySelector("#preview-reader-title");
  const readerMeta = document.querySelector("#preview-reader-meta");
  const readerContent = document.querySelector("#preview-reader-content");
  let notes = loadNotes();
  let activeFilter = "all";

  function loadNotes() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (_error) {
      return [];
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function excerpt(text) {
    const clean = text.trim().replace(/\s+/g, " ");
    return clean.length > 150 ? `${clean.slice(0, 150)}…` : clean;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)).replace(/\. /g, ". ");
  }

  function updateCounts() {
    const privateCount = notes.filter((note) => !note.isPublic).length;
    const publicCount = BASE_PUBLIC_COUNT + notes.filter((note) => note.isPublic).length;
    const allCount = BASE_PUBLIC_COUNT + notes.length;
    document.querySelector("#preview-all-count").textContent = String(allCount).padStart(2, "0");
    document.querySelector("#preview-private-count").textContent = String(privateCount).padStart(2, "0");
    document.querySelector("#preview-public-count").textContent = String(publicCount).padStart(2, "0");
    document.querySelector("#preview-tab-all").textContent = allCount;
    document.querySelector("#preview-tab-private").textContent = privateCount;
    document.querySelector("#preview-tab-public").textContent = publicCount;
  }

  function refreshActionIcons() {
    document.querySelectorAll(".note-action-read .action-icon").forEach((icon) => icon.setAttribute("data-lucide", "book-open"));
    document.querySelectorAll(".note-action-edit .action-icon").forEach((icon) => icon.setAttribute("data-lucide", "pencil"));
    document.querySelectorAll(".note-action-remove .action-icon").forEach((icon) => icon.setAttribute("data-lucide", "eraser"));
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.5, "aria-hidden": "true" } });
  }

  function renderLocalNotes() {
    list.querySelectorAll("[data-preview-note]").forEach((item) => item.remove());
    notes.forEach((note) => {
      const article = document.createElement("article");
      article.className = "my-note";
      article.dataset.previewNote = note.id;
      article.dataset.visibility = note.isPublic ? "public" : "private";
      const visibility = document.createElement("span");
      visibility.className = `visibility ${note.isPublic ? "public" : ""}`;
      visibility.textContent = note.isPublic ? "PUBLIC" : "PRIVATE";
      const body = document.createElement("div");
      const title = document.createElement("h3");
      const preview = document.createElement("p");
      const time = document.createElement("time");
      title.textContent = note.title;
      preview.textContent = excerpt(note.content);
      time.dateTime = note.updatedAt;
      time.textContent = `${formatDate(note.updatedAt)} 저장`;
      body.append(title, preview, time);
      const actions = document.createElement("div");
      actions.className = "my-note-actions";
      const read = document.createElement("button");
      const edit = document.createElement("button");
      const remove = document.createElement("button");
      read.type = edit.type = remove.type = "button";
      read.className = "note-action note-action-read";
      edit.className = "note-action note-action-edit";
      remove.className = "note-action note-action-remove";
      read.setAttribute("aria-label", "읽기");
      edit.setAttribute("aria-label", "수정");
      remove.setAttribute("aria-label", "삭제");
      read.title = "읽기";
      edit.title = "수정";
      remove.title = "삭제";
      read.innerHTML = '<i class="action-icon" data-lucide="book-open" aria-hidden="true">▤</i>';
      edit.innerHTML = '<i class="action-icon" data-lucide="pencil" aria-hidden="true">／</i>';
      remove.innerHTML = '<i class="action-icon" data-lucide="eraser" aria-hidden="true">▱</i>';
      read.addEventListener("click", () => readNote(note));
      edit.addEventListener("click", () => editNote(note));
      remove.addEventListener("click", () => removeNote(note));
      actions.append(read, edit, remove);
      body.append(actions);
      article.append(visibility, body);
      list.prepend(article);
    });
    list.querySelectorAll(".my-note > .my-note-actions").forEach((actions) => {
      const body = actions.parentElement.querySelector(":scope > div:not(.my-note-actions)");
      if (body) body.append(actions);
    });
    list.querySelectorAll(".my-note").forEach((item) => {
      const visibility = item.dataset.visibility || (item.querySelector(".visibility.public") ? "public" : "private");
      item.hidden = activeFilter !== "all" && visibility !== activeFilter;
    });
    updateCounts();
    refreshActionIcons();
  }

  function readNote(note) {
    readerTitle.textContent = note.title;
    readerMeta.textContent = `${note.isPublic ? "공개 글" : "비공개 글"} · ${formatDate(note.updatedAt)}`;
    readerContent.textContent = note.content.replace(/\n{2,}/g, "\n");
    reader.showModal();
    document.body.classList.add("is-reading-note");
  }

  function closeReader() {
    if (reader.open) reader.close();
    document.body.classList.remove("is-reading-note");
  }

  function editNote(note) {
    form.elements.id.value = note.id;
    form.elements.title.value = note.title;
    form.elements.content.value = note.content;
    form.elements.visibility.value = note.isPublic ? "public" : "private";
    count.textContent = `${note.content.length} / 5000`;
    message.textContent = "글을 수정한 뒤 다시 저장해주세요.";
    paperMode.textContent = "EDIT WRITING";
    paper.showModal();
    document.body.classList.add("is-writing");
    window.requestAnimationFrame(() => { form.elements.content.style.height = `${form.elements.content.scrollHeight}px`; });
    form.elements.title.focus();
  }

  function openNewPaper() {
    form.reset();
    form.elements.id.value = "";
    form.elements.content.style.height = "";
    count.textContent = "0 / 5000";
    paperMode.textContent = "NEW WRITING";
    message.textContent = "이 글은 현재 브라우저에 저장됩니다.";
    message.className = "";
    paper.showModal();
    document.body.classList.add("is-writing");
    form.elements.title.focus();
  }

  function closePaper() {
    if (paper.open) paper.close();
    document.body.classList.remove("is-writing");
  }

  function removeNote(note) {
    if (!window.confirm(`「${note.title}」 글을 삭제할까요?`)) return;
    notes = notes.filter((item) => item.id !== note.id);
    persist();
    renderLocalNotes();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = form.elements.title.value.trim();
    const content = form.elements.content.value.trim();
    if (!title || !content) {
      message.textContent = "제목과 본문을 모두 입력해주세요.";
      message.className = "is-error";
      return;
    }
    const id = form.elements.id.value;
    const saved = { id: id || `preview-${Date.now()}`, title, content, isPublic: form.elements.visibility.value === "public", updatedAt: new Date().toISOString() };
    notes = id ? notes.map((note) => note.id === id ? saved : note) : [...notes, saved];
    persist();
    form.reset();
    form.elements.id.value = "";
    count.textContent = "0 / 5000";
    message.textContent = "습작이 이 브라우저에 저장되었습니다.";
    message.className = "is-success";
    saveStatus.textContent = `「${saved.title}」 글을 저장했습니다.`;
    saveStatus.className = "preview-save-status is-success";
    renderLocalNotes();
    closePaper();
  });

  form.addEventListener("reset", () => {
    window.setTimeout(() => {
      form.elements.id.value = "";
      count.textContent = "0 / 5000";
      message.textContent = "저장한 글은 현재 브라우저에서만 확인할 수 있습니다.";
      message.className = "";
    }, 0);
  });
  form.elements.content.addEventListener("input", () => {
    count.textContent = `${form.elements.content.value.length} / 5000`;
    form.elements.content.style.height = "auto";
    form.elements.content.style.height = `${form.elements.content.scrollHeight}px`;
  });
  openPaperButton.addEventListener("click", openNewPaper);
  closePaperButton.addEventListener("click", closePaper);
  paper.addEventListener("cancel", (event) => { event.preventDefault(); closePaper(); });
  paper.addEventListener("close", () => document.body.classList.remove("is-writing"));
  readerClose.addEventListener("click", closeReader);
  reader.addEventListener("cancel", (event) => { event.preventDefault(); closeReader(); });
  reader.addEventListener("close", () => document.body.classList.remove("is-reading-note"));
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    activeFilter = tab.dataset.filter;
    tabs.forEach((button) => button.classList.toggle("is-active", button === tab));
    renderLocalNotes();
  }));

  renderLocalNotes();
})();

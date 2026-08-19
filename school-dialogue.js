(function () {
  const SUPABASE_URL = "https://rjkzlpdoaldwbgjpicrv.supabase.co";
  const SUPABASE_KEY = "sb_publishable_o-ayN4jSeqDkAWSP2W4uNA_-Dsl624v";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const list = document.querySelector("#dialogue-list");
  const form = document.querySelector("#dialogue-form");
  const note = document.querySelector("#dialogue-form-note");
  const messageInput = form.elements.message;
  const count = form.querySelector(".character-count");
  const editor = document.querySelector("#dialogue-editor");
  const editorForm = document.querySelector("#dialogue-editor-form");
  const editorNote = editor.querySelector(".editor-note");
  let entries = [];

  function setNote(element, text, kind) {
    element.textContent = text;
    element.classList.toggle("is-error", kind === "error");
    element.classList.toggle("is-success", kind === "success");
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function emptyState(title, body) {
    list.replaceChildren();
    const box = document.createElement("div");
    box.className = "dialogue-empty";
    const heading = document.createElement("p");
    const copy = document.createElement("span");
    heading.textContent = title;
    copy.textContent = body;
    box.append(heading, copy);
    list.append(box);
  }

  function render() {
    if (!entries.length) {
      emptyState("첫 번째 대화를 기다리고 있습니다.", "당신의 생각을 이곳에 남겨주세요.");
      return;
    }
    list.replaceChildren();
    entries.forEach((entry) => {
      const article = document.createElement("article");
      article.className = "dialogue-entry";
      const meta = document.createElement("div");
      meta.className = "dialogue-entry-meta";
      const name = document.createElement("strong");
      const time = document.createElement("time");
      const edit = document.createElement("button");
      const message = document.createElement("p");
      name.textContent = entry.nickname;
      time.dateTime = entry.created_at;
      time.textContent = formatDate(entry.created_at);
      edit.type = "button";
      edit.textContent = "수정·삭제";
      edit.addEventListener("click", () => openEditor(entry));
      message.className = "dialogue-entry-message";
      message.textContent = entry.message;
      meta.append(name, time, edit);
      article.append(meta, message);
      list.append(article);
    });
  }

  async function loadEntries() {
    const { data, error } = await client
      .from("school_dialogue")
      .select("id,nickname,message,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      emptyState("대화를 불러오지 못했습니다.", "잠시 후 다시 시도해주세요.");
      return;
    }
    entries = data || [];
    render();
  }

  function openEditor(entry) {
    editorForm.elements.id.value = entry.id;
    editorForm.elements.nickname.value = entry.nickname;
    editorForm.elements.message.value = entry.message;
    editorForm.elements.pin.value = "";
    setNote(editorNote, "비밀번호를 입력하면 수정하거나 삭제할 수 있습니다.");
    editor.showModal();
  }

  messageInput.addEventListener("input", () => { count.textContent = `${messageInput.value.length} / 500`; });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.elements.agreement.checked) {
      setNote(note, "대화 운영 원칙과 개인정보 안내에 동의해주세요.", "error");
      return;
    }
    const nickname = form.elements.nickname.value.trim();
    const message = form.elements.message.value.trim();
    const pin = form.elements.pin.value;
    if (!nickname || nickname.length > 10 || !message || message.length > 500 || !/^\d{4}$/.test(pin)) {
      setNote(note, "이름·내용·네 자리 숫자 비밀번호를 확인해주세요.", "error");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setNote(note, "글을 등록하고 있습니다.");
    const { error } = await client.rpc("create_school_dialogue", { p_nickname: nickname, p_message: message, p_pin: pin });
    button.disabled = false;
    if (error) {
      setNote(note, "등록하지 못했습니다. 잠시 후 다시 시도해주세요.", "error");
      return;
    }
    form.reset();
    count.textContent = "0 / 500";
    setNote(note, "글이 공개되었습니다.", "success");
    await loadEntries();
  });

  editor.querySelector(".editor-close").addEventListener("click", () => editor.close());

  editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = Number(editorForm.elements.id.value);
    const nickname = editorForm.elements.nickname.value.trim();
    const message = editorForm.elements.message.value.trim();
    const pin = editorForm.elements.pin.value;
    if (!nickname || nickname.length > 10 || !message || message.length > 500 || !/^\d{4}$/.test(pin)) {
      setNote(editorNote, "입력 내용과 네 자리 비밀번호를 확인해주세요.", "error");
      return;
    }
    const save = editor.querySelector(".editor-save");
    save.disabled = true;
    const { error } = await client.rpc("update_school_dialogue", { p_id: id, p_nickname: nickname, p_message: message, p_pin: pin });
    save.disabled = false;
    if (error) {
      setNote(editorNote, "비밀번호가 다르거나 잠시 수정할 수 없습니다.", "error");
      return;
    }
    editor.close();
    await loadEntries();
  });

  editor.querySelector(".editor-delete").addEventListener("click", async () => {
    const id = Number(editorForm.elements.id.value);
    const pin = editorForm.elements.pin.value;
    if (!/^\d{4}$/.test(pin)) {
      setNote(editorNote, "네 자리 비밀번호를 먼저 입력해주세요.", "error");
      return;
    }
    if (!window.confirm("이 글을 삭제할까요? 삭제 후에는 되돌릴 수 없습니다.")) return;
    const remove = editor.querySelector(".editor-delete");
    remove.disabled = true;
    const { error } = await client.rpc("delete_school_dialogue", { p_id: id, p_pin: pin });
    remove.disabled = false;
    if (error) {
      setNote(editorNote, "비밀번호가 다르거나 잠시 삭제할 수 없습니다.", "error");
      return;
    }
    editor.close();
    await loadEntries();
  });

  loadEntries();
})();

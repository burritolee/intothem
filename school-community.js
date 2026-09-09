(function () {
  const SUPABASE_URL = "https://rjkzlpdoaldwbgjpicrv.supabase.co";
  const SUPABASE_KEY = "sb_publishable_o-ayN4jSeqDkAWSP2W4uNA_-Dsl624v";
  // 기존 나는학교 세션을 유지하도록 현재 기본 키를 명시합니다.
  const COMMUNITY_AUTH_STORAGE_KEY = "sb-rjkzlpdoaldwbgjpicrv-auth-token";
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: COMMUNITY_AUTH_STORAGE_KEY,
      storage: window.localStorage
    }
  });
  const $ = (selector) => document.querySelector(selector);
  const loginView = $("#login-view");
  const pendingView = $("#pending-view");
  const communityView = $("#community-view");
  const loginForm = $("#login-form");
  const loginNote = $("#login-note");
  const postList = $("#post-list");
  const postDialog = $("#post-dialog");
  const postForm = $("#post-form");
  const reader = $("#reader-dialog");
  const previewMode = new URLSearchParams(location.search).get("preview") === "1";
  let currentMember = null;
  let memberships = [];
  let posts = [];
  let category = "all";

  const demoPosts = [
    { id:"preview-1", category:"notice", title:"첫 번째 모임을 시작합니다", content:"나는학교 아고라가 열렸습니다. 이곳에서 서로의 질문과 자료를 천천히 나누어주세요.", author_nickname:"관리자", created_at:new Date().toISOString(), comment_count:2, attachment_count:0, is_pinned:true },
    { id:"preview-2", category:"resource", title:"함께 읽을 자료를 공유합니다", content:"다음 모임에서 함께 이야기할 자료입니다. 읽으며 떠오른 질문을 댓글로 남겨주세요.", author_nickname:"숲", created_at:new Date(Date.now()-86400000).toISOString(), comment_count:4, attachment_count:2 },
    { id:"preview-3", category:"discussion", title:"배움이 시작되는 순간은 언제일까요?", content:"누군가의 설명을 들었을 때보다 스스로 질문이 생겼을 때 배움이 시작된다고 느꼈습니다. 여러분은 어떤가요?", author_nickname:"마루", created_at:new Date(Date.now()-172800000).toISOString(), comment_count:7, attachment_count:0 }
  ];
  const categoryNames = { notice:"공지", resource:"자료공유", discussion:"질문과 토론" };
  const roleNames = { admin:"전체 관리자", operator:"그룹 운영자", member:"참여자" };

  function show(view) {
    [loginView, pendingView, communityView].forEach((node) => { node.hidden = node !== view; });
  }
  function setMessage(text, type) {
    loginNote.textContent = text;
    loginNote.className = `login-note${type ? ` is-${type}` : ""}`;
  }
  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", { year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(value));
  }
  function formatFileSize(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  function escapeText(value) {
    const node = document.createElement("span"); node.textContent = value || ""; return node.innerHTML;
  }
  function isManager() { return currentMember && ["admin", "operator"].includes(currentMember.role); }

  async function loadMembership(user) {
    const { data, error } = await client.from("school_memberships").select("id,role,status,nickname,real_name,group_id,school_groups(id,name,project_id)").eq("user_id", user.id).eq("status", "active");
    if (error || !data || !data.length) { show(pendingView); return; }
    memberships = data;
    currentMember = data[0];
    $("#member-nickname").textContent = currentMember.nickname;
    $("#member-real-name").textContent = roleNames[currentMember.role] || "참여자";
    $("#admin-entry").hidden = !isManager();
    $("#logout-button").hidden = false;
    const select = $("#group-select");
    select.replaceChildren(...memberships.map((item) => new Option(item.school_groups.name, item.group_id)));
    show(communityView);
    if (currentMember.real_name === "가입 후 입력") {
      $("#profile-form").elements.nickname.value = currentMember.nickname;
      $("#profile-dialog").showModal();
    }
    await Promise.all([loadPosts(), loadNotifications()]);
  }

  function enterPreview() {
    currentMember = { role:"admin", nickname:"브리또", real_name:"미리보기" };
    memberships = [{ group_id:"preview", school_groups:{ name:"나는학교 1기", project_id:"preview" } }];
    $("#member-nickname").textContent = "브리또";
    $("#member-real-name").textContent = "전체 관리자";
    $("#admin-entry").hidden = false;
    $("#group-select").replaceChildren(new Option("나는학교 1기", "preview"));
    posts = demoPosts;
    show(communityView);
    renderPosts(); renderPinned();
  }

  async function loadPosts() {
    const groupId = $("#group-select").value;
    if (!posts.length) postList.innerHTML = '<p class="board-empty">글을 불러오고 있습니다.</p>';
    const { data, error } = await client.from("school_posts_view").select("*").or(`group_id.eq.${groupId},visibility.eq.project`).eq("is_hidden", false).order("is_pinned", { ascending:false }).order("created_at", { ascending:false });
    if (error) {
      console.error("school posts load failed", error);
      if (!posts.length) postList.innerHTML = `<p class="board-empty">글을 불러오지 못했습니다.<br>${escapeText(error.message || "잠시 후 다시 시도해주세요.")}</p>`;
      return;
    }
    posts = data || []; renderPosts(); renderPinned();
  }

  function renderPinned() {
    const pinned = posts.find((post) => post.is_pinned);
    $("#notice-strip").hidden = !pinned;
    if (!pinned) return;
    $("#pinned-title").textContent = pinned.title;
    $("#pinned-open").onclick = () => openPost(pinned);
  }
  function renderPosts() {
    const filtered = category === "all" ? posts : posts.filter((post) => post.category === category);
    if (!filtered.length) { postList.innerHTML = '<p class="board-empty">아직 등록된 글이 없습니다. 첫 번째 기록을 남겨주세요.</p>'; return; }
    postList.replaceChildren();
    filtered.forEach((post) => {
      const article = document.createElement("article"); article.className = "post-item"; article.tabIndex = 0;
      article.innerHTML = `<span class="post-category">${escapeText(categoryNames[post.category] || post.category)}</span><div><h3 class="post-title">${post.is_pinned ? "● " : ""}${escapeText(post.title)}</h3><p class="post-excerpt">${escapeText(post.content)}</p><div class="post-meta"><span>${escapeText(post.author_nickname)}</span><time>${formatDate(post.created_at)}</time><span>${post.visibility === "project" ? "전체 공개" : "그룹 공개"}</span></div></div><div class="post-stats"><span>댓글 ${post.comment_count || 0}</span><span>자료 ${post.attachment_count || 0}</span></div>`;
      article.addEventListener("click", () => openPost(post));
      article.addEventListener("keydown", (event) => { if (event.key === "Enter") openPost(post); });
      postList.append(article);
    });
  }

  async function openPost(post) {
    const target = $("#reader-content");
    target.innerHTML = `<button type="button" class="dialog-close reader-close" aria-label="닫기">×</button><p class="community-label">${escapeText(categoryNames[post.category])}</p><h1>${escapeText(post.title)}</h1><p class="reader-meta">${escapeText(post.author_nickname)} · ${formatDate(post.created_at)}</p><div class="reader-body">${escapeText(post.content).replace(/\n/g,"<br>")}</div><section class="reader-attachments" id="attachment-list" hidden></section><section class="reader-comments"><h2>댓글 <span id="reader-comment-count">${post.comment_count || 0}</span></h2><div id="comment-list"><p>댓글을 불러오고 있습니다.</p></div><form id="comment-form"><textarea name="content" maxlength="2000" rows="3" required placeholder="생각을 이어주세요."></textarea><button type="submit">댓글 남기기</button><p class="comment-note" id="comment-note" aria-live="polite"></p></form></section>`;
    target.querySelector(".reader-close").onclick = () => reader.close();
    reader.showModal();
    if (previewMode) { $("#comment-list").innerHTML = "<p>미리보기에서는 댓글을 저장하지 않습니다.</p>"; $("#comment-form").onsubmit = (event) => event.preventDefault(); return; }
    const [{ data:comments, error:commentLoadError }, { data:attachments, error:attachmentError }] = await Promise.all([
      client.from("school_comments_view").select("id,content,created_at,author_nickname").eq("post_id", post.id).eq("is_hidden", false).order("created_at"),
      client.from("school_attachments").select("id,storage_path,original_name,mime_type,size_bytes").eq("post_id", post.id).order("created_at")
    ]);
    renderReaderComments(comments || [], commentLoadError);
    const attachmentList = $("#attachment-list");
    if (!attachmentError && attachments?.length) {
      const signed = await Promise.all(attachments.map(async (attachment) => {
        const { data, error } = await client.storage.from("school-resources").createSignedUrl(attachment.storage_path, 3600);
        return error ? null : { ...attachment, url:data.signedUrl };
      }));
      const available = signed.filter(Boolean);
      if (available.length) {
        attachmentList.hidden = false;
        attachmentList.innerHTML = `<h2>첨부 자료 <span>${available.length}</span></h2><div class="attachment-grid">${available.map((attachment) => {
          const name = escapeText(attachment.original_name);
          const meta = `${escapeText(attachment.mime_type || "파일")} · ${formatFileSize(attachment.size_bytes)}`;
          return attachment.mime_type?.startsWith("image/")
            ? `<a class="attachment-image" href="${attachment.url}" target="_blank" rel="noopener"><img src="${attachment.url}" alt="${name}" loading="lazy" decoding="async"><strong>${name}</strong><span>${meta}</span></a>`
            : `<a class="attachment-file" href="${attachment.url}" target="_blank" rel="noopener"><strong>${name}</strong><span>${meta}</span><i>열기 ↗</i></a>`;
        }).join("")}</div>`;
      }
    }
    $("#comment-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const content = form.elements.content.value.trim();
      const button = form.querySelector("button");
      const note = $("#comment-note");
      if (!content || button.disabled) return;
      button.disabled = true;
      note.textContent = "댓글을 저장하고 있습니다.";
      note.className = "comment-note";
      const { error } = await client.from("school_comments").insert({ post_id:post.id, author_membership_id:currentMember.id, content });
      if (error) {
        console.error("school comment save failed", error);
        note.textContent = `댓글을 저장하지 못했습니다. ${error.message || "다시 시도해주세요."}`;
        note.className = "comment-note is-error";
        button.disabled = false;
        return;
      }
      form.elements.content.value = "";
      const { data:nextComments, error:reloadError } = await client.from("school_comments_view").select("id,content,created_at,author_nickname").eq("post_id", post.id).eq("is_hidden", false).order("created_at");
      renderReaderComments(nextComments || [], reloadError);
      post.comment_count = nextComments?.length ?? Number(post.comment_count || 0) + 1;
      $("#reader-comment-count").textContent = post.comment_count;
      renderPosts();
      note.textContent = reloadError ? "댓글은 저장됐지만 목록을 새로 불러오지 못했습니다." : "댓글을 남겼습니다.";
      note.className = `comment-note ${reloadError ? "is-error" : "is-success"}`;
      button.disabled = false;
    };
  }

  function renderReaderComments(comments, error) {
    const list = $("#comment-list");
    if (!list) return;
    if (error) {
      console.error("school comments load failed", error);
      list.innerHTML = `<p class="comment-load-error">댓글을 불러오지 못했습니다. ${escapeText(error.message || "잠시 후 다시 시도해주세요.")}</p>`;
      return;
    }
    list.innerHTML = comments.map((comment) => `<article><strong>${escapeText(comment.author_nickname || "참여자")}</strong><time>${formatDate(comment.created_at)}</time><p>${escapeText(comment.content)}</p></article>`).join("") || "<p>첫 댓글을 기다리고 있습니다.</p>";
  }

  async function loadNotifications() {
    const { count } = await client.from("school_notifications").select("id", { count:"exact", head:true }).eq("membership_id", currentMember.id).is("read_at", null);
    const badge = $("#notification-count"); badge.textContent = count || 0; badge.hidden = !count;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const email = loginForm.elements.email.value.trim(); const button = loginForm.querySelector("button"); button.disabled = true;
    setMessage("로그인 링크를 보내고 있습니다.");
    const redirectTo = location.protocol === "file:"
      ? "http://127.0.0.1:4173/naneun-school-community.html"
      : `${location.origin}${location.pathname}`;
    const { error } = await client.auth.signInWithOtp({ email, options:{ emailRedirectTo:redirectTo, shouldCreateUser:false } });
    button.disabled = false;
    if (error) {
      const limited = error.status === 429 || /rate|limit|security purposes/i.test(error.message || "");
      setMessage(limited ? "로그인 메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해주세요." : `로그인 링크를 보내지 못했습니다. ${error.message || "관리자에게 문의해주세요."}`, "error");
      return;
    }
    setMessage("이 브라우저에서 이메일 링크를 한 번만 눌러주세요. 이후에는 자동으로 로그인됩니다.", "success");
  });
  $("#logout-button").addEventListener("click", async () => { await client.auth.signOut({ scope:"local" }); location.reload(); });
  $("#pending-login-again").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const { error } = await client.auth.signOut({ scope:"local" });
    if (error) window.localStorage.removeItem(COMMUNITY_AUTH_STORAGE_KEY);
    location.reload();
  });
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const realName=form.elements.real_name.value.trim(); const nickname=form.elements.nickname.value.trim(); const note=$("#profile-note");
    if (realName.length < 2 || nickname.length < 1) { note.textContent="실명과 닉네임을 확인해주세요."; note.className="form-note is-error"; return; }
    const { error } = await client.from("school_memberships").update({real_name:realName,nickname,updated_at:new Date().toISOString()}).eq("id",currentMember.id);
    if (error) { note.textContent="정보를 저장하지 못했습니다."; note.className="form-note is-error"; return; }
    currentMember.real_name=realName; currentMember.nickname=nickname; $("#member-nickname").textContent=nickname; $("#member-real-name").textContent=roleNames[currentMember.role] || "참여자"; $("#profile-dialog").close();
  });
  $("#group-select").addEventListener("change", () => previewMode ? renderPosts() : loadPosts());
  document.querySelectorAll(".community-nav button[data-category]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".community-nav button").forEach((item) => item.classList.remove("is-active")); button.classList.add("is-active"); category = button.dataset.category; $("#board-title").textContent = button.childNodes[1].textContent.trim(); $("#board-label").textContent = category === "all" ? "ALL NOTES" : category.toUpperCase(); renderPosts(); }));
  $("#new-post-button").addEventListener("click", () => postDialog.showModal());
  $("#admin-entry").addEventListener("click", async () => {
    const dialog = $("#admin-dialog"); dialog.showModal();
    if (previewMode) { renderAdminMembers([{id:"1",real_name:"관리자",nickname:"브리또",role:"admin",status:"active"},{id:"2",real_name:"김회원",nickname:"숲",role:"operator",status:"active"},{id:"3",real_name:"이회원",nickname:"마루",role:"member",status:"active"}]); return; }
    const groupId = $("#group-select").value;
    const [{data:members},{count:hiddenCount}] = await Promise.all([client.from("school_memberships").select("id,real_name,nickname,role,status").eq("group_id",groupId).order("created_at"),client.from("school_posts").select("id",{count:"exact",head:true}).eq("group_id",groupId).eq("is_hidden",true)]);
    $("#admin-hidden-count").textContent = hiddenCount || 0; renderAdminMembers(members || []);
  });
  $(".admin-close").addEventListener("click", () => $("#admin-dialog").close());
  function renderAdminMembers(members) {
    $("#admin-active-count").textContent = members.filter((item) => item.status === "active").length;
    $("#admin-operator-count").textContent = members.filter((item) => item.role === "operator").length;
    const list = $("#admin-member-list"); list.replaceChildren();
    members.forEach((member) => {
      const row=document.createElement("article"); row.className="admin-member";
      row.innerHTML=`<div><strong>${escapeText(member.nickname)}</strong><span>${escapeText(member.real_name)}</span></div><select aria-label="역할"><option value="member">일반 회원</option><option value="operator">그룹 운영자</option><option value="admin">전체 관리자</option></select><select aria-label="상태"><option value="active">활동</option><option value="suspended">활동 정지</option><option value="withdrawn">탈퇴</option></select>`;
      const selects=row.querySelectorAll("select"); selects[0].value=member.role; selects[1].value=member.status;
      selects.forEach((select) => select.addEventListener("change", async()=>{ if(previewMode)return; await client.from("school_memberships").update({role:selects[0].value,status:selects[1].value,updated_at:new Date().toISOString()}).eq("id",member.id); })); list.append(row);
    });
  }
  document.querySelectorAll(".dialog-close,.dialog-cancel").forEach((button) => button.addEventListener("click", () => postDialog.close()));
  postForm.addEventListener("submit", async (event) => {
    event.preventDefault(); if (previewMode) { $("#post-form-note").textContent = "미리보기에서는 글을 저장하지 않습니다."; return; }
    const files = Array.from(postForm.elements.files.files); const note = $("#post-form-note");
    if (files.length > 5 || files.some((file) => file.size > 20 * 1024 * 1024)) { note.textContent = "첨부파일은 최대 5개, 파일당 20MB까지 가능합니다."; note.className = "form-note is-error"; return; }
    const button = postForm.querySelector(".post-submit"); button.disabled = true;
    const payload = { group_id:$("#group-select").value, author_membership_id:currentMember.id, category:postForm.elements.category.value, visibility:postForm.elements.visibility.value, title:postForm.elements.title.value.trim(), content:postForm.elements.content.value.trim() };
    const { data:created, error } = await client.from("school_posts").insert(payload).select("*").single();
    if (error) { console.error("school post save failed", error); note.textContent = `글을 저장하지 못했습니다. ${error.message || ""}`; note.className = "form-note is-error"; button.disabled = false; return; }
    let uploadedCount = 0; const uploadFailures = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._가-힣-]/g,"_"); const path = `${payload.group_id}/${created.id}/${crypto.randomUUID()}-${safeName}`;
      const uploaded = await client.storage.from("school-resources").upload(path, file);
      if (uploaded.error) { console.error("school file upload failed", uploaded.error); uploadFailures.push(file.name); continue; }
      const { error:metadataError } = await client.from("school_attachments").insert({ post_id:created.id, uploader_membership_id:currentMember.id, storage_path:path, original_name:file.name, mime_type:file.type, size_bytes:file.size });
      if (metadataError) { console.error("school attachment metadata save failed", metadataError); uploadFailures.push(file.name); await client.storage.from("school-resources").remove([path]); continue; }
      uploadedCount += 1;
    }
    const visiblePost={...created,author_nickname:currentMember.nickname,comment_count:0,attachment_count:uploadedCount};
    posts=[visiblePost,...posts.filter((item)=>item.id!==visiblePost.id)];
    button.disabled = false; postForm.reset(); postDialog.close(); renderPosts(); renderPinned();
    await loadPosts();
    if (uploadFailures.length) postList.insertAdjacentHTML("afterbegin", `<p class="upload-warning">글은 저장했지만 다음 자료는 올리지 못했습니다: ${escapeText(uploadFailures.join(", "))}</p>`);
  });

  (async function init() {
    if (previewMode) { enterPreview(); return; }
    const { data:{ session } } = await client.auth.getSession();
    if (session?.user) await loadMembership(session.user); else show(loginView);
    client.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession?.user) loadMembership(nextSession.user);
      else if (event === "SIGNED_OUT") show(loginView);
    });
  })();
})();

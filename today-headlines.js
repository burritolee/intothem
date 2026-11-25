(() => {
  const posts = window.INTOTHEM_TODAY_POSTS || [];
  const latest = posts[0];
  if (!latest) return;
  const previousInSeries = latest.series
    ? posts.slice(1).filter((post) => post.series === latest.series)
    : [];

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  };
  const setHref = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.href = value;
  };

  // 로컬 홈페이지의 인투뎀 투데이 진입 영역.
  setText(".today-feature-series", latest.category);
  setText(".today-feature-title", latest.featureTitle || latest.title);
  setText(".today-feature-desc", latest.summary);
  setHref(".today-feature-link", latest.href);
  setText(".now-today-feature strong", latest.featureTitle || latest.title);

  // 인투뎀 투데이의 첫 표제와 기사 소개를 한 기록에서 함께 갱신합니다.
  const leadTitle = document.getElementById("lead-title");
  if (!leadTitle) return;
  leadTitle.textContent = latest.featureTitle || latest.title;
  setText(".lead-heading .standfirst", latest.summary);

  const leadCopy = document.querySelector(".lead-copy");
  if (leadCopy) {
    const paragraphs = (latest.leadParagraphs || []).map((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    });
    const link = document.createElement("a");
    link.className = "read-link";
    link.href = latest.href;
    link.textContent = "첫 기사 읽기";
    leadCopy.replaceChildren(...paragraphs, link);
  }

  // 최신 기사를 첫 번째 카드로 올리고, NEW 표시는 그 카드에만 붙입니다.
  const stories = document.querySelector(".stories");
  if (stories) {
    let story = latest.storyId && document.getElementById(latest.storyId)?.closest(".story");
    if (!story) {
      story = document.createElement("article");
      story.className = "story";
      story.id = latest.storyId || "story-latest";
      const kicker = document.createElement("p");
      kicker.className = "kicker";
      kicker.textContent = latest.category;
      const heading = document.createElement("h3");
      heading.textContent = latest.title;
      let visual;
      const imageSource = latest.storyImage || (latest.series === "jeffrey-meditation"
        ? "assets/intothem-today-meditation-photo-line.png"
        : null);
      if (imageSource) {
        visual = document.createElement("figure");
        visual.className = `story-figure${latest.series === "jeffrey-meditation" ? " meditation-illustration" : ""}`;
        const img = document.createElement("img");
        img.src = imageSource;
        img.alt = latest.storyImageAlt || latest.title;
        img.loading = "lazy";
        img.decoding = "async";
        const photoMotion = document.createElement("span");
        photoMotion.className = "photo-motion";
        photoMotion.append(img);
        visual.append(photoMotion);
      } else {
        visual = document.createElement("div");
        visual.className = "topic-mark";
        visual.textContent = latest.category;
      }
      const copy = document.createElement("div");
      copy.className = "story-copy";
      const description = document.createElement("p");
      description.textContent = latest.summary;
      const link = document.createElement("a");
      link.className = "read-link";
      link.href = latest.href;
      link.textContent = "기사 읽기";
      copy.append(description, link);
      story.append(kicker, heading, visual, copy);
    }
    let replacedStoryId = null;
    if (latest.series) {
      story.dataset.series = latest.series;
      stories.querySelectorAll(`.story[data-series="${latest.series}"]`).forEach((item) => {
        if (item !== story) {
          replacedStoryId ||= item.querySelector("h3")?.id || item.id;
          item.remove();
        }
      });
    }
    const latestNav = document.getElementById("latest-nav");
    if (latestNav) {
      const oldLatestHref = latestNav.getAttribute("href");
      const oldLatestText = latestNav.textContent.replace(/\s*·\s*NEW\s*$/, "");
      const replacedNav = replacedStoryId
        ? [...document.querySelectorAll(".section-index a")].find((anchor) =>
            anchor !== latestNav && anchor.getAttribute("href") === `#${replacedStoryId}`)
        : null;
      if (replacedNav) {
        replacedNav.href = oldLatestHref;
        replacedNav.textContent = oldLatestText;
      }
      latestNav.href = `#${latest.storyId || story.id}`;
      latestNav.textContent = `${latest.navLabel || latest.category} · NEW`;
    }
    const heading = story.querySelector("h3");
    if (heading) heading.textContent = latest.title;
    const storyCopy = story.querySelector(".story-copy");
    if (storyCopy) {
      const description = document.createElement("p");
      description.textContent = latest.storySummary || latest.summary;
      const link = document.createElement("a");
      link.className = "read-link";
      link.href = latest.href;
      link.textContent = "기사 읽기";
      const links = [description, link];
      previousInSeries.forEach((previousPost) => {
        const previousLink = document.createElement("a");
        previousLink.className = "previous-article-link";
        previousLink.href = previousPost.href;
        const previousLabel = latest.series === "jeffrey-meditation" ? "전 묵상보기" : "전 기사보기";
        previousLink.textContent = `${previousLabel} · ${previousPost.title}`;
        links.push(previousLink);
      });
      storyCopy.replaceChildren(...links);
    }
    stories.prepend(story);
    stories.querySelectorAll(".new-badge").forEach((badge) => badge.remove());
    [...stories.children].filter((child) => child.classList.contains("story")).forEach((item, index) => {
      const kicker = item.querySelector(".kicker");
      if (!kicker) return;
      const category = kicker.textContent.replace(/^\d{2}\s*\/\s*/, "").trim();
      kicker.textContent = `${String(index + 1).padStart(2, "0")} / ${category}`;
      if (index === 0) {
        const badge = document.createElement("span");
        badge.className = "new-badge";
        badge.textContent = "NEW";
        kicker.append(" ", badge);
      }
    });
  }
  document.title = `${latest.featureTitle || latest.title} · 인투뎀 투데이`;
})();

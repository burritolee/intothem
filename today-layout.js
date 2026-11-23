(() => {
  const stories = document.querySelector(".stories");
  if (!stories) return;

  // Keep the article order set by today-headlines.js. On wide screens, each
  // column then grows according to its own article lengths.
  const articles = [...stories.querySelectorAll(":scope > .story")];
  const narrow = window.matchMedia("(max-width: 760px)");

  const arrange = () => {
    if (narrow.matches) {
      stories.replaceChildren(...articles);
      return;
    }

    const columns = [document.createElement("div"), document.createElement("div")];
    columns.forEach((column) => { column.className = "story-column"; });
    articles.forEach((article, index) => columns[index % 2].append(article));
    stories.replaceChildren(...columns);
  };

  arrange();
  narrow.addEventListener("change", arrange);
})();

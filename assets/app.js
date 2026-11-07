(() => {
  "use strict";

  const MAX_RESULTS = 500;
  const MENU_GROUP_SIZE = 10;
  const MODE_KEY = "orv-reader-mode";
  const state = {
    index: null,
    chapter: null,
    scope: "chapter",
    query: "",
    mode: "english",
    hasKorean: false,
    cache: new Map(),
    searchToken: 0,
    noteCounter: 0,
  };

  const elements = {
    chapterCount: document.querySelector("#chapter-count"),
    lineCount: document.querySelector("#line-count"),
    updatedAt: document.querySelector("#updated-at"),
    viewSwitcher: document.querySelector("#view-switcher"),
    parallelMode: document.querySelector("#parallel-mode"),
    englishMode: document.querySelector("#english-mode"),
    chapterPicker: document.querySelector("#chapter-picker"),
    chapterButton: document.querySelector("#chapter-menu-button"),
    chapterValue: document.querySelector("#chapter-menu-value"),
    chapterMenu: document.querySelector("#chapter-menu"),
    chapterMenuOptions: document.querySelector("#chapter-menu-options"),
    previousChapter: document.querySelector("#previous-chapter"),
    nextChapter: document.querySelector("#next-chapter"),
    search: document.querySelector("#script-search"),
    clearSearch: document.querySelector("#clear-search"),
    chapterTitle: document.querySelector("#chapter-title"),
    chapterProgress: document.querySelector("#chapter-progress"),
    resultStatus: document.querySelector("#result-status"),
    scriptLines: document.querySelector("#script-lines"),
    emptyState: document.querySelector("#empty-state"),
    lineTemplate: document.querySelector("#line-template"),
    endOrderLabel: document.querySelector("#end-order-label"),
    endActions: document.querySelector("#end-actions"),
  };

  const number = new Intl.NumberFormat("en-US");

  function chapterMeta(slug = state.chapter) {
    return state.index.chapters.find((chapter) => chapter.slug === slug);
  }

  function chapterLabel(meta) {
    return meta.label ? `${meta.label}. ${meta.title}` : meta.title;
  }

  function queryTerms() {
    return state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  }

  // The text contains angle brackets as printed, so it is never treated as markup.
  function searchableText(line) {
    return [line.id, line.ko, line.en].filter(Boolean).join("\n").toLocaleLowerCase();
  }

  function matches(line, terms) {
    if (!terms.length) return true;
    const haystack = searchableText(line);
    return terms.every((term) => haystack.includes(term));
  }

  function appendHighlighted(element, text, terms) {
    const value = String(text || "");
    if (!terms.length) {
      element.append(document.createTextNode(value));
      return;
    }
    const escaped = [...new Set(terms)]
      .sort((a, b) => b.length - a.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const expression = new RegExp(`(${escaped.join("|")})`, "giu");
    let cursor = 0;
    for (const match of value.matchAll(expression)) {
      element.append(document.createTextNode(value.slice(cursor, match.index)));
      const mark = document.createElement("mark");
      mark.textContent = match[0];
      element.append(mark);
      cursor = match.index + match[0].length;
    }
    element.append(document.createTextNode(value.slice(cursor)));
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return response.json();
  }

  // The Korean text is not published. A local build writes it to data/source/.
  async function detectKorean() {
    if (window.location.hostname === "jehlp.net") return false;
    try {
      return (await fetch("data/source/index.json")).ok;
    } catch {
      return false;
    }
  }

  function loadChapter(slug) {
    if (!state.cache.has(slug)) {
      const path = (directory) => `data/${directory}/${encodeURIComponent(slug)}.json?v=${encodeURIComponent(state.index.generatedAt)}`;
      const request = Promise.all([
        fetchJson(path("chapters")),
        state.hasKorean ? fetchJson(path("source")) : null,
      ]).then(([chapter, source]) => {
        if (source) chapter.lines.forEach((line, position) => { line.ko = source.ko[position]; });
        return chapter;
      }).catch((error) => {
        // An interrupted request must not poison this chapter until a page reload.
        if (state.cache.get(slug) === request) state.cache.delete(slug);
        throw error;
      });
      state.cache.set(slug, request);
    }
    return state.cache.get(slug);
  }

  function fragmentTarget() {
    if (!window.location.hash) return null;
    try {
      return document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    } catch {
      // A malformed percent escape is an unknown address, not a loading failure.
      return null;
    }
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    const previousChapter = url.searchParams.get("chapter");
    if (previousChapter && previousChapter !== state.chapter) url.hash = "";
    url.searchParams.set("chapter", state.chapter);
    if (state.query) url.searchParams.set("q", state.query);
    else url.searchParams.delete("q");
    if (state.scope !== "chapter") url.searchParams.set("scope", state.scope);
    else url.searchParams.delete("scope");
    if (state.hasKorean && state.mode === "english") url.searchParams.set("mode", "en");
    else url.searchParams.delete("mode");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function saveMode() {
    try {
      localStorage.setItem(MODE_KEY, state.mode);
    } catch {
      // A blocked store only means the mode is not remembered.
    }
  }

  function savedMode() {
    try {
      return localStorage.getItem(MODE_KEY);
    } catch {
      return null;
    }
  }

  function updateReadingMode() {
    document.body.classList.toggle("english-reader-mode", state.mode === "english");
    elements.parallelMode.setAttribute("aria-pressed", String(state.mode === "parallel"));
    elements.englishMode.setAttribute("aria-pressed", String(state.mode === "english"));
    elements.viewSwitcher.hidden = !state.hasKorean;
    if (state.hasKorean) saveMode();
  }

  function adjacentChapters() {
    const position = state.index.chapters.findIndex((chapter) => chapter.slug === state.chapter);
    return {
      previous: state.index.chapters[position - 1]?.slug ?? null,
      next: state.index.chapters[position + 1]?.slug ?? null,
    };
  }

  function selectChapter(slug, { scroll = true } = {}) {
    if (!chapterMeta(slug)) return;
    state.chapter = slug;
    closeChapterMenu();
    updateChapterControls();
    updateUrl();
    renderCurrentChapter();
    if (scroll) document.querySelector("#reader-controls").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateEndNavigation() {
    const { next } = adjacentChapters();
    elements.endActions.replaceChildren();
    if (!next) {
      elements.endOrderLabel.textContent = "End of the novel";
      return;
    }
    elements.endOrderLabel.textContent = "Continue reading";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${chapterLabel(chapterMeta(next))} →`;
    button.addEventListener("click", () => selectChapter(next));
    elements.endActions.append(button);
  }

  function updateChapterControls() {
    const meta = chapterMeta();
    const adjacent = adjacentChapters();
    elements.chapterValue.textContent = chapterLabel(meta);
    elements.previousChapter.disabled = !adjacent.previous;
    elements.nextChapter.disabled = !adjacent.next;
    elements.previousChapter.setAttribute(
      "aria-label",
      adjacent.previous ? `Previous: ${chapterLabel(chapterMeta(adjacent.previous))}` : "No previous chapter",
    );
    elements.nextChapter.setAttribute(
      "aria-label",
      adjacent.next ? `Next: ${chapterLabel(chapterMeta(adjacent.next))}` : "No next chapter",
    );
    elements.chapterMenuOptions.querySelectorAll(".chapter-menu-option").forEach((option) => {
      option.setAttribute("aria-selected", String(option.dataset.slug === state.chapter));
    });
    updateEndNavigation();
  }

  function closeChapterMenu({ restoreFocus = false } = {}) {
    elements.chapterMenu.hidden = true;
    elements.chapterButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) elements.chapterButton.focus();
  }

  function openChapterMenu() {
    elements.chapterMenu.hidden = false;
    elements.chapterButton.setAttribute("aria-expanded", "true");
    const selected = elements.chapterMenuOptions.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
    selected?.focus();
  }

  // A long part is split into groups of ten, so the menu stays compact.
  function menuGroups() {
    const groups = [];
    for (const part of state.index.parts) {
      if (part.chapters.length <= MENU_GROUP_SIZE) {
        groups.push({ label: part.label, chapters: part.chapters });
        continue;
      }
      for (let start = 0; start < part.chapters.length; start += MENU_GROUP_SIZE) {
        const chapters = part.chapters.slice(start, start + MENU_GROUP_SIZE);
        const first = chapterMeta(chapters[0]).label;
        const last = chapterMeta(chapters.at(-1)).label;
        groups.push({ label: `${first}–${last}`, chapters });
      }
    }
    return groups;
  }

  function buildChapterMenu() {
    const fragment = document.createDocumentFragment();
    menuGroups().forEach((entry, position) => {
      const group = document.createElement("section");
      group.className = "chapter-menu-group";
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", `chapter-group-${position}`);
      const heading = document.createElement("h3");
      heading.className = "chapter-menu-heading";
      heading.id = `chapter-group-${position}`;
      heading.textContent = entry.label;
      group.append(heading);
      for (const slug of entry.chapters) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "chapter-menu-option";
        option.dataset.slug = slug;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.textContent = chapterLabel(chapterMeta(slug));
        option.addEventListener("click", () => {
          closeChapterMenu({ restoreFocus: true });
          selectChapter(slug);
        });
        group.append(option);
      }
      fragment.append(group);
    });
    elements.chapterMenuOptions.append(fragment);
  }

  function makeNote(note, visibleText, terms) {
    const term = document.createElement("span");
    term.className = "glossary-term";
    const word = document.createElement("span");
    word.className = "glossary-term-link";
    word.tabIndex = 0;
    const noteId = `note-${++state.noteCounter}`;
    word.setAttribute("aria-describedby", noteId);
    appendHighlighted(word, visibleText, terms);

    const popover = document.createElement("span");
    popover.className = "glossary-popover";
    popover.id = noteId;
    popover.setAttribute("role", "note");
    const close = document.createElement("button");
    close.className = "glossary-popover-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close note");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      term.classList.add("is-dismissed");
      close.blur();
      word.blur();
    });
    word.addEventListener("focus", () => term.classList.remove("is-dismissed"));
    const title = document.createElement("strong");
    title.textContent = note.term;
    const description = document.createElement("span");
    description.className = "glossary-popover-description";
    description.textContent = note.note;
    popover.append(close, title, description);
    for (const source of note.sources) {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.label;
      popover.append(link);
    }
    if (note.sourceLabel) {
      const label = document.createElement("span");
      label.className = "note-source";
      label.textContent = note.sourceLabel;
      popover.append(label);
    }
    term.append(word, popover);
    return term;
  }

  function appendEnglish(element, line, terms) {
    const note = line.note && state.index.notes[line.note.term];
    const start = note ? line.en.indexOf(line.note.text) : -1;
    if (start < 0) {
      appendHighlighted(element, line.en, terms);
      return;
    }
    appendHighlighted(element, line.en.slice(0, start), terms);
    element.append(makeNote(note, line.note.text, terms));
    appendHighlighted(element, line.en.slice(start + line.note.text.length), terms);
  }

  function makeLineArticle(line, meta, terms) {
    const article = elements.lineTemplate.content.firstElementChild.cloneNode(true);
    const anchorId = `line-${line.id.replace(":", "-")}`;
    const href = `?chapter=${encodeURIComponent(meta.slug)}#${anchorId}`;
    article.id = anchorId;
    article.dataset.chapter = meta.slug;
    article.classList.toggle("system-line", line.t === "system");
    article.classList.toggle("break-line", line.t === "break");

    const lineNumber = article.querySelector(".line-number");
    lineNumber.href = href;
    lineNumber.textContent = String(line.i);
    lineNumber.setAttribute("aria-label", `Link to paragraph ${line.i}`);

    const korean = article.querySelector(".korean");
    if (line.ko === undefined) korean.remove();
    else appendHighlighted(korean.querySelector(".line-text"), line.ko, terms);

    appendEnglish(article.querySelector(".english .line-text"), line, terms);

    // A search result names its place, because the reader mode has no line numbers.
    if (terms.length) {
      const context = article.querySelector(".line-context");
      context.hidden = false;
      context.href = href;
      context.textContent = `${chapterLabel(meta)} · ${line.i}`;
    }
    return article;
  }

  function makeDivider() {
    const divider = document.createElement("div");
    divider.className = "scene-divider";
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-label", "Scene break");
    return divider;
  }

  async function renderCurrentChapter() {
    const token = ++state.searchToken;
    const meta = chapterMeta();
    const position = state.index.chapters.findIndex((chapter) => chapter.slug === state.chapter) + 1;
    elements.resultStatus.hidden = false;
    elements.resultStatus.textContent = "Loading text…";
    elements.chapterTitle.textContent = chapterLabel(meta);
    elements.chapterProgress.textContent = `Chapter ${position} of ${state.index.chapters.length} · ${number.format(meta.lineCount)} paragraphs`;

    const terms = queryTerms();
    const chapterSlugs = terms.length && state.scope === "all"
      ? state.index.chapters.map((chapter) => chapter.slug)
      : [state.chapter];

    try {
      const chapters = await Promise.all(chapterSlugs.map(loadChapter));
      if (token !== state.searchToken) return;
      const results = [];
      let shownResults = 0;
      let totalMatches = 0;
      for (const chapter of chapters) {
        const chapterInfo = chapterMeta(chapter.slug);
        for (const line of chapter.lines) {
          if (!matches(line, terms)) continue;
          totalMatches += 1;
          if (shownResults < MAX_RESULTS) {
            if (line.div && !terms.length) results.push(makeDivider());
            results.push(makeLineArticle(line, chapterInfo, terms));
            shownResults += 1;
          }
        }
      }
      elements.scriptLines.replaceChildren(...results);
      elements.emptyState.hidden = results.length > 0;
      const searching = terms.length > 0;
      elements.resultStatus.hidden = !searching;
      if (searching) {
        elements.resultStatus.textContent = totalMatches > MAX_RESULTS
          ? `Showing first ${number.format(MAX_RESULTS)} of ${number.format(totalMatches)}`
          : `${number.format(totalMatches)} ${totalMatches === 1 ? "match" : "matches"}`;
      }
      updateChapterControls();
      elements.emptyState.querySelector("h2").textContent = "No matching paragraphs";
      elements.emptyState.querySelector("p").textContent = "Try a broader search or another chapter.";
      const hashTarget = fragmentTarget();
      if (hashTarget) {
        // The browser sets :target before this element exists, so mark it here.
        hashTarget.classList.add("is-target");
        hashTarget.scrollIntoView({ block: "center" });
      }
    } catch (error) {
      if (token !== state.searchToken) return;
      elements.scriptLines.replaceChildren();
      elements.emptyState.hidden = false;
      elements.emptyState.querySelector("h2").textContent = "The text could not be loaded";
      elements.emptyState.querySelector("p").textContent = "Refresh the page to try again.";
      elements.resultStatus.hidden = true;
      console.error(error);
    }
  }

  function updateSearchPlaceholder() {
    elements.search.placeholder = state.scope === "all" ? "Search the whole novel" : "Search this chapter";
  }

  function bindEvents() {
    elements.parallelMode.addEventListener("click", () => {
      state.mode = "parallel";
      updateReadingMode();
      updateUrl();
    });
    elements.englishMode.addEventListener("click", () => {
      state.mode = "english";
      updateReadingMode();
      updateUrl();
    });
    elements.chapterButton.addEventListener("click", () => {
      if (elements.chapterMenu.hidden) openChapterMenu();
      else closeChapterMenu({ restoreFocus: true });
    });
    elements.chapterButton.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key) && elements.chapterMenu.hidden) {
        event.preventDefault();
        openChapterMenu();
      }
    });
    elements.chapterMenuOptions.addEventListener("keydown", (event) => {
      const options = [...elements.chapterMenuOptions.querySelectorAll(".chapter-menu-option")];
      const position = options.indexOf(document.activeElement);
      let target;
      if (["ArrowDown", "ArrowRight"].includes(event.key)) target = options[(position + 1) % options.length];
      else if (["ArrowUp", "ArrowLeft"].includes(event.key)) target = options[(position - 1 + options.length) % options.length];
      else if (event.key === "Home") target = options[0];
      else if (event.key === "End") target = options.at(-1);
      if (target) {
        event.preventDefault();
        target.focus();
      }
    });
    elements.chapterPicker.addEventListener("focusout", (event) => {
      if (!elements.chapterPicker.contains(event.relatedTarget)) closeChapterMenu();
    });
    elements.previousChapter.addEventListener("click", () => {
      const slug = adjacentChapters().previous;
      if (slug) selectChapter(slug);
    });
    elements.nextChapter.addEventListener("click", () => {
      const slug = adjacentChapters().next;
      if (slug) selectChapter(slug);
    });
    document.querySelectorAll('input[name="search-scope"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        state.scope = event.target.value;
        updateSearchPlaceholder();
        updateUrl();
        renderCurrentChapter();
      });
    });
    let searchTimer;
    elements.search.addEventListener("input", () => {
      state.query = elements.search.value;
      elements.clearSearch.hidden = !state.query;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        updateUrl();
        renderCurrentChapter();
      }, 180);
    });
    elements.clearSearch.addEventListener("click", () => {
      state.query = "";
      elements.search.value = "";
      elements.clearSearch.hidden = true;
      updateUrl();
      renderCurrentChapter();
      elements.search.focus();
    });
    document.addEventListener("click", (event) => {
      if (!elements.chapterPicker.contains(event.target)) closeChapterMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.chapterMenu.hidden) closeChapterMenu({ restoreFocus: true });
    });
  }

  async function initialize() {
    const params = new URLSearchParams(window.location.search);
    elements.search.value = params.get("q") || "";
    try {
      [state.index, state.hasKorean] = await Promise.all([fetchJson("data/index.json"), detectKorean()]);
      const requested = params.get("chapter");
      state.chapter = chapterMeta(requested) ? requested : state.index.chapters[0].slug;
      state.query = elements.search.value;
      state.scope = ["chapter", "all"].includes(params.get("scope")) ? params.get("scope") : "chapter";
      state.mode = state.hasKorean && params.get("mode") !== "en" && (params.has("mode") || savedMode() !== "english") ? "parallel" : "english";

      elements.chapterCount.textContent = number.format(state.index.chapterCount);
      elements.lineCount.textContent = number.format(state.index.lineCount);
      elements.updatedAt.textContent = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(state.index.generatedAt));
      elements.search.value = state.query;
      elements.clearSearch.hidden = !state.query;
      document.querySelector(`input[name="search-scope"][value="${state.scope}"]`).checked = true;

      buildChapterMenu();
      updateChapterControls();
      updateSearchPlaceholder();
      updateReadingMode();
      bindEvents();
      updateUrl();
      await renderCurrentChapter();
    } catch (error) {
      elements.chapterTitle.textContent = "Reader unavailable";
      elements.chapterProgress.textContent = "The translation index could not be loaded.";
      elements.resultStatus.hidden = true;
      console.error(error);
    }
  }

  initialize();
})();

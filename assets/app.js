const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  repos: [],
  filtered: [],
  visible: 60,
  view: localStorage.getItem("stars:view") || "grid",
  saved: new Set(JSON.parse(localStorage.getItem("stars:saved") || "[]")),
  collections: JSON.parse(localStorage.getItem("stars:collections") || "{}"),
};

const els = {
  search: $("#searchInput"),
  sort: $("#sortSelect"),
  language: $("#languageFilter"),
  topic: $("#topicFilter"),
  owner: $("#ownerFilter"),
  updated: $("#updatedFilter"),
  activeOnly: $("#activeOnly"),
  homepageOnly: $("#homepageOnly"),
  savedOnly: $("#savedOnly"),
  collection: $("#collectionFilter"),
  grid: $("#repoGrid"),
  empty: $("#emptyState"),
  loadMore: $("#loadMore"),
  resultMeta: $("#resultMeta"),
  resultTitle: $("#resultTitle"),
  summary: $("#summaryStats"),
  recent: $("#recentStars"),
  topics: $("#topTopics"),
  languages: $("#topLanguages"),
  filters: $("#filters"),
  activeFilters: $("#activeFilters"),
};

const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const dayMs = 86400000;
const dateValue = (v) => v ? new Date(v).getTime() || 0 : 0;
const activityDate = (repo) => repo.pushed_at || repo.updated_at || null;

function relativeTime(value) {
  const ts = dateValue(value);
  if (!ts) return "Not yet updated";
  const diff = Date.now() - ts;
  if (diff < 60000) return "Updated just now";
  const units = [
    ["year", 365 * dayMs],
    ["month", 30 * dayMs],
    ["day", dayMs],
    ["hour", 3600000],
    ["minute", 60000],
  ];
  for (const [name, ms] of units) {
    if (diff >= ms) {
      const n = Math.max(1, Math.floor(diff / ms));
      return "Updated " + n + " " + name + (n === 1 ? "" : "s") + " ago";
    }
  }
  return "Updated just now";
}

function queryState() {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get("q") || "",
    language: p.get("language") || "",
    topic: p.get("topic") || "",
    owner: p.get("owner") || "",
    updated: p.get("updated") || "",
    active: p.get("active") === "1",
    homepage: p.get("homepage") === "1",
    saved: p.get("saved") === "1",
    collection: p.get("collection") || "",
    sort: ({ "updated-desc": "active-desc", "updated-asc": "active-asc" }[p.get("sort")] || p.get("sort") || "starred-desc"),
  };
}

function syncControlsFromUrl() {
  const q = queryState();
  els.search.value = q.q;
  els.language.value = q.language;
  els.topic.value = q.topic;
  els.owner.value = q.owner;
  els.updated.value = q.updated;
  els.activeOnly.checked = q.active;
  els.homepageOnly.checked = q.homepage;
  els.savedOnly.checked = q.saved;
  els.collection.value = q.collection;
  els.sort.value = q.sort;
}

function setParam(key, value) {
  const p = new URLSearchParams(location.search);
  if (value === "" || value === false || value == null) p.delete(key);
  else p.set(key, value === true ? "1" : value);
  history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p.toString() : ""));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b));
}

function optionize(select, values, allLabel) {
  const selected = select.value;
  select.innerHTML = '<option value="">' + allLabel + '</option>' +
    values.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join("");
  select.value = selected;
}

function enrich(repo) {
  const full = repo.full_name || [repo.owner?.login || repo.owner, repo.name].filter(Boolean).join("/");
  const owner = typeof repo.owner === "string" ? repo.owner : (repo.owner?.login || full.split("/")[0] || "");
  return {
    ...repo,
    full_name: full,
    owner,
    html_url: repo.html_url || repo.url || ("https://github.com/" + full),
    avatar_url: repo.avatar_url || repo.owner?.avatar_url || ("https://github.com/" + owner + ".png?size=80"),
    topics: repo.topics || [],
    stargazers_count: repo.stargazers_count ?? repo.stars ?? 0,
    forks_count: repo.forks_count ?? repo.forks ?? 0,
    starred_at: repo.starred_at || repo.created_at || null,
    updated_at: repo.updated_at || null,
    pushed_at: repo.pushed_at || null,
    created_at: repo.created_at || null,
    open_issues_count: repo.open_issues_count ?? 0,
    watchers_count: repo.watchers_count ?? 0,
    default_branch: repo.default_branch || "",
    visibility: repo.visibility || "public",
    fork: Boolean(repo.fork),
    disabled: Boolean(repo.disabled),
    license: repo.license || null,
    archived: Boolean(repo.archived),
    homepage: repo.homepage || "",
    language: repo.language || "Unknown",
  };
}

function buildDashboard() {
  const repos = state.repos;
  const archived = repos.filter(r => r.archived).length;
  const owners = new Set(repos.map(r => r.owner)).size;
  els.summary.innerHTML = [
    '<span><strong>' + repos.length.toLocaleString() + '</strong> repositories</span>',
    '<span><strong>' + uniqueSorted(repos.map(r => r.language)).length + '</strong> languages</span>',
    '<span><strong>' + owners.toLocaleString() + '</strong> owners</span>',
    archived ? '<span><strong>' + archived.toLocaleString() + '</strong> archived</span>' : ''
  ].join("");

  const recent = [...repos].sort((a,b)=>dateValue(b.starred_at)-dateValue(a.starred_at)).slice(0,6);
  els.recent.innerHTML = recent.map(r =>
    '<a class="mini-repo" href="' + esc(r.html_url) + '" target="_blank" rel="noopener">' +
      '<strong>' + esc(r.name) + '</strong><span>' + esc(r.owner) + ' · ' + esc(r.language) + '</span></a>'
  ).join("") || '<p class="muted">Data will appear after the first sync.</p>';

  const topicCounts = new Map();
  repos.forEach(r => r.topics.forEach(t => topicCounts.set(t, (topicCounts.get(t)||0)+1)));
  const topTopics = [...topicCounts].sort((a,b)=>b[1]-a[1]).slice(0,8);
  els.topics.innerHTML = topTopics.map(([name,count]) =>
    '<button class="rank-item" data-topic="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + count + '</span></button>'
  ).join("") || '<p class="muted">No topics yet.</p>';

  const langCounts = new Map();
  repos.forEach(r => langCounts.set(r.language, (langCounts.get(r.language)||0)+1));
  const topLangs = [...langCounts].sort((a,b)=>b[1]-a[1]).slice(0,8);
  els.languages.innerHTML = topLangs.map(([name,count]) =>
    '<button class="rank-item" data-language="' + esc(name) + '"><span>' + esc(name) + '</span><span>' + count + '</span></button>'
  ).join("");

  optionize(els.language, uniqueSorted(repos.map(r => r.language)), "All languages");
  optionize(els.topic, uniqueSorted(repos.flatMap(r => r.topics)), "All topics");
  optionize(els.owner, uniqueSorted(repos.map(r => r.owner)), "All owners");
  refreshCollections();
  syncControlsFromUrl();
}

function refreshCollections() {
  const selected = els.collection.value;
  const names = uniqueSorted(Object.keys(state.collections));
  els.collection.innerHTML = '<option value="">All collections</option>' +
    names.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join("");
  els.collection.value = selected;
}

function repoMatchesCollection(repo, name) {
  if (!name) return true;
  return (state.collections[name] || []).includes(repo.full_name);
}

function applyFilters(resetVisible = true) {
  if (resetVisible) state.visible = 60;
  const q = els.search.value.trim().toLowerCase();
  const lang = els.language.value;
  const topic = els.topic.value;
  const owner = els.owner.value;
  const days = Number(els.updated.value || 0);
  const minUpdated = days ? Date.now() - days * dayMs : 0;
  const collection = els.collection.value;

  let rows = state.repos.filter(r => {
    const hay = [r.name, r.full_name, r.owner, r.description, r.language, ...(r.topics||[])].join(" ").toLowerCase();
    return (!q || hay.includes(q))
      && (!lang || r.language === lang)
      && (!topic || r.topics.includes(topic))
      && (!owner || r.owner === owner)
      && (!days || dateValue(activityDate(r)) >= minUpdated)
      && (!els.activeOnly.checked || !r.archived)
      && (!els.homepageOnly.checked || Boolean(r.homepage))
      && (!els.savedOnly.checked || state.saved.has(r.full_name))
      && repoMatchesCollection(r, collection);
  });

  const sort = els.sort.value;
  const sorters = {
    "starred-desc": (a,b)=>dateValue(b.starred_at)-dateValue(a.starred_at),
    "starred-asc": (a,b)=>dateValue(a.starred_at)-dateValue(b.starred_at),
    "active-desc": (a,b)=>dateValue(activityDate(b))-dateValue(activityDate(a)),
    "active-asc": (a,b)=>dateValue(activityDate(a))-dateValue(activityDate(b)),
    "updated-desc": (a,b)=>dateValue(b.updated_at)-dateValue(a.updated_at),
    "updated-asc": (a,b)=>dateValue(a.updated_at)-dateValue(b.updated_at),
    "stars-desc": (a,b)=>b.stargazers_count-a.stargazers_count,
    "stars-asc": (a,b)=>a.stargazers_count-b.stargazers_count,
    "name-asc": (a,b)=>a.full_name.localeCompare(b.full_name),
    "name-desc": (a,b)=>b.full_name.localeCompare(a.full_name),
  };
  rows.sort(sorters[sort] || sorters["starred-desc"]);
  state.filtered = rows;

  setParam("q", els.search.value.trim());
  setParam("language", lang);
  setParam("topic", topic);
  setParam("owner", owner);
  setParam("updated", els.updated.value);
  setParam("active", els.activeOnly.checked);
  setParam("homepage", els.homepageOnly.checked);
  setParam("saved", els.savedOnly.checked);
  setParam("collection", collection);
  setParam("sort", sort === "starred-desc" ? "" : sort);

  render();
}

function cardFor(repo) {
  const node = $("#repoCardTemplate").content.firstElementChild.cloneNode(true);
  node.dataset.repo = repo.full_name;
  node.querySelector(".owner-avatar").src = repo.avatar_url;
  node.querySelector(".owner-avatar").alt = repo.owner;
  node.querySelector(".repo-owner").textContent = repo.owner;
  node.querySelector(".repo-name").textContent = repo.name;
  node.querySelector(".repo-description").textContent = repo.description || "No description provided.";
  const topics = node.querySelector(".repo-topics");
  (repo.topics || []).slice(0,5).forEach(t => {
    const b = document.createElement("button");
    b.className = "topic-chip";
    b.textContent = t;
    b.dataset.topic = t;
    topics.appendChild(b);
  });

  const meta = [
    '<span><span class="language-dot"></span>' + esc(repo.language) + '</span>',
    '<span>★ ' + fmt.format(repo.stargazers_count) + '</span>',
    '<span>⑂ ' + fmt.format(repo.forks_count) + '</span>',
    activityDate(repo) ? '<span title="' + esc(new Date(activityDate(repo)).toLocaleString()) + '">' + esc(relativeTime(activityDate(repo))) + '</span>' : '<span>Not yet updated</span>',
    repo.starred_at ? '<span title="' + esc(new Date(repo.starred_at).toLocaleString()) + '">Starred ' + new Date(repo.starred_at).toLocaleDateString() + '</span>' : '',
    repo.archived ? '<span class="archived-badge">Archived</span>' : ''
  ].join("");
  node.querySelector(".repo-meta").innerHTML = meta;

  const hp = node.querySelector(".homepage-link");
  if (repo.homepage) hp.href = repo.homepage; else hp.hidden = true;
  node.querySelector(".github-link").href = repo.html_url;

  const save = node.querySelector(".save-button");
  if (state.saved.has(repo.full_name)) {
    save.classList.add("saved");
    save.textContent = "★";
  }

  const menu = node.querySelector(".collection-menu");
  renderCollectionMenu(menu, repo);

  save.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.saved.has(repo.full_name)) state.saved.delete(repo.full_name);
    else state.saved.add(repo.full_name);
    localStorage.setItem("stars:saved", JSON.stringify([...state.saved]));
    save.classList.toggle("saved", state.saved.has(repo.full_name));
    save.textContent = state.saved.has(repo.full_name) ? "★" : "☆";
    menu.hidden = !menu.hidden;
    if (els.savedOnly.checked) applyFilters(false);
  });

  topics.addEventListener("click", e => {
    const t = e.target.dataset.topic;
    if (!t) return;
    els.topic.value = t;
    applyFilters();
    window.scrollTo({top: document.querySelector(".library").offsetTop - 10, behavior:"smooth"});
  });
  return node;
}

function renderCollectionMenu(menu, repo) {
  const names = uniqueSorted(Object.keys(state.collections));
  menu.innerHTML = names.length ? names.map(name => {
    const has = (state.collections[name] || []).includes(repo.full_name);
    return '<button type="button" data-collection="' + esc(name) + '">' + (has ? "✓ " : "") + esc(name) + '</button>';
  }).join("") : '<button type="button" data-new="1">+ Create collection</button>';

  menu.onclick = e => {
    e.stopPropagation();
    if (e.target.dataset.new) return createCollection(repo.full_name);
    const name = e.target.dataset.collection;
    if (!name) return;
    const set = new Set(state.collections[name] || []);
    set.has(repo.full_name) ? set.delete(repo.full_name) : set.add(repo.full_name);
    state.collections[name] = [...set];
    persistCollections();
    renderCollectionMenu(menu, repo);
  };
}

function persistCollections() {
  localStorage.setItem("stars:collections", JSON.stringify(state.collections));
  refreshCollections();
}

function createCollection(repoName = null) {
  const name = prompt("Collection name");
  if (!name || !name.trim()) return;
  const clean = name.trim();
  if (!state.collections[clean]) state.collections[clean] = [];
  if (repoName && !state.collections[clean].includes(repoName)) state.collections[clean].push(repoName);
  persistCollections();
}

function renderActiveFilters() {
  const pairs = [
    ["language", els.language.value],
    ["topic", els.topic.value],
    ["owner", els.owner.value],
    ["updated", els.updated.value ? "active " + els.updated.value + "d" : ""],
    ["active", els.activeOnly.checked ? "active only" : ""],
    ["homepage", els.homepageOnly.checked ? "has homepage" : ""],
    ["saved", els.savedOnly.checked ? "saved locally" : ""],
    ["collection", els.collection.value]
  ].filter(([,v]) => v);

  els.activeFilters.innerHTML = pairs.map(([k,v]) =>
    '<button class="filter-chip" data-clear="' + k + '">' + esc(v) + ' ×</button>'
  ).join("");
}

function render() {
  const rows = state.filtered.slice(0, state.visible);
  els.grid.replaceChildren(...rows.map(cardFor));
  els.grid.classList.toggle("list-view", state.view === "list");
  $("#gridView").classList.toggle("active", state.view === "grid");
  $("#listView").classList.toggle("active", state.view === "list");

  els.resultMeta.textContent = state.filtered.length.toLocaleString() + " of " + state.repos.length.toLocaleString() + " repositories";
  els.empty.hidden = state.filtered.length !== 0;
  els.loadMore.hidden = state.visible >= state.filtered.length;
  renderActiveFilters();
}

async function loadData() {
  try {
    const res = await fetch("./data/stars.json", {cache:"no-store"});
    if (!res.ok) throw new Error("Could not load stars.json");
    const payload = await res.json();
    const repos = Array.isArray(payload) ? payload : (payload.repositories || []);
    state.repos = repos.map(enrich);
  } catch (err) {
    console.error(err);
    state.repos = [];
  }
  buildDashboard();
  applyFilters(false);
}

function clearFilters() {
  els.search.value = "";
  els.language.value = "";
  els.topic.value = "";
  els.owner.value = "";
  els.updated.value = "";
  els.activeOnly.checked = false;
  els.homepageOnly.checked = false;
  els.savedOnly.checked = false;
  els.collection.value = "";
  els.sort.value = "starred-desc";
  history.replaceState(null, "", location.pathname);
  applyFilters();
}

[els.search, els.language, els.topic, els.owner, els.updated, els.activeOnly, els.homepageOnly, els.savedOnly, els.collection, els.sort]
  .forEach(el => el.addEventListener(el === els.search ? "input" : "change", () => applyFilters()));

$("#clearFilters").addEventListener("click", clearFilters);
$("#emptyClear").addEventListener("click", clearFilters);
$("#loadMore").addEventListener("click", () => { state.visible += 60; render(); });
$("#filterToggle").addEventListener("click", () => els.filters.classList.toggle("open"));
$("#newCollection").addEventListener("click", () => createCollection());
$("#gridView").addEventListener("click", () => { state.view="grid"; localStorage.setItem("stars:view","grid"); render(); });
$("#listView").addEventListener("click", () => { state.view="list"; localStorage.setItem("stars:view","list"); render(); });

els.activeFilters.addEventListener("click", e => {
  const key = e.target.dataset.clear;
  const map = {language:els.language, topic:els.topic, owner:els.owner, updated:els.updated, collection:els.collection};
  if (map[key]) map[key].value="";
  if (key==="active") els.activeOnly.checked=false;
  if (key==="homepage") els.homepageOnly.checked=false;
  if (key==="saved") els.savedOnly.checked=false;
  applyFilters();
});

document.addEventListener("click", e => {
  if (e.target.matches("[data-topic]") && e.target.closest("#topTopics")) {
    els.topic.value = e.target.dataset.topic;
    applyFilters();
  }
  if (e.target.matches("[data-language]") && e.target.closest("#topLanguages")) {
    els.language.value = e.target.dataset.language;
    applyFilters();
  }
  if (!e.target.closest(".collection-menu") && !e.target.closest(".save-button")) {
    $$(".collection-menu").forEach(m => m.hidden = true);
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "/" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    els.search.focus();
  }
});

const savedTheme = localStorage.getItem("stars:theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";

$("#themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("stars:theme", next);
});

loadData();

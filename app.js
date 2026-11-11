/**
 * WatchVault — Firebase SDK v9 modular, without a build step.
 * Paste your Firebase Web App config in firebase-config.js.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { findPosterByTitle, findPosterMatchByTitle } from "./poster-lookup.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  grid: $("#cardsGrid"),
  open: $("#openModal"),
  modal: $("#addDialog"),
  close: $("#closeModal"),
  cancel: $("#cancelModal"),
  form: $("#addForm"),
  submit: $("#submitAdd"),
  search: $("#searchInput"),
  posterSync: $("#posterSyncStatus"),
  total: $("#totalCount"),
  categoryCounts: {
    all: $("#allCategoryCount"),
    anime: $("#animeCategoryCount"),
    series: $("#seriesCategoryCount"),
    unsorted: $("#unsortedCategoryCount")
  },
  watched: $("#watchedCount"),
  unwatched: $("#unwatchedCount"),
  result: $("#resultCount"),
  setup: $("#setupBanner"),
  status: $("#connectionBadge"),
  statusText: $("#connectionText"),
  toast: $("#toast")
};

let db;
let shows = [];
let currentFilter = "all";
let currentCategory = "all";
let currentSearch = "";
let toastTimer;
// Prevent repeated lookups on every Firebase onValue event.
const attemptedPosters = new Set();
const lookingUpPosters = new Set();
let backfillRunning = false;

function setStatus(message, mode = "") {
  elements.status.className = "connection" + (mode ? " " + mode : "");
  elements.statusText.textContent = message;
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = "toast visible" + (isError ? " error" : "");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 4000);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const node = el("i", name);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function httpsUrl(input) {
  try {
    const url = new URL(String(input).trim());
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function emptyMessage(iconClass, title, description) {
  const box = el("div", "empty-state");
  box.append(
    icon(iconClass),
    el("h3", "", title),
    el("p", "", description)
  );
  elements.grid.replaceChildren(box);
}

function updateStats() {
  const watched = shows.filter((show) => show.watched).length;
  elements.total.textContent = String(shows.length);
  elements.watched.textContent = String(watched);
  elements.unwatched.textContent = String(shows.length - watched);
  for (const category of ["all", "anime", "series", "unsorted"]) {
    const count = category === "all" ? shows.length :
      shows.filter((show) => show.category === category).length;
    elements.categoryCounts[category].textContent = String(count);
  }
}

function render() {
  updateStats();
  const filtered = shows.filter((show) => {
    const byStatus = currentFilter === "all" ||
      (currentFilter === "watched" && show.watched) ||
      (currentFilter === "unwatched" && !show.watched);
    const byName = show.title.toLocaleLowerCase("he").includes(currentSearch);
    const byCategory = currentCategory === "all" || show.category === currentCategory;
    return byStatus && byName && byCategory;
  });
  elements.result.textContent = filtered.length + " כותרים";

  if (!shows.length) {
    emptyMessage("fa-regular fa-folder-open", "הספרייה עדיין ריקה", "לחצו על ״הוסף חדש״ כדי להכניס את הסדרה הראשונה.");
    return;
  }
  if (!filtered.length) {
    emptyMessage("fa-solid fa-magnifying-glass", "לא מצאנו התאמות", "נסו חיפוש אחר או החליפו את מסנן הצפייה.");
    return;
  }
  const fragment = document.createDocumentFragment();
  filtered.forEach((show) => fragment.append(createCard(show)));
  elements.grid.replaceChildren(fragment);
}

async function patchShow(showId, patch) {
  try {
    await update(ref(db, "shows/" + showId), patch);
  } catch (error) {
    console.error("Failed to update show:", error);
    toast("לא הצלחנו לשמור את השינוי. בדקו חיבור והרשאות.", true);
  }
}

async function deleteShow(show) {
  if (!window.confirm("למחוק את ״" + show.title + "״ מהספרייה המשותפת?")) return;
  try {
    await remove(ref(db, "shows/" + show.id));
    toast("הכותר הוסר מהספרייה.");
  } catch (error) {
    console.error("Failed to delete show:", error);
    toast("המחיקה נכשלה. בדקו חיבור והרשאות.", true);
  }
}

function createCard(show) {
  const card = el("article", "card");
  const poster = el("div", "poster");
  const placeholder = el("div", "poster-placeholder");
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.append(icon("fa-solid fa-clapperboard"), el("span", "", "WatchVault"));
  poster.append(placeholder);
  const imageUrl = httpsUrl(show.posterUrl);
  if (imageUrl) {
    const image = el("img");
    image.src = imageUrl;
    image.alt = "פוסטר: " + show.title;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.classList.add("is-broken"));
    poster.append(image);
  }

  if (!imageUrl) {
    const retry = el("button", "poster-retry");
    retry.type = "button";
    retry.disabled = lookingUpPosters.has(show.id);
    retry.append(icon("fa-solid fa-image"), document.createTextNode(
      retry.disabled ? "מחפש תמונה..." : "חפש פוסטר"
    ));
    retry.setAttribute("aria-label", "חפש פוסטר אוטומטי עבור " + show.title);
    retry.addEventListener("click", () => {
      attemptedPosters.add(show.id);
      void fillMissingPoster(show, true);
    });
    poster.append(retry);
  }

  const badge = el("span", "poster-badge" + (show.watched ? " watched" : ""),
    show.watched ? "✓ צפיתי" : "עוד לא צפיתי");
  poster.append(badge, el("h3", "poster-title", show.title));

  const body = el("div", "card-body");
  const categoryRow = el("div", "category-row");
  categoryRow.append(el("span", "mini-label", "סוג תוכן"));
  const categorySelect = el("select", "category-select");
  categorySelect.setAttribute("aria-label", "סוג התוכן של " + show.title);
  for (const [value, label] of [
    ["unsorted", "לא סווג"],
    ["anime", "אנימה"],
    ["series", "סדרה"]
  ]) {
    const option = el("option", "", label);
    option.value = value;
    categorySelect.append(option);
  }
  categorySelect.value = show.category;
  categorySelect.addEventListener("change", () =>
    patchShow(show.id, { category: categorySelect.value })
  );
  categoryRow.append(categorySelect);
  const ratingRow = el("div", "rating-row");
  ratingRow.append(el("span", "mini-label", "הדירוג שלנו"));
  const stars = el("div", "stars");
  stars.setAttribute("role", "group");
  stars.setAttribute("aria-label", "דירוג " + show.title);
  for (let value = 1; value <= 5; value += 1) {
    const star = el("button", "star" + (value <= show.rating ? " selected" : ""));
    star.type = "button";
    star.setAttribute("aria-label", "דרג " + value + " מתוך 5 כוכבים");
    star.setAttribute("aria-pressed", String(value === show.rating));
    star.title = value + " מתוך 5";
    star.append(icon("fa-solid fa-star"));
    star.addEventListener("click", () => patchShow(show.id, { rating: value }));
    stars.append(star);
  }
  ratingRow.append(stars);

  const actions = el("div", "card-actions");
  const toggle = el("button", "watch-toggle");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-label", "סטטוס צפייה של " + show.title);
  toggle.setAttribute("aria-checked", String(show.watched));
  toggle.append(el("span", "toggle-track"), el("span", "", show.watched ? "צפיתי" : "לא צפיתי"));
  toggle.addEventListener("click", () => patchShow(show.id, { watched: !show.watched }));

  const buttons = el("div", "card-buttons");
  const watchUrl = httpsUrl(show.watchUrl);
  // Display Play only when the series has a valid watch link.
  if (watchUrl) {
    const play = el("a", "play-link");
    play.href = watchUrl;
    play.target = "_blank";
    play.rel = "noopener noreferrer nofollow";
    play.title = "לצפייה ב" + show.title;
    play.setAttribute("aria-label", "צפה ב" + show.title + " בחלון חדש");
    play.append(icon("fa-solid fa-play"));
    buttons.append(play);
  }

  const deleteButton = el("button", "icon-button delete");
  deleteButton.type = "button";
  deleteButton.title = "מחיקה";
  deleteButton.setAttribute("aria-label", "מחק את " + show.title);
  deleteButton.append(icon("fa-regular fa-trash-can"));
  deleteButton.addEventListener("click", () => deleteShow(show));

  buttons.append(deleteButton);
  actions.append(toggle, buttons);
  body.append(categoryRow, ratingRow, actions);
  card.append(poster, body);
  return card;
}

function openModal() {
  if (elements.open.disabled) return;
  elements.form.reset();
  elements.modal.showModal();
  $("#titleInput").focus();
}

function closeModal() {
  if (!elements.submit.disabled) elements.modal.close();
}

elements.open.addEventListener("click", openModal);
elements.close.addEventListener("click", closeModal);
elements.cancel.addEventListener("click", closeModal);
elements.modal.addEventListener("click", (event) => {
  if (event.target === elements.modal) closeModal();
});
elements.modal.addEventListener("cancel", (event) => {
  if (elements.submit.disabled) event.preventDefault();
});

elements.search.addEventListener("input", (event) => {
  currentSearch = event.target.value.trim().toLocaleLowerCase("he");
  render();
});

document.querySelectorAll("[data-category]").forEach((button) => {
  button.addEventListener("click", () => {
    currentCategory = button.dataset.category;
    document.querySelectorAll("[data-category]").forEach((target) => {
      const active = target === button;
      target.classList.toggle("active", active);
      target.setAttribute("aria-pressed", String(active));
    });
    render();
  });
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((target) => {
      const isActive = target === button;
      target.classList.toggle("active", isActive);
      target.setAttribute("aria-pressed", String(isActive));
    });
    render();
  });
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db || !elements.form.reportValidity()) return;

  const title = $("#titleInput").value.trim();
  const category = $("#categoryInput").value;
  const rawPosterUrl = $("#posterInput").value.trim();
  const posterUrl = rawPosterUrl ? httpsUrl(rawPosterUrl) : null;
  const rawWatchUrl = $("#watchInput").value.trim();
  const watchUrl = rawWatchUrl ? httpsUrl(rawWatchUrl) : null;
  if (!title || title.length > 100 || !["anime", "series"].includes(category) ||
      (rawPosterUrl && (!posterUrl || posterUrl.length > 2048)) ||
      (rawWatchUrl && (!watchUrl || watchUrl.length > 2048))) {
    toast("יש להזין שם וקישורי HTTPS תקינים אם הוזנו.", true);
    return;
  }

  elements.submit.disabled = true;
  try {
    // Manual URL always wins; search only when the poster field is blank.
    let autoPosterUrl = null;
    if (!posterUrl) {
      elements.submit.textContent = "מחפש פוסטר אוטומטית...";
      autoPosterUrl = await findPosterByTitle(title, category);
    }
    elements.submit.textContent = "שומר בספרייה...";
    const newShow = push(ref(db, "shows"));
    await set(newShow, {
      title,
      category,
      ...((posterUrl || autoPosterUrl) ? { posterUrl: posterUrl || autoPosterUrl } : {}),
      ...(watchUrl ? { watchUrl } : {}),
      rating: 0,
      watched: false,
      createdAt: serverTimestamp()
    });
    elements.modal.close();
    elements.form.reset();
    toast(autoPosterUrl ? "הסדרה נוספה עם פוסטר שנמצא אוטומטית!" :
      (!posterUrl ? "הסדרה נוספה. לא נמצאה תמונה מתאימה, ולכן מוצג עיצוב חלופי." :
      "הסדרה נוספה לכולם בהצלחה!"));
  } catch (error) {
    console.error("Failed to add show:", error);
    toast("לא הצלחנו להוסיף את הסדרה. בדקו הרשאות וחיבור.", true);
  } finally {
    elements.submit.disabled = false;
    elements.submit.replaceChildren(icon("fa-solid fa-plus"), document.createTextNode(" הוסף לספרייה"));
  }
});

/**
 * Runs when the site is open: old entries without posters get a best-effort
 * lookup. Failed lookups remain placeholders; the user may retry manually.
 * A transaction avoids overwriting another visitor's changes.
 */
async function fillMissingPoster(show, notify = false) {
  if (lookingUpPosters.has(show.id)) return;
  lookingUpPosters.add(show.id);
  if (notify) render();
  try {
    const found = await findPosterMatchByTitle(show.title, show.category);
    if (!found) {
      if (notify) toast("לא נמצא פוסטר עם התאמה טובה. אפשר לנסות שוב מאוחר יותר.");
      return;
    }
    const result = await runTransaction(ref(db, "shows/" + show.id), (current) => {
      if (!current || httpsUrl(current.posterUrl)) return; // Keep manually set posters.
      const update = { ...current, posterUrl: found.posterUrl };
      if ((!current.category || current.category === "unsorted") && found.category) {
        update.category = found.category;
      }
      return update;
    }, { applyLocally: false });
    if (notify) toast(result.committed ?
      "נמצאה תמונה ונשמרה בספרייה!" :
      "כבר עודכנה תמונה לסדרה הזאת.");
  } catch (error) {
    console.warn("Poster lookup/update failed for", show.title, error);
    if (notify) toast("חיפוש הפוסטר נכשל. אפשר לנסות שוב.", true);
  } finally {
    lookingUpPosters.delete(show.id);
    if (notify) render();
  }
}

async function backfillMissingPosters() {
  if (backfillRunning) return;
  backfillRunning = true;
  let attempted = 0;
  try {
    while (true) {
      const pending = shows.filter((show) =>
        !httpsUrl(show.posterUrl) &&
        !attemptedPosters.has(show.id) &&
        !lookingUpPosters.has(show.id)
      );
      if (!pending.length) break;
      elements.posterSync.hidden = false;
      elements.posterSync.textContent = "מחפש פוסטרים לכותרות ישנות... (" +
        (attempted + 1) + " מתוך " + (attempted + pending.length) + ")";
      const next = pending[0];
      attemptedPosters.add(next.id);
      await fillMissingPoster(next);
      attempted += 1;
      // Be considerate of external services' request rates.
      await new Promise((resolve) => setTimeout(resolve, 850));
    }
  } finally {
    elements.posterSync.hidden = true;
    backfillRunning = false;
  }
}

function loadShows() {
  onValue(
    ref(db, "shows"),
    (snapshot) => {
      const data = snapshot.val() || {};
      shows = Object.entries(data)
        .filter((entry) => entry[1] && typeof entry[1].title === "string")
        .map(([id, value]) => ({
          id,
          title: value.title,
          posterUrl: value.posterUrl || "",
          watchUrl: value.watchUrl || "",
          category: ["anime", "series"].includes(value.category) ? value.category : "unsorted",
          watched: value.watched === true,
          rating: Number.isInteger(value.rating) && value.rating >= 0 && value.rating <= 5 ? value.rating : 0,
          createdAt: Number(value.createdAt) || 0
        }))
        .sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title, "he"));
      render();
      // Only try automatically for records missing posters, including older ones.
      // A successful lookup is written to Firebase for everyone.
      void backfillMissingPosters();
    },
    (error) => {
      console.error("Realtime listener failed:", error);
      setStatus("שגיאת הרשאות", "error");
      emptyMessage("fa-solid fa-triangle-exclamation", "לא ניתן לטעון את הספרייה", "בדקו את כללי Realtime Database ואת כתובת מסד הנתונים.");
      toast("לא ניתן לקרוא את מסד הנתונים.", true);
    }
  );
}

async function start() {
  const ready = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("PASTE_") &&
    firebaseConfig.databaseURL && !firebaseConfig.databaseURL.includes("PASTE_") &&
    firebaseConfig.projectId && !firebaseConfig.projectId.includes("PASTE_") &&
    firebaseConfig.appId && !firebaseConfig.appId.includes("PASTE_");

  if (!ready) {
    elements.setup.hidden = false;
    setStatus("נדרש חיבור", "error");
    emptyMessage("fa-solid fa-wand-magic-sparkles", "כמעט מוכנים להתחיל", "חברו את Firebase לפי ההוראות בקובץ README.md.");
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    const auth = getAuth(app);

    onValue(ref(db, ".info/connected"), (snapshot) => {
      setStatus(snapshot.val() === true ? "מחובר בזמן אמת" : "ממתין לרשת",
        snapshot.val() === true ? "online" : "");
    });

    await signInAnonymously(auth);
    elements.open.disabled = false;
    loadShows();
  } catch (error) {
    console.error("Firebase initialization/sign-in failed:", error);
    setStatus("שגיאת התחברות", "error");
    emptyMessage("fa-solid fa-triangle-exclamation", "לא הצלחנו להתחבר", "בדקו Firebase Config, הפעלת Anonymous Authentication והרשאות הפרויקט.");
    toast("חיבור Firebase נכשל. פרטים נוספים בקונסול הדפדפן.", true);
  }
}

start();

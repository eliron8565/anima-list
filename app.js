/**
 * WatchVault — Firebase SDK v9 modular, without a build step.
 * Paste your Firebase Web App config in firebase-config.js.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, set, update, remove, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";
import { findPosterMatchByTitle } from "./poster-lookup.js?v=auto-category-2";

const $ = (selector) => document.querySelector(selector);
const elements = {
  grid: $("#cardsGrid"),
  open: $("#openModal"),
  accountButton: $("#accountButton"),
  accountName: $("#accountName"),
  accountDialog: $("#accountDialog"),
  closeAccount: $("#closeAccount"),
  accountDescription: $("#accountDescription"),
  profileName: $("#profileName"),
  profileMode: $("#profileMode"),
  googleLogin: $("#googleLogin"),
  renameProfile: $("#renameProfile"),
  importOldWatched: $("#importOldWatched"),
  logoutAccount: $("#logoutAccount"),
  modal: $("#addDialog"),
  close: $("#closeModal"),
  cancel: $("#cancelModal"),
  form: $("#addForm"),
  submit: $("#submitAdd"),
  dialogTitle: $("#dialogTitle"),
  dialogDescription: $("#dialogDescription"),
  categoryInput: $("#categoryInput"),
  unsortedOption: $("#unsortedOption"),
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
let auth;
let viewerUser = null;
let profileName = "אורח";
let personalProgress = {};
let stopProgressListening = null;
let stopProfileListening = null;
let showsListening = false;
let loginPending = false;
let shows = [];
let currentFilter = "all";
let currentCategory = "all";
let currentSearch = "";
let toastTimer;
let editingId = null;
// Run catalog enrichment for older entries once per browser session,
// avoiding repeated API requests for every Firebase onValue event.
const attemptedMetadata = new Set();
const lookingUpMetadata = new Set();
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

function hasWatched(show) {
  return personalProgress[show.id]?.watched === true;
}

function accountDisplayName(user) {
  if (!user || user.isAnonymous) return "אורח";
  return (user.displayName || "משתמש Google").trim().slice(0, 40);
}

function showAccountDetails() {
  const googleAccount = !!viewerUser && !viewerUser.isAnonymous;
  const name = profileName || "אורח";
  elements.accountName.textContent = name;
  elements.profileName.textContent = name;
  elements.profileMode.textContent = googleAccount ?
    "מחובר עם Google · מעקב אישי מסונכרן" :
    "מצב אורח · המעקב נשמר רק בדפדפן הזה";
  elements.accountDescription.textContent = googleAccount ?
    "הסדרות שחברים מוסיפים משותפות לכולם. מה שצפית בו נשמר רק בחשבון שלך." :
    "לשמירת רשימת הצפייה בטלפון ובמחשב, התחבר עם Google.";
  elements.googleLogin.hidden = googleAccount;
  elements.logoutAccount.hidden = !googleAccount;
  elements.accountButton.disabled = !viewerUser;
  elements.renameProfile.disabled = !viewerUser;
  elements.importOldWatched.disabled = !viewerUser;
}

function listenToUserData(user) {
  if (stopProgressListening) stopProgressListening();
  if (stopProfileListening) stopProfileListening();
  viewerUser = user;
  personalProgress = {};
  profileName = accountDisplayName(user);
  render();
  showAccountDetails();
  if (!user) return;

  const ownUid = user.uid;
  stopProgressListening = onValue(ref(db, "userProgress/" + ownUid), (snapshot) => {
    if (viewerUser?.uid !== ownUid) return;
    personalProgress = snapshot.val() || {};
    render();
  }, (error) => {
    console.error("Cannot load personal watched progress:", error);
    toast("אין הרשאה לקרוא את סימוני הצפייה האישיים. עדכן את כללי Firebase.", true);
  });

  stopProfileListening = onValue(ref(db, "profiles/" + ownUid), (snapshot) => {
    if (viewerUser?.uid !== ownUid) return;
    const stored = snapshot.val()?.name;
    profileName = typeof stored === "string" && stored.trim() ?
      stored.trim().slice(0, 40) : accountDisplayName(user);
    showAccountDetails();
  }, (error) => console.warn("Could not load profile:", error));
}

async function setPersonalWatched(showId, watched) {
  if (!viewerUser) {
    toast("צריך להתחבר לפני ששומרים מעקב צפייה.", true);
    return;
  }
  try {
    await set(ref(db, "userProgress/" + viewerUser.uid + "/" + showId), {
      watched: watched === true,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Saving personal progress failed:", error);
    toast("לא הצלחנו לשמור את הסימון האישי. ודא שעדכנת את כללי Firebase.", true);
  }
}

async function logInWithGoogle() {
  if (!auth || loginPending) return;
  loginPending = true;
  elements.googleLogin.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
    elements.accountDialog.close();
    toast("התחברת בהצלחה! מעכשיו הסימונים שלך יסתנכרנו בין המכשירים.");
  } catch (error) {
    console.error("Google login failed:", error);
    const code = error?.code || "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      return;
    }
    if (code === "auth/operation-not-allowed") {
      toast("צריך להפעיל Google ב-Firebase Authentication → Sign-in method.", true);
    } else if (code === "auth/unauthorized-domain") {
      toast("צריך לאשר את eliron8565.github.io ב-Firebase Authentication → Settings.", true);
    } else if (code === "auth/popup-blocked") {
      toast("הדפדפן חסם את חלון Google. אפשר חלונות קופצים לאתר או נסה Chrome.", true);
    } else {
      toast("ההתחברות נכשלה. בדוק ש-Google מופעל ב-Firebase ונסה שוב.", true);
    }
  } finally {
    loginPending = false;
    elements.googleLogin.disabled = false;
  }
}

async function renameMyProfile() {
  if (!viewerUser) return;
  const requested = window.prompt("איך לקרוא לך באתר? לדוגמה: אלירון", profileName);
  if (requested === null) return;
  const name = requested.trim();
  if (!name || name.length > 40) {
    toast("השם חייב להכיל בין 1 ל־40 תווים.", true);
    return;
  }
  try {
    await set(ref(db, "profiles/" + viewerUser.uid), { name });
    toast("שם התצוגה עודכן ל־" + name);
  } catch (error) {
    console.error("Rename failed:", error);
    toast("שמירת השם נכשלה. בדוק את כללי Firebase.", true);
  }
}

async function importOldWatched() {
  if (!viewerUser) return;
  const oldWatched = shows.filter((show) =>
    show.legacyWatched && !hasWatched(show)
  );
  if (!oldWatched.length) {
    toast("לא נמצאו סימוני צפייה ישנים שצריך לייבא.");
    return;
  }
  if (!window.confirm("לייבא " + oldWatched.length +
    " סימוני ״צפיתי״ שהיו משותפים לכולם לתוך החשבון האישי שלך?")) return;
  elements.importOldWatched.disabled = true;
  try {
    const uid = viewerUser.uid;
    const work = oldWatched.map((show) =>
      set(ref(db, "userProgress/" + uid + "/" + show.id), {
        watched: true,
        updatedAt: serverTimestamp()
      })
    );
    const results = await Promise.allSettled(work);
    const successes = results.filter((result) => result.status === "fulfilled").length;
    toast("יובאו " + successes + " סימוני צפייה לחשבון שלך.");
    if (successes < results.length) {
      toast("חלק מהסימונים לא נשמרו. בדוק את כללי Firebase.", true);
    }
  } finally {
    elements.importOldWatched.disabled = false;
  }
}

function updateStats() {
  const watched = shows.filter(hasWatched).length;
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
      (currentFilter === "watched" && hasWatched(show)) ||
      (currentFilter === "unwatched" && !hasWatched(show));
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
    return true;
  } catch (error) {
    console.error("Failed to update show:", error);
    toast("לא הצלחנו לשמור את השינוי. בדקו חיבור והרשאות.", true);
    return false;
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
    retry.disabled = lookingUpMetadata.has(show.id);
    retry.append(icon("fa-solid fa-image"), document.createTextNode(
      retry.disabled ? "מחפש..." : "חפש פוסטר"
    ));
    retry.setAttribute("aria-label", "חפש פוסטר אוטומטי עבור " + show.title);
    retry.addEventListener("click", () => {
      attemptedMetadata.add(show.id);
      void enrichShow(show, true);
    });
    poster.append(retry);
  }

  const badge = el("span", "poster-badge" + (hasWatched(show) ? " watched" : ""),
    hasWatched(show) ? "✓ צפיתי" : "עוד לא צפיתי");
  const titleElement = el("h3", "poster-title", show.title);
  titleElement.setAttribute("dir", "auto");
  poster.append(badge, titleElement);

  const body = el("div", "card-body");
  const mobileTitle = el("h3", "mobile-card-title", show.title);
  mobileTitle.setAttribute("dir", "auto");
  body.append(mobileTitle);
  const categoryRow = el("div", "category-row");
  categoryRow.append(el("span", "mini-label", "סוג תוכן"));
  const categorySelect = el("select", "category-select");
  categorySelect.setAttribute("aria-label", "סוג התוכן של " + show.title);
  for (const [value, label] of [
    ["unsorted", "לא סווג"],
    ["anime", "אנימה"],
    ["series", "סדרה רגילה"],
    ["auto", "✨ זהה אוטומטית"]
  ]) {
    const option = el("option", "", label);
    option.value = value;
    categorySelect.append(option);
  }
  categorySelect.value = show.category;
  categorySelect.addEventListener("change", async () => {
    const selected = categorySelect.value;
    categorySelect.disabled = true;
    try {
      if (selected === "auto") {
        const match = await findPosterMatchByTitle(show.title, "unsorted");
        if (!match?.category) {
          toast("לא נמצאה התאמה בטוחה. אפשר לבחור אנימה או סדרה ידנית.");
          return;
        }
        const saved = await patchShow(show.id, {
          category: match.category,
          metadataChecked: true
        });
        if (saved) toast("זוהה אוטומטית: " +
          (match.category === "anime" ? "אנימה" : "סדרה רגילה"));
      } else {
        await patchShow(show.id, { category: selected, metadataChecked: false });
      }
    } catch (error) {
      console.warn("Category detection failed:", error);
      toast("הזיהוי האוטומטי לא זמין כרגע. אפשר לבחור ידנית.", true);
    } finally {
      categorySelect.disabled = false;
      // onValue renders the new selection after Firebase confirms the update.
      categorySelect.value = shows.find((item) => item.id === show.id)?.category || show.category;
    }
  });
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
  toggle.setAttribute("aria-checked", String(hasWatched(show)));
  const watchLabel = el("span", "watch-text");
  watchLabel.append(
    icon(hasWatched(show) ? "fa-solid fa-circle-check" : "fa-regular fa-circle"),
    document.createTextNode(hasWatched(show) ? "צפיתי" : "לא צפיתי")
  );
  toggle.append(watchLabel, el("span", "toggle-track"));
  toggle.addEventListener("click", () => void setPersonalWatched(show.id, !hasWatched(show)));

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

  const editButton = el("button", "icon-button edit");
  editButton.type = "button";
  editButton.title = "עריכת פרטי הסדרה";
  editButton.setAttribute("aria-label", "ערוך את " + show.title);
  editButton.append(icon("fa-solid fa-pen"));
  editButton.addEventListener("click", () => openEditModal(show));

  const deleteButton = el("button", "icon-button delete");
  deleteButton.type = "button";
  deleteButton.title = "מחיקה";
  deleteButton.setAttribute("aria-label", "מחק את " + show.title);
  deleteButton.append(icon("fa-regular fa-trash-can"));
  deleteButton.addEventListener("click", () => deleteShow(show));

  buttons.append(editButton, deleteButton);
  actions.append(toggle, buttons);
  body.append(categoryRow, ratingRow);
  card.append(poster, body, actions);
  return card;
}

function setSubmitLabel(label, iconClass = "fa-solid fa-plus") {
  elements.submit.replaceChildren(icon(iconClass), document.createTextNode(" " + label));
}

function openModal() {
  if (elements.open.disabled) return;
  editingId = null;
  elements.form.reset();
  elements.unsortedOption.hidden = true;
  elements.dialogTitle.textContent = "מוסיפים לספרייה";
  elements.dialogDescription.textContent = "עוד סיפור מצוין להצטרף לאוסף שלנו.";
  setSubmitLabel("הוסף לספרייה");
  elements.modal.showModal();
  $("#titleInput").focus();
}

function openEditModal(show) {
  if (elements.open.disabled) return;
  editingId = show.id;
  elements.form.reset();
  elements.unsortedOption.hidden = false;
  $("#titleInput").value = show.title;
  elements.categoryInput.value = show.category;
  $("#posterInput").value = show.posterUrl;
  $("#watchInput").value = show.watchUrl;
  elements.dialogTitle.textContent = "עריכת פרטי הסדרה";
  elements.dialogDescription.textContent = "אפשר לשנות שם, קטגוריה, תמונה וקישור לצפייה.";
  setSubmitLabel("שמור שינויים", "fa-solid fa-check");
  elements.modal.showModal();
  $("#titleInput").focus();
}

function closeModal() {
  if (!elements.submit.disabled) elements.modal.close();
}

elements.accountButton.addEventListener("click", () => {
  if (viewerUser) elements.accountDialog.showModal();
});
elements.closeAccount.addEventListener("click", () => elements.accountDialog.close());
elements.accountDialog.addEventListener("click", (event) => {
  if (event.target === elements.accountDialog) elements.accountDialog.close();
});
elements.googleLogin.addEventListener("click", () => void logInWithGoogle());
elements.renameProfile.addEventListener("click", () => void renameMyProfile());
elements.importOldWatched.addEventListener("click", () => void importOldWatched());
elements.logoutAccount.addEventListener("click", async () => {
  if (!auth) return;
  try {
    await signOut(auth);
    elements.accountDialog.close();
    toast("התנתקת. חזרת למצב אורח.");
  } catch (error) {
    console.error("Sign-out failed:", error);
    toast("ההתנתקות לא הצליחה.", true);
  }
});

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
  const requestedCategory = elements.categoryInput.value;
  const rawPosterUrl = $("#posterInput").value.trim();
  const posterUrl = rawPosterUrl ? httpsUrl(rawPosterUrl) : null;
  const rawWatchUrl = $("#watchInput").value.trim();
  const watchUrl = rawWatchUrl ? httpsUrl(rawWatchUrl) : null;
  const saveId = editingId;
  if (!title || title.length > 100 ||
      !(saveId ? ["anime", "series", "unsorted", "auto"] : ["anime", "series", "auto"]).includes(requestedCategory) ||
      (rawPosterUrl && (!posterUrl || posterUrl.length > 2048)) ||
      (rawWatchUrl && (!watchUrl || watchUrl.length > 2048))) {
    toast("יש להזין שם וסוג תוכן, וקישורי HTTPS תקינים אם הוזנו.", true);
    return;
  }

  elements.submit.disabled = true;
  let success = false;
  try {
    if (saveId) {
      // Auto mode asks both catalogs; a doubtful result does not erase the
      // existing category of an item somebody already categorized.
      const detected = requestedCategory === "auto" ?
        await findPosterMatchByTitle(title, "unsorted") : null;
      setSubmitLabel("שומר שינויים...", "fa-solid fa-circle-notch fa-spin");
      // A transaction preserves rating, watched and other changes made by
      // another visitor while this person edits the form.
      const result = await runTransaction(ref(db, "shows/" + saveId), (current) => {
        if (!current) return;
        const finalCategory = requestedCategory === "auto" ?
          (detected?.category || current.category || "unsorted") : requestedCategory;
        const titleChanged = current.title !== title;
        const categoryChanged = (current.category || "unsorted") !== finalCategory;
        const posterChanged = (current.posterUrl || "") !== (posterUrl || "");
        const next = { ...current, title, category: finalCategory };
        if (posterUrl) next.posterUrl = posterUrl;
        else delete next.posterUrl;
        if (watchUrl) next.watchUrl = watchUrl;
        else delete next.watchUrl;
        if (titleChanged) next.titleLocked = true; // Respect manual names.
        if (titleChanged || categoryChanged || posterChanged) {
          delete next.metadataChecked; // Recheck if catalog data may have changed.
        }
        return next;
      }, { applyLocally: false });
      if (!result.committed) throw new Error("הכותר כבר לא קיים");
      toast(requestedCategory === "auto" && !detected?.category ?
        "השינויים נשמרו. הזיהוי לא היה חד-משמעי, ולכן הסיווג הקודם נשאר." :
        "השינויים נשמרו בהצלחה!");
    } else {
      setSubmitLabel("מזהה סוג תוכן ומחפש פוסטר...", "fa-solid fa-circle-notch fa-spin");
      // A manual image URL wins; catalog matching may still normalize the name.
      const match = await findPosterMatchByTitle(
        title, requestedCategory === "auto" ? "unsorted" : requestedCategory
      );
      const category = requestedCategory === "auto" ?
        (match?.category || "unsorted") : requestedCategory;
      const officialTitle = match?.officialTitle || title;
      setSubmitLabel("שומר בספרייה...", "fa-solid fa-circle-notch fa-spin");
      const newShow = push(ref(db, "shows"));
      attemptedMetadata.add(newShow.key);
      await set(newShow, {
        title: officialTitle,
        category,
        ...((posterUrl || match?.posterUrl) ? { posterUrl: posterUrl || match.posterUrl } : {}),
        ...(watchUrl ? { watchUrl } : {}),
        ...(match ? { metadataChecked: true } : {}),
        rating: 0,
        watched: false,
        createdAt: serverTimestamp()
      });
      toast(requestedCategory === "auto" && category === "unsorted" ?
        "הסדרה נשמרה ב'לא סווגו'. לא נמצאה התאמה בטוחה; אפשר לשנות ידנית." :
        match?.officialTitle && match.officialTitle !== title ?
        "נוסף עם השם הרשמי: " + match.officialTitle :
        "הסדרה נוספה כ" + (category === "anime" ? "אנימה" : "סדרה") + " בהצלחה!");
    }
    success = true;
    elements.modal.close();
    elements.form.reset();
    editingId = null;
  } catch (error) {
    console.error("Failed to save show:", error);
    toast("לא הצלחנו לשמור. בדקו חיבור והרשאות Firebase.", true);
  } finally {
    elements.submit.disabled = false;
    setSubmitLabel(success || !editingId ? "הוסף לספרייה" : "שמור שינויים",
      success || !editingId ? "fa-solid fa-plus" : "fa-solid fa-check");
  }
});

/**
 * Existing shows are enriched on the first visit after an upgrade.
 * Confident matches can update both their official title and missing poster.
 * Transactions preserve user edits and changes made by other visitors.
 */
async function enrichShow(show, notify = false) {
  if (lookingUpMetadata.has(show.id)) return;
  lookingUpMetadata.add(show.id);
  if (notify) render();
  try {
    const found = await findPosterMatchByTitle(show.title, show.category);
    if (!found) {
      if (notify) toast("לא מצאנו התאמה בטוחה במאגרי הסדרות. אפשר לערוך ידנית.");
      return;
    }
    const result = await runTransaction(ref(db, "shows/" + show.id), (current) => {
      if (!current || current.title !== show.title ||
          (current.category || "unsorted") !== show.category) return;
      const next = { ...current };
      let changed = false;
      if (!httpsUrl(current.posterUrl) && found.posterUrl) {
        next.posterUrl = found.posterUrl;
        changed = true;
      }
      if (!current.titleLocked && found.officialTitle &&
          found.officialTitle !== current.title) {
        next.title = found.officialTitle;
        changed = true;
      }
      if ((!current.category || current.category === "unsorted") && found.category) {
        next.category = found.category;
        changed = true;
      }
      if (current.metadataChecked !== true) {
        next.metadataChecked = true;
        changed = true;
      }
      return changed ? next : undefined;
    }, { applyLocally: false });
    if (notify) toast(result.committed ? "הפרטים עודכנו לפי המאגר!" :
      "לא היה צורך לשנות את הפרטים.");
  } catch (error) {
    console.warn("Catalog update failed for", show.title, error);
    if (notify) toast("לא הצלחנו לחפש כרגע. אפשר לנסות שוב.", true);
  } finally {
    lookingUpMetadata.delete(show.id);
    if (notify) render();
  }
}

async function backfillMetadata() {
  if (backfillRunning) return;
  backfillRunning = true;
  let attempted = 0;
  try {
    while (true) {
      const pending = shows.filter((show) =>
        (!show.metadataChecked || show.category === "unsorted") &&
        !attemptedMetadata.has(show.id) &&
        !lookingUpMetadata.has(show.id)
      );
      if (!pending.length) break;
      elements.posterSync.hidden = false;
      elements.posterSync.textContent = "בודק שמות רשמיים ותמונות לכותרות הישנות... (" +
        (attempted + 1) + " מתוך " + (attempted + pending.length) + ")";
      const next = pending[0];
      attemptedMetadata.add(next.id);
      await enrichShow(next);
      attempted += 1;
      // Keep public APIs responsive for other users.
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
          metadataChecked: value.metadataChecked === true,
          titleLocked: value.titleLocked === true,
          legacyWatched: value.watched === true,
          rating: Number.isInteger(value.rating) && value.rating >= 0 && value.rating <= 5 ? value.rating : 0,
          createdAt: Number(value.createdAt) || 0
        }))
        .sort((a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title, "he"));
      render();
      // Backfill official catalog names and missing posters for older entries.
      void backfillMetadata();
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
    auth = getAuth(app);

    onValue(ref(db, ".info/connected"), (snapshot) => {
      setStatus(snapshot.val() === true ? "מחובר בזמן אמת" : "ממתין לרשת",
        snapshot.val() === true ? "online" : "");
    });

    onAuthStateChanged(auth, (user) => {
      listenToUserData(user);
      if (!user) {
        elements.open.disabled = true;
        // Guests can still add recommendations and use this browser's progress.
        if (!loginPending) {
          signInAnonymously(auth).catch((error) => {
            console.error("Anonymous sign-in failed:", error);
            setStatus("שגיאת התחברות", "error");
            toast("צריך להפעיל Anonymous Authentication ב-Firebase.", true);
          });
        }
        return;
      }
      elements.open.disabled = false;
      if (!showsListening) {
        showsListening = true;
        loadShows();
      }
    }, (error) => {
      console.error("Auth state unavailable:", error);
      setStatus("שגיאת התחברות", "error");
      toast("Firebase Authentication אינו זמין.", true);
    });
  } catch (error) {
    console.error("Firebase initialization/sign-in failed:", error);
    setStatus("שגיאת התחברות", "error");
    emptyMessage("fa-solid fa-triangle-exclamation", "לא הצלחנו להתחבר", "בדקו Firebase Config, הפעלת Anonymous Authentication והרשאות הפרויקט.");
    toast("חיבור Firebase נכשל. פרטים נוספים בקונסול הדפדפן.", true);
  }
}

start();

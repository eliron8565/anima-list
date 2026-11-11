/**
 * WatchVault: best-effort poster lookup without API keys.
 * Searches AniList (anime) and TVmaze (TV series).
 * Saves a poster only for a confident title match.
 */
function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleScore(input, candidate) {
  const query = normalizeTitle(input);
  const name = normalizeTitle(candidate);
  if (!query || !name) return 0;
  if (query === name) return 100;
  // Allow a modest subtitle difference (e.g. "Demon Slayer: Kimetsu no Yaiba").
  if (query.length >= 8 && name.startsWith(query + " ") &&
      name.length <= query.length * 1.7) return 84;
  if (name.length >= 8 && query.startsWith(name + " ") &&
      query.length <= name.length * 1.25) return 81;
  return 0;
}

function validImage(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function bestMatch(title, candidates) {
  const matches = candidates
    .filter((x) => x.officialTitle)
    .map((x) => ({
      score: Math.max(0, ...x.names.map((name) => titleScore(title, name))),
      image: x.image,
      officialTitle: x.officialTitle
    }))
    .filter((x) => x.score >= 81)
    .sort((a, b) => b.score - a.score);
  if (!matches.length) return null;
  // Catalogs sometimes contain different shows with identical names:
  // don't silently pick a poster for an ambiguous result.
  if (matches[1] && matches[0].score === matches[1].score &&
      matches[0].officialTitle !== matches[1].officialTitle) return null;
  return matches[0];
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(options.headers || {}) }
    });
    if (!response.ok) throw new Error("Poster service returned HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function searchAniList(title) {
  const query = `query ($search: String!) {
    Page(page: 1, perPage: 12) {
      media(search: $search, type: ANIME, isAdult: false) {
        title { english romaji native }
        synonyms
        coverImage { extraLarge large }
      }
    }
  }`;
  const payload = await requestJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { search: title } })
  });
  const candidates = (payload?.data?.Page?.media || []).map((item) => ({
    names: [item.title?.english, item.title?.romaji, item.title?.native, ...(item.synonyms || [])],
    officialTitle: item.title?.english || item.title?.romaji || item.title?.native || "",
    image: validImage(item.coverImage?.extraLarge || item.coverImage?.large)
  }));
  const result = bestMatch(title, candidates);
  return result ? { ...result, category: "anime" } : null;
}

async function searchTvMaze(title) {
  const results = await requestJson("https://api.tvmaze.com/search/shows?q=" +
    encodeURIComponent(title));
  if (!Array.isArray(results)) return null;
  const candidates = results.map((entry) => ({
    names: [entry.show?.name],
    officialTitle: entry.show?.name || "",
    image: validImage(entry.show?.image?.original || entry.show?.image?.medium)
  }));
  const result = bestMatch(title, candidates);
  return result ? { ...result, category: "series" } : null;
}

/**
 * Lookup a poster, optionally limiting to an explicitly selected category.
 * Unclassified legacy entries search both catalogs. We only suggest an
 * automatic category if one provider is a clear winner.
 */
export async function findPosterMatchByTitle(title, category = "unsorted") {
  if (normalizeTitle(title).length < 2) return null;
  const requests = category === "anime" ? [searchAniList(title)] :
    category === "series" ? [searchTvMaze(title)] :
    [searchAniList(title), searchTvMaze(title)];
  const attempts = await Promise.allSettled(requests);
  const matches = attempts
    .filter((attempt) => attempt.status === "fulfilled" && attempt.value)
    .map((attempt) => attempt.value)
    .sort((a, b) => b.score - a.score);
  if (!matches.length) return null;
  const [winner, second] = matches;
  // No automatic rename for an ambiguous cross-catalog match.
  if (second && winner.score - second.score < 5) return null;
  const officialTitle = String(winner.officialTitle || "").trim();
  return {
    posterUrl: winner.image || null,
    officialTitle: officialTitle.length <= 100 ? officialTitle : null,
    category: winner.category
  };
}

export async function findPosterByTitle(title, category = "unsorted") {
  const match = await findPosterMatchByTitle(title, category);
  return match?.posterUrl || null;
}

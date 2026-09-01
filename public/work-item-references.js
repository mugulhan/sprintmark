const KEY_SOURCE = "[A-Z][A-Z0-9]{1,7}-(?:\\d{4}[A-Z]?|BL-\\d{3})";

export const WORK_ITEM_KEY_PATTERN = new RegExp(`\\b(${KEY_SOURCE})\\b`, "gi");

export function workItemReferenceHref(key) {
  return `/work-items/${String(key).toUpperCase()}`;
}

export function workItemKeyFromHref(href, origin = "http://localhost") {
  try {
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin) return null;
    const match = url.pathname.match(
      new RegExp(`^/work-items/(${KEY_SOURCE})(?:/|$)`, "i"),
    );
    return match?.[1]?.toUpperCase() || null;
  } catch {
    return null;
  }
}

export function matchWorkItemCommand(text) {
  const match = String(text).match(
    /(?:^|\s)(\/(?:iş|work)(?:\s+([^\n]*))?)$/iu,
  );
  if (!match) return null;
  return {
    command: match[1],
    query: (match[2] || "").trim(),
  };
}

function searchable(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function searchWorkItemReferences(
  items,
  projects,
  query,
  { excludeKey = null, limit = 8 } = {},
) {
  const needle = searchable(query);
  const projectNames = new Map(
    projects.map((project) => [project.key, project.name]),
  );
  return items
    .filter((item) => item.key !== excludeKey)
    .map((item) => {
      const projectName =
        projectNames.get(item.project_key) || item.project_key;
      const key = searchable(item.key);
      const title = searchable(item.title);
      const project = searchable(projectName);
      const matches =
        !needle ||
        key.includes(needle) ||
        title.includes(needle) ||
        project.includes(needle);
      const score = !needle
        ? 3
        : key === needle
          ? 0
          : key.startsWith(needle)
            ? 1
            : title.startsWith(needle)
              ? 2
              : 3;
      return { item, matches, score };
    })
    .filter((entry) => entry.matches)
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.item.key.localeCompare(right.item.key, "en"),
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}

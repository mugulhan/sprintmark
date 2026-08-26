import { createHash, randomUUID } from "node:crypto";

export const WORK_ITEM_KEY_SOURCE =
  "[A-Z][A-Z0-9]{1,7}-(?:\\d{4}[A-Z]?|BL-\\d{3})";
export const KEY_PATTERN = new RegExp(`^${WORK_ITEM_KEY_SOURCE}$`);
export const PROJECT_REFERENCE_PATTERN = /^PRJ-\d{3}$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const STATUSES = new Set([
  "open",
  "done",
  "triage",
  "software",
  "waiting",
]);
export const TEAMS = new Set(["content-technical", "web-development"]);
export const KINDS = new Set(["task", "backlog"]);
export const PRIORITIES = new Set(["critical", "high", "medium", "low"]);

const turkishMap = new Map([
  ["ç", "c"],
  ["Ç", "c"],
  ["ğ", "g"],
  ["Ğ", "g"],
  ["ı", "i"],
  ["İ", "i"],
  ["ö", "o"],
  ["Ö", "o"],
  ["ş", "s"],
  ["Ş", "s"],
  ["ü", "u"],
  ["Ü", "u"],
]);

export function slugify(value) {
  const slug = String(value)
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => turkishMap.get(char))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[`'’“”\"<>]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || "is-kaydi";
}

export function newUid() {
  return randomUUID();
}

export function contentEtag(raw) {
  return `\"${createHash("sha256").update(raw).digest("hex")}\"`;
}

export function validateRecord(record) {
  const errors = [];
  if (record.schema_version !== 2) errors.push("schema_version must be 2");
  if (!UUID_PATTERN.test(record.uid || "")) errors.push("uid must be a UUID");
  if (!KEY_PATTERN.test(record.key || "")) errors.push("key is invalid");
  if (!KINDS.has(record.kind)) errors.push("kind is invalid");
  if (!PROJECT_REFERENCE_PATTERN.test(record.project_key || ""))
    errors.push("project_key is invalid");
  if (!String(record.title || "").trim()) errors.push("title is required");
  if (slugify(record.slug) !== record.slug) errors.push("slug is invalid");
  if (!STATUSES.has(record.status)) errors.push("status is invalid");
  if (!TEAMS.has(record.team)) errors.push("team is invalid");
  if (
    record.scheduled_for &&
    !/^\d{4}-\d{2}-\d{2}$/.test(record.scheduled_for)
  ) {
    errors.push("scheduled_for must be an ISO date or null");
  }
  if (
    record.scheduled_time &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(record.scheduled_time)
  ) {
    errors.push("scheduled_time must be HH:mm or null");
  }
  if (record.priority && !PRIORITIES.has(record.priority))
    errors.push("priority is invalid");
  if (
    record.completed_at !== null &&
    record.completed_at !== undefined &&
    (typeof record.completed_at !== "string" ||
      Number.isNaN(Date.parse(record.completed_at)))
  ) {
    errors.push("completed_at must be an ISO timestamp or null");
  }
  if (record.status !== "done" && record.completed_at)
    errors.push("completed_at is only valid for done records");
  if (!Array.isArray(record.legacy_ids))
    errors.push("legacy_ids must be an array");
  if (!Array.isArray(record.legacy_routes))
    errors.push("legacy_routes must be an array");
  if (!Array.isArray(record.attachments))
    errors.push("attachments must be an array");
  return errors;
}

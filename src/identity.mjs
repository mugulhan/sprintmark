import { createHash, randomUUID } from "node:crypto";

export const WORK_ITEM_KEY_SOURCE =
  "[A-Z][A-Z0-9]{1,7}-(?:\\d{4}[A-Z]?|BL-\\d{3})";
export const KEY_PATTERN = new RegExp(`^${WORK_ITEM_KEY_SOURCE}$`);
export const PROJECT_REFERENCE_PATTERN = /^PRJ-\d{3}$/;
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const WORKFLOW_STATUSES = new Set([
  "backlog",
  "planned",
  "in_progress",
  "review",
  "waiting",
  "done",
]);
export const LEGACY_STATUSES = new Set(["open", "triage", "software"]);
export const STATUSES = new Set([...WORKFLOW_STATUSES, ...LEGACY_STATUSES]);
export const KINDS = new Set(["task", "backlog"]);
export const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
export const ACTIVITY_TYPES = new Set([
  "created",
  "changed",
  "comment",
  "assignment",
  "handoff",
  "review",
  "ownership",
  "attachment_added",
  "attachment_removed",
]);
export const ACTIVITY_ACTORS = new Set(["system", "user"]);
export const ACTIVITY_FIELDS = new Set([
  "title",
  "status",
  "team",
  "team_id",
  "assignee_id",
  "reviewer_id",
  "follower_ids",
  "scheduled_for",
  "scheduled_time",
  "priority",
  "page_url",
  "body",
  "project_key",
]);

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
  if (![2, 3, 4].includes(record.schema_version))
    errors.push("schema_version must be 2, 3 or 4");
  if (!UUID_PATTERN.test(record.uid || "")) errors.push("uid must be a UUID");
  if (!KEY_PATTERN.test(record.key || "")) errors.push("key is invalid");
  if (!KINDS.has(record.kind)) errors.push("kind is invalid");
  if (!PROJECT_REFERENCE_PATTERN.test(record.project_key || ""))
    errors.push("project_key is invalid");
  if (!String(record.title || "").trim()) errors.push("title is required");
  if (slugify(record.slug) !== record.slug) errors.push("slug is invalid");
  if (!STATUSES.has(record.status)) errors.push("status is invalid");
  if (record.schema_version === 2 && !String(record.team || "").trim())
    errors.push("team is invalid");
  if (
    record.schema_version >= 3 &&
    record.team_id &&
    !/^team-[0-9a-z-]+$/i.test(record.team_id)
  )
    errors.push("team_id is invalid");
  if (record.schema_version >= 3) {
    if (!/^usr-[0-9a-z-]+$/i.test(record.reporter_id || ""))
      errors.push("reporter_id is invalid");
    for (const field of ["assignee_id", "reviewer_id"]) {
      if (record[field] && !/^usr-[0-9a-z-]+$/i.test(record[field]))
        errors.push(`${field} is invalid`);
    }
    if (!Array.isArray(record.follower_ids))
      errors.push("follower_ids must be an array");
    else if (
      new Set(record.follower_ids).size !== record.follower_ids.length ||
      !record.follower_ids.every((id) => /^usr-[0-9a-z-]+$/i.test(id))
    )
      errors.push("follower_ids is invalid");
  }
  if (record.schema_version === 4) {
    if (!/^usr-[0-9a-z-]+$/i.test(record.creator_id || ""))
      errors.push("creator_id is invalid");
    if (
      record.estimate_minutes !== null &&
      record.estimate_minutes !== undefined &&
      (!Number.isInteger(record.estimate_minutes) ||
        record.estimate_minutes < 1 ||
        record.estimate_minutes > 525600)
    )
      errors.push(
        "estimate_minutes must be an integer between 1 and 525600 or null",
      );
    if (
      record.started_at !== null &&
      record.started_at !== undefined &&
      (typeof record.started_at !== "string" ||
        Number.isNaN(Date.parse(record.started_at)))
    )
      errors.push("started_at must be an ISO timestamp or null");
  }
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
  if (record.activities !== undefined && !Array.isArray(record.activities)) {
    errors.push("activities must be an array");
  } else {
    const activityIds = new Set();
    for (const activity of record.activities || []) {
      if (
        !activity ||
        typeof activity !== "object" ||
        !String(activity.id || "").trim()
      ) {
        errors.push("activity id is required");
        continue;
      }
      if (activityIds.has(activity.id)) errors.push("activity id is duplicate");
      activityIds.add(activity.id);
      if (!ACTIVITY_TYPES.has(activity.type))
        errors.push("activity type is invalid");
      if (record.schema_version === 2) {
        if (!ACTIVITY_ACTORS.has(activity.actor))
          errors.push("activity actor is invalid");
      } else if (
        !activity.actor ||
        typeof activity.actor !== "object" ||
        !["user", "system", "legacy"].includes(activity.actor.type) ||
        !String(activity.actor.id || "").trim() ||
        !String(activity.actor.display_name || "").trim()
      ) {
        errors.push("activity actor is invalid");
      }
      if (
        typeof activity.created_at !== "string" ||
        Number.isNaN(Date.parse(activity.created_at))
      ) {
        errors.push("activity created_at must be an ISO timestamp");
      }
      if (
        activity.type === "comment" &&
        (!String(activity.body || "").trim() ||
          String(activity.body).length > 10000)
      ) {
        errors.push("comment activity body is invalid");
      }
      if (
        ["changed", "assignment", "handoff", "ownership"].includes(
          activity.type,
        ) &&
        (!Array.isArray(activity.changes) || !activity.changes.length)
      ) {
        errors.push(`${activity.type} activity requires changes`);
      } else if (
        ["changed", "assignment", "handoff", "ownership"].includes(
          activity.type,
        )
      ) {
        for (const change of activity.changes) {
          if (!change || !ACTIVITY_FIELDS.has(change.field))
            errors.push("activity change field is invalid");
        }
      }
      if (
        ["attachment_added", "attachment_removed"].includes(activity.type) &&
        (!activity.details ||
          !String(activity.details.name || "").trim() ||
          String(activity.details.name).length > 512)
      ) {
        errors.push("attachment activity details are invalid");
      }
    }
  }
  return errors;
}

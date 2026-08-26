import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { newUid, slugify, validateRecord } from "./identity.mjs";
import { assertRecordSet, loadRecords, saveRecord } from "./records.mjs";
import { generateSummaries } from "./summaries.mjs";

const allowedPatchFields = new Set([
  "title",
  "slug",
  "status",
  "team",
  "scheduled_for",
  "scheduled_time",
  "priority",
  "page_url",
  "body",
  "project_key",
]);

export class WorkItemStore {
  constructor(workspace) {
    this.workspace = workspace;
  }

  async all() {
    const records = await loadRecords(this.workspace);
    assertRecordSet(records);
    return records;
  }

  async byKey(key) {
    return (
      (await this.all()).find(
        (item) => item.key === String(key).toUpperCase(),
      ) || null
    );
  }
  async byUid(uid) {
    return (await this.all()).find((item) => item.uid === uid) || null;
  }

  async create(input, { attachments = [] } = {}) {
    if (attachments.length > 20)
      throw Object.assign(new Error("attachment limit reached"), {
        statusCode: 409,
      });
    const records = await this.all();
    const kind = input.kind === "backlog" ? "backlog" : "task";
    const keyPrefix = String(input.key_prefix || "WORK").toUpperCase();
    const key = input.key || this.nextKey(records, kind, keyPrefix);
    const now = new Date().toISOString();
    const record = {
      schema_version: 2,
      uid: input._uid || newUid(),
      key,
      kind,
      project_key: input.project_key || "PRJ-001",
      title: String(input.title || "").trim(),
      slug: slugify(input.slug || input.title),
      status: input.status || (kind === "backlog" ? "triage" : "open"),
      team: input.team || "content-technical",
      scheduled_for: input.scheduled_for || null,
      scheduled_time: input.scheduled_time || null,
      priority: input.priority || null,
      page_url: input.page_url || null,
      created_at: now,
      updated_at: now,
      legacy_ids: [],
      legacy_routes: [],
      attachments,
    };
    const errors = validateRecord(record);
    if (errors.length)
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 400 });
    if (records.some((item) => item.key === key || item.uid === record.uid)) {
      throw Object.assign(new Error("key or uid already exists"), {
        statusCode: 409,
      });
    }
    const saved = await saveRecord(this.workspace, record, input.body || "");
    await generateSummaries(this.workspace);
    return { ...record, body: input.body || "", _etag: saved.etag };
  }

  nextKey(records, kind, prefix = "WORK") {
    if (kind === "backlog") {
      const max = Math.max(
        0,
        ...records
          .filter((r) => r.key.startsWith(`${prefix}-BL-`))
          .map((r) => Number(r.key.slice(-3))),
      );
      return `${prefix}-BL-${String(max + 1).padStart(3, "0")}`;
    }
    const max = Math.max(
      0,
      ...records
        .filter((r) => r.key.startsWith(`${prefix}-`) && /-\d{4}$/.test(r.key))
        .map((r) => Number(r.key.slice(-4))),
    );
    return `${prefix}-${String(max + 1).padStart(4, "0")}`;
  }

  async patch(uid, input, ifMatch, { attachments = [] } = {}) {
    const existing = await this.byUid(uid);
    if (!existing)
      throw Object.assign(new Error("work item not found"), {
        statusCode: 404,
      });
    if (!ifMatch || ifMatch !== existing._etag)
      throw Object.assign(new Error("record changed; reload before saving"), {
        statusCode: 409,
      });
    if (existing.attachments.length + attachments.length > 20)
      throw Object.assign(new Error("attachment limit reached"), {
        statusCode: 409,
      });
    for (const key of Object.keys(input)) {
      if (!allowedPatchFields.has(key))
        throw Object.assign(new Error(`field cannot be patched: ${key}`), {
          statusCode: 400,
        });
    }
    const next = {
      ...existing,
      ...input,
      attachments: [...existing.attachments, ...attachments],
      updated_at: new Date().toISOString(),
    };
    next.slug = slugify(next.slug || next.title);
    delete next.body;
    delete next._path;
    delete next._etag;
    const errors = validateRecord(next);
    if (errors.length)
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 400 });
    const saved = await saveRecord(
      this.workspace,
      next,
      input.body ?? existing.body,
    );
    await generateSummaries(this.workspace);
    return { ...next, body: input.body ?? existing.body, _etag: saved.etag };
  }

  async addAttachment(uid, file, placement = "evidence") {
    const existing = await this.byUid(uid);
    if (!existing)
      throw Object.assign(new Error("work item not found"), {
        statusCode: 404,
      });
    const allowed = validateImage(file);
    if (existing.attachments.length >= 20)
      throw Object.assign(new Error("attachment limit reached"), {
        statusCode: 409,
      });
    const root = resolve(
      this.workspace,
      "data",
      "work-tracker",
      "attachments",
      uid,
    );
    await mkdir(root, { recursive: true });
    const cleanBase = slugify(
      basename(file.name || "evidence", extname(file.name || "")),
    );
    const name = `${Date.now()}-${newUid().slice(0, 8)}-${cleanBase}${allowed.get(file.type)}`;
    const path = resolve(root, name);
    if (!path.startsWith(`${root}${sep}`))
      throw Object.assign(new Error("unsafe attachment path"), {
        statusCode: 400,
      });
    await writeFile(path, file.data);
    const attachment = {
      name,
      original_name: file.name || name,
      type: file.type,
      size: file.data.length,
      created_at: new Date().toISOString(),
      url: `/attachments/${uid}/${name}`,
      placement: placement === "body" ? "body" : "evidence",
    };
    const next = {
      ...existing,
      attachments: [...existing.attachments, attachment],
      updated_at: new Date().toISOString(),
    };
    delete next.body;
    delete next._path;
    delete next._etag;
    let saved;
    try {
      saved = await saveRecord(this.workspace, next, existing.body);
      await generateSummaries(this.workspace);
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    return {
      attachment,
      record: { ...next, body: existing.body, _etag: saved.etag },
    };
  }

  async attachmentPath(uid, name) {
    if (!/^[0-9a-f-]{36}$/i.test(uid) || basename(name) !== name) return null;
    const root = resolve(
      this.workspace,
      "data",
      "work-tracker",
      "attachments",
      uid,
    );
    const path = resolve(root, name);
    if (!path.startsWith(`${root}${sep}`)) return null;
    try {
      await readFile(path);
      return path;
    } catch {
      return null;
    }
  }
}

export function sniffImageType(data) {
  if (!Buffer.isBuffer(data)) return null;
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  )
    return "image/png";
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))
  )
    return "image/gif";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

export function validateImage(file) {
  const allowed = new Map([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/webp", ".webp"],
    ["image/gif", ".gif"],
  ]);
  if (!file.data?.length || file.data.length > 8 * 1024 * 1024)
    throw Object.assign(new Error("image must be between 1 byte and 8 MB"), {
      statusCode: 413,
    });
  const detected = sniffImageType(file.data);
  if (!allowed.has(file.type) || detected !== file.type)
    throw Object.assign(new Error("unsupported or mismatched image type"), {
      statusCode: 415,
    });
  return allowed;
}

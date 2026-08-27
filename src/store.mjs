import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { newUid, slugify, validateRecord } from "./identity.mjs";
import { assertRecordSet, loadRecords, saveRecord } from "./records.mjs";
import { generateSummaries } from "./summaries.mjs";
import {
  extractWorkspaceReferences,
  validateAttachment,
  workspaceReferenceInfo,
} from "./files.mjs";

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
      completed_at: input.status === "done" ? now : null,
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
    const now = new Date().toISOString();
    const next = {
      ...existing,
      ...input,
      attachments: [...existing.attachments, ...attachments],
      updated_at: now,
    };
    if (existing.status !== "done" && next.status === "done")
      next.completed_at = now;
    if (existing.status === "done" && next.status !== "done")
      next.completed_at = null;
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
    const validated = validateAttachment(file, placement);
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
    const name = `${Date.now()}-${newUid().slice(0, 8)}-${cleanBase}${validated.extension}`;
    const path = resolve(root, name);
    if (!path.startsWith(`${root}${sep}`))
      throw Object.assign(new Error("unsafe attachment path"), {
        statusCode: 400,
      });
    await writeFile(path, file.data);
    const attachment = {
      name,
      original_name: file.name || name,
      type: validated.type,
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

  async removeAttachment(uid, name, ifMatch) {
    const existing = await this.byUid(uid);
    if (!existing)
      throw Object.assign(new Error("work item not found"), {
        statusCode: 404,
      });
    if (!ifMatch || ifMatch !== existing._etag)
      throw Object.assign(new Error("record changed; reload before saving"), {
        statusCode: 409,
      });
    if (basename(name) !== name)
      throw Object.assign(new Error("unsafe attachment path"), {
        statusCode: 400,
      });
    const attachment = existing.attachments.find(
      (entry) => typeof entry !== "string" && entry.name === name,
    );
    if (!attachment)
      throw Object.assign(new Error("attachment not found"), {
        statusCode: 404,
      });
    if (attachment.placement === "body")
      throw Object.assign(
        new Error("body attachment must be removed in editor"),
        {
          statusCode: 409,
        },
      );
    const path = await this.attachmentPath(uid, name);
    const next = {
      ...existing,
      attachments: existing.attachments.filter(
        (entry) => typeof entry === "string" || entry.name !== name,
      ),
      updated_at: new Date().toISOString(),
    };
    delete next.body;
    delete next._path;
    delete next._etag;
    const saved = await saveRecord(this.workspace, next, existing.body);
    await generateSummaries(this.workspace);
    if (path) await rm(path, { force: true });
    return { ...next, body: existing.body, _etag: saved.etag };
  }

  async attachmentPath(uid, name) {
    if (!/^[0-9a-f-]{36}$/i.test(uid) || basename(name) !== name) return null;
    const record = await this.byUid(uid);
    if (
      !record?.attachments.some(
        (entry) => typeof entry !== "string" && entry.name === name,
      )
    )
      return null;
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

  async fileReferences(uid) {
    const record = await this.byUid(uid);
    if (!record)
      throw Object.assign(new Error("work item not found"), {
        statusCode: 404,
      });
    const references = [];
    for (const reference of extractWorkspaceReferences(record)) {
      const info = await workspaceReferenceInfo(this.workspace, reference);
      if (!info) continue;
      const query = `path=${encodeURIComponent(info.path)}`;
      references.push({
        path: info.path,
        name: info.name,
        type: info.type,
        size: info.size,
        exists: info.exists,
        inline: info.inline,
        url: info.exists ? `/work-item-files/${uid}?${query}` : null,
        download_url: info.exists
          ? `/work-item-files/${uid}?${query}&download=1`
          : null,
      });
    }
    return references;
  }

  async workspaceReferencePath(uid, requestedPath) {
    const record = await this.byUid(uid);
    if (!record) return null;
    const authorized = extractWorkspaceReferences(record);
    const info = await workspaceReferenceInfo(this.workspace, requestedPath);
    if (!info || !info.exists || !authorized.includes(info.path)) return null;
    return info;
  }
}

export { validateAttachment, validateImage } from "./files.mjs";

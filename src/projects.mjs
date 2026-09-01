import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import YAML from "yaml";
import { contentEtag, newUid, slugify, UUID_PATTERN } from "./identity.mjs";
import { actorSnapshot, legacyActor, PROJECT_ROLES } from "./collaboration.mjs";
import { atomicWrite } from "./records.mjs";
import {
  normalizeProjectDocumentReference,
  projectDocumentReferenceInfo,
  validateAttachment,
} from "./files.mjs";

export const DEFAULT_PROJECT_KEY = "PRJ-001";
export const PROJECT_KEY_PATTERN = /^PRJ-\d{3}$/;
export const PROJECT_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;
export const PROJECT_STATUSES = new Set(["active", "archived"]);

export function validateProject(project) {
  const errors = [];
  if (![1, 2, 3].includes(project.schema_version))
    errors.push("schema_version must be 1, 2 or 3");
  if (!UUID_PATTERN.test(project.uid || "")) errors.push("uid must be a UUID");
  if (!PROJECT_KEY_PATTERN.test(project.key || ""))
    errors.push("key is invalid");
  if (!PROJECT_CODE_PATTERN.test(project.code || ""))
    errors.push("code is invalid");
  if (!String(project.name || "").trim()) errors.push("name is required");
  if (String(project.name || "").trim().length > 120)
    errors.push("name is too long");
  if (typeof project.description !== "string")
    errors.push("description must be a string");
  if (String(project.description || "").length > 10000)
    errors.push("description is too long");
  if (slugify(project.slug) !== project.slug) errors.push("slug is invalid");
  if (!PROJECT_STATUSES.has(project.status)) errors.push("status is invalid");
  if (!Array.isArray(project.documents))
    errors.push("documents must be an array");
  if (project.schema_version >= 2) {
    if (!/^usr-[0-9a-z-]+$/i.test(project.owner_user_id || ""))
      errors.push("owner_user_id is invalid");
    if (!Array.isArray(project.members))
      errors.push("members must be an array");
    else {
      const memberIds = new Set();
      for (const member of project.members) {
        if (
          !/^usr-[0-9a-z-]+$/i.test(member?.user_id || "") ||
          !PROJECT_ROLES.has(member?.role) ||
          memberIds.has(member?.user_id)
        )
          errors.push("project member is invalid or duplicate");
        memberIds.add(member?.user_id);
      }
    }
    if (
      !Array.isArray(project.team_ids) ||
      !project.team_ids.every((id) => /^team-[0-9a-z-]+$/i.test(id))
    )
      errors.push("team_ids is invalid");
    if (!Array.isArray(project.activities))
      errors.push("activities must be an array");
  }
  if (project.schema_version === 3) {
    if (!/^usr-[0-9a-z-]+$/i.test(project.creator_id || ""))
      errors.push("creator_id is invalid");
    for (const field of ["created_at", "updated_at"]) {
      if (
        typeof project[field] !== "string" ||
        Number.isNaN(Date.parse(project[field]))
      )
        errors.push(`${field} must be an ISO timestamp`);
    }
    if (
      project.archived_at !== null &&
      project.archived_at !== undefined &&
      (typeof project.archived_at !== "string" ||
        Number.isNaN(Date.parse(project.archived_at)))
    )
      errors.push("archived_at must be an ISO timestamp or null");
    if (project.status === "active" && project.archived_at)
      errors.push("archived_at is only valid for archived projects");
  }
  return errors;
}

export function normalizeProject(project, fallbackUserId = "usr-local") {
  const createdActivity = (project.activities || []).find(
    (activity) => activity.type === "created",
  );
  const createdActorId = /^usr-[0-9a-z-]+$/i.test(
    createdActivity?.actor?.id || "",
  )
    ? createdActivity.actor.id
    : null;
  return {
    ...project,
    schema_version: 3,
    owner_user_id: project.owner_user_id || fallbackUserId,
    creator_id:
      project.creator_id ||
      createdActorId ||
      project.owner_user_id ||
      fallbackUserId,
    created_at: project.created_at || createdActivity?.created_at || null,
    updated_at:
      project.updated_at ||
      project.created_at ||
      createdActivity?.created_at ||
      null,
    archived_at:
      project.archived_at ||
      (project.status === "archived" ? project.updated_at || null : null),
    members: project.members || [],
    team_ids: project.team_ids || [
      "team-content-technical",
      "team-web-development",
    ],
    activities: (project.activities || []).map((activity) => ({
      ...activity,
      actor: legacyActor(activity.actor),
    })),
  };
}

function projectActivity(type, actor, details = {}) {
  return {
    id: newUid(),
    type,
    actor: actorSnapshot(actor),
    created_at: new Date().toISOString(),
    ...details,
  };
}

export class ProjectStore {
  constructor(workspace) {
    this.workspace = workspace;
    this.root = resolve(workspace, "work-items", "projects");
  }

  async all() {
    let names = [];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    names = names.filter((name) => name.endsWith(".yml")).sort();
    const projects = [];
    for (const name of names) {
      const path = resolve(this.root, name);
      const raw = await readFile(path, "utf8");
      const parsed = YAML.parse(raw);
      const rawProject = {
        ...parsed,
        description: parsed.description || "",
        documents: parsed.documents || [],
        _path: path,
        _etag: contentEtag(raw),
      };
      const errors = validateProject(rawProject);
      if (errors.length)
        throw new Error(`${rawProject.key || name}: ${errors.join(", ")}`);
      projects.push(normalizeProject(rawProject));
    }
    const keys = new Set();
    const uids = new Set();
    const codes = new Set();
    for (const project of projects) {
      if (keys.has(project.key))
        throw new Error(`Duplicate project key: ${project.key}`);
      if (uids.has(project.uid))
        throw new Error(`Duplicate project uid: ${project.uid}`);
      if (codes.has(project.code))
        throw new Error(`Duplicate project code: ${project.code}`);
      keys.add(project.key);
      uids.add(project.uid);
      codes.add(project.code);
    }
    return projects;
  }

  async byKey(key) {
    return (
      (await this.all()).find(
        (project) => project.key === String(key).toUpperCase(),
      ) || null
    );
  }

  async byUid(uid) {
    return (await this.all()).find((project) => project.uid === uid) || null;
  }

  async create(input, actor = null) {
    const existing = await this.all();
    const max = Math.max(
      0,
      ...existing.map((item) => Number(item.key.slice(-3))),
    );
    const now = new Date().toISOString();
    const project = {
      schema_version: 3,
      uid: newUid(),
      key: `PRJ-${String(max + 1).padStart(3, "0")}`,
      code: String(input.code || "")
        .trim()
        .toUpperCase(),
      name: String(input.name || "").trim(),
      slug: slugify(input.slug || input.name),
      description: String(input.description || "").trim(),
      status: input.status || "active",
      documents: [],
      owner_user_id: actor?.id || "usr-local",
      creator_id: actor?.id || "usr-local",
      members: [],
      team_ids: [...new Set(input.team_ids || [])],
      activities: [projectActivity("created", actor)],
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    const errors = validateProject(project);
    if (errors.length)
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 400 });
    if (
      existing.some(
        (item) => item.code === project.code || item.slug === project.slug,
      )
    )
      throw Object.assign(new Error("project code or slug already exists"), {
        statusCode: 409,
      });
    const path = resolve(this.root, `${project.key.toLowerCase()}.yml`);
    const raw = YAML.stringify(project, { lineWidth: 0 });
    await atomicWrite(path, raw);
    return { ...project, _path: path, _etag: contentEtag(raw) };
  }

  async patch(uid, input, ifMatch, actor = null) {
    const existing = await this.byUid(uid);
    if (!existing)
      throw Object.assign(new Error("project not found"), { statusCode: 404 });
    if (!ifMatch || ifMatch !== existing._etag)
      throw Object.assign(new Error("project changed; reload before saving"), {
        statusCode: 409,
      });
    const allowed = new Set(["name", "description", "status"]);
    for (const field of Object.keys(input)) {
      if (!allowed.has(field))
        throw Object.assign(new Error(`field cannot be patched: ${field}`), {
          statusCode: 400,
        });
    }
    const now = new Date().toISOString();
    const next = {
      ...existing,
      ...input,
      name: String(input.name ?? existing.name).trim(),
      description: String(input.description ?? existing.description).trim(),
      updated_at: now,
      archived_at:
        existing.status !== "archived" && input.status === "archived"
          ? now
          : existing.status === "archived" && input.status === "active"
            ? null
            : existing.archived_at,
      activities: [
        ...existing.activities,
        projectActivity("changed", actor, {
          changes: Object.keys(input).map((field) => ({
            field,
            from: existing[field] ?? null,
            to: input[field] ?? null,
          })),
        }),
      ],
    };
    next.slug = slugify(next.name);
    delete next._path;
    delete next._etag;
    const errors = validateProject(next);
    if (errors.length)
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 400 });
    const projects = await this.all();
    if (
      projects.some(
        (project) => project.uid !== uid && project.slug === next.slug,
      )
    )
      throw Object.assign(new Error("project slug already exists"), {
        statusCode: 409,
      });
    const raw = YAML.stringify(next, { lineWidth: 0 });
    await atomicWrite(existing._path, raw);
    return { ...next, _path: existing._path, _etag: contentEtag(raw) };
  }

  async setMembers(uid, input, ifMatch, actor = null) {
    const existing = await this.byUid(uid);
    this.assertWritable(existing, ifMatch);
    const ownerUserId = input.owner_user_id || existing.owner_user_id;
    const members = (input.members ?? existing.members).filter(
      (member) => member.user_id !== ownerUserId,
    );
    const teamIds = [...new Set(input.team_ids ?? existing.team_ids)];
    const ownershipChanged = ownerUserId !== existing.owner_user_id;
    const activity = projectActivity(
      ownershipChanged ? "ownership" : "changed",
      actor,
      {
        changes: [
          ...(ownershipChanged
            ? [
                {
                  field: "owner_user_id",
                  from: existing.owner_user_id,
                  to: ownerUserId,
                },
              ]
            : []),
          { field: "members", to: members },
          { field: "team_ids", to: teamIds },
        ],
      },
    );
    return this.save(existing, {
      ...existing,
      owner_user_id: ownerUserId,
      members,
      team_ids: teamIds,
      activities: [...existing.activities, activity],
      updated_at: activity.created_at,
    });
  }

  async documents(uid) {
    const project = await this.byUid(uid);
    if (!project)
      throw Object.assign(new Error("project not found"), { statusCode: 404 });
    const items = [];
    for (const [index, document] of project.documents.entries()) {
      if (typeof document === "string") {
        const info = await projectDocumentReferenceInfo(
          this.workspace,
          document,
        );
        if (!info) continue;
        const query = `path=${encodeURIComponent(info.path)}`;
        items.push({
          index,
          source: "workspace",
          path: info.path,
          name: info.name,
          type: info.type,
          size: info.size,
          inline: info.inline,
          exists: info.exists,
          url: info.exists ? `/project-files/${uid}?${query}` : null,
          download_url: info.exists
            ? `/project-files/${uid}?${query}&download=1`
            : null,
        });
        continue;
      }
      const path = await this.managedDocumentPath(uid, document.name);
      items.push({
        ...document,
        index,
        source: "upload",
        exists: Boolean(path),
        url: path ? document.url : null,
        download_url: path ? `${document.url}?download=1` : null,
      });
    }
    return items;
  }

  async addDocumentReference(uid, value, ifMatch, actor = null) {
    const existing = await this.byUid(uid);
    this.assertWritable(existing, ifMatch);
    if (existing.documents.length >= 50)
      throw Object.assign(new Error("project document limit reached"), {
        statusCode: 409,
      });
    const reference = normalizeProjectDocumentReference(value);
    const info = await projectDocumentReferenceInfo(this.workspace, reference);
    if (!reference || !info?.exists)
      throw Object.assign(new Error("document reference not found or unsafe"), {
        statusCode: 400,
      });
    if (
      existing.documents.some(
        (document) =>
          typeof document === "string" &&
          normalizeProjectDocumentReference(document) === reference,
      )
    )
      throw Object.assign(new Error("document is already linked"), {
        statusCode: 409,
      });
    return this.save(existing, {
      ...existing,
      documents: [...existing.documents, reference],
      activities: [
        ...existing.activities,
        projectActivity("attachment_added", actor, {
          details: { name: info.name },
        }),
      ],
      updated_at: new Date().toISOString(),
    });
  }

  async addDocument(uid, file, ifMatch, actor = null) {
    const existing = await this.byUid(uid);
    this.assertWritable(existing, ifMatch);
    if (existing.documents.length >= 50)
      throw Object.assign(new Error("project document limit reached"), {
        statusCode: 409,
      });
    const validated = validateAttachment(file, "evidence");
    const root = resolve(
      this.workspace,
      "data",
      "work-tracker",
      "project-documents",
      uid,
    );
    await mkdir(root, { recursive: true });
    const cleanBase =
      slugify(basename(file.name || "document", extname(file.name || ""))) ||
      "document";
    const name = `${Date.now()}-${newUid().slice(0, 8)}-${cleanBase}${validated.extension}`;
    const path = resolve(root, name);
    if (!path.startsWith(`${root}${sep}`))
      throw Object.assign(new Error("unsafe document path"), {
        statusCode: 400,
      });
    await writeFile(path, file.data);
    const document = {
      name,
      original_name: file.name || name,
      type: validated.type,
      size: file.data.length,
      created_at: new Date().toISOString(),
      url: `/project-documents/${uid}/${name}`,
    };
    try {
      const project = await this.save(existing, {
        ...existing,
        documents: [...existing.documents, document],
        activities: [
          ...existing.activities,
          projectActivity("attachment_added", actor, {
            details: { name: document.original_name },
          }),
        ],
        updated_at: new Date().toISOString(),
      });
      return { document, project };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  async removeDocument(uid, index, ifMatch, actor = null) {
    const existing = await this.byUid(uid);
    this.assertWritable(existing, ifMatch);
    const documentIndex = Number(index);
    if (
      !Number.isInteger(documentIndex) ||
      documentIndex < 0 ||
      documentIndex >= existing.documents.length
    )
      throw Object.assign(new Error("project document not found"), {
        statusCode: 404,
      });
    const document = existing.documents[documentIndex];
    const path =
      typeof document === "string"
        ? null
        : await this.managedDocumentPath(uid, document.name);
    const project = await this.save(existing, {
      ...existing,
      documents: existing.documents.filter(
        (_, itemIndex) => itemIndex !== documentIndex,
      ),
      activities: [
        ...existing.activities,
        projectActivity("attachment_removed", actor, {
          details: {
            name:
              typeof document === "string"
                ? document
                : document.original_name || document.name,
          },
        }),
      ],
      updated_at: new Date().toISOString(),
    });
    if (path) await rm(path, { force: true });
    return project;
  }

  async managedDocumentPath(uid, name) {
    if (!UUID_PATTERN.test(uid || "") || basename(name || "") !== name)
      return null;
    const project = await this.byUid(uid);
    if (
      !project?.documents.some(
        (document) => typeof document !== "string" && document.name === name,
      )
    )
      return null;
    const root = resolve(
      this.workspace,
      "data",
      "work-tracker",
      "project-documents",
      uid,
    );
    const path = resolve(root, name);
    if (!path.startsWith(`${root}${sep}`)) return null;
    try {
      const info = await stat(path);
      return info.isFile() ? path : null;
    } catch {
      return null;
    }
  }

  async workspaceDocumentPath(uid, requestedPath) {
    const project = await this.byUid(uid);
    if (!project) return null;
    const normalized = normalizeProjectDocumentReference(requestedPath);
    if (
      !normalized ||
      !project.documents.some(
        (document) =>
          typeof document === "string" &&
          normalizeProjectDocumentReference(document) === normalized,
      )
    )
      return null;
    const info = await projectDocumentReferenceInfo(this.workspace, normalized);
    return info?.exists ? info : null;
  }

  assertWritable(existing, ifMatch) {
    if (!existing)
      throw Object.assign(new Error("project not found"), { statusCode: 404 });
    if (!ifMatch || ifMatch !== existing._etag)
      throw Object.assign(new Error("project changed; reload before saving"), {
        statusCode: 409,
      });
  }

  async save(existing, next) {
    const clean = { ...next };
    delete clean._path;
    delete clean._etag;
    const errors = validateProject(clean);
    if (errors.length)
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 400 });
    const raw = YAML.stringify(clean, { lineWidth: 0 });
    await atomicWrite(existing._path, raw);
    return { ...clean, _path: existing._path, _etag: contentEtag(raw) };
  }
}

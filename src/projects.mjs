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
  if (project.schema_version !== 1) errors.push("schema_version must be 1");
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
  return errors;
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
      const project = {
        ...parsed,
        description: parsed.description || "",
        documents: parsed.documents || [],
        _path: path,
        _etag: contentEtag(raw),
      };
      const errors = validateProject(project);
      if (errors.length)
        throw new Error(`${project.key || name}: ${errors.join(", ")}`);
      projects.push(project);
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

  async create(input) {
    const existing = await this.all();
    const max = Math.max(
      0,
      ...existing.map((item) => Number(item.key.slice(-3))),
    );
    const now = new Date().toISOString();
    const project = {
      schema_version: 1,
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
      created_at: now,
      updated_at: now,
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

  async patch(uid, input, ifMatch) {
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
    const next = {
      ...existing,
      ...input,
      name: String(input.name ?? existing.name).trim(),
      description: String(input.description ?? existing.description).trim(),
      updated_at: new Date().toISOString(),
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

  async addDocumentReference(uid, value, ifMatch) {
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
      updated_at: new Date().toISOString(),
    });
  }

  async addDocument(uid, file, ifMatch) {
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
        updated_at: new Date().toISOString(),
      });
      return { document, project };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  async removeDocument(uid, index, ifMatch) {
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

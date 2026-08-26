import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { contentEtag, newUid, slugify, UUID_PATTERN } from "./identity.mjs";
import { atomicWrite } from "./records.mjs";

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
  return errors;
}

export class ProjectStore {
  constructor(workspace) {
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
}

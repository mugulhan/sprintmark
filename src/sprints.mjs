import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { newUid, UUID_PATTERN } from "./identity.mjs";
import { atomicWrite } from "./records.mjs";

export const SPRINT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,7}-SP-\d{3}$/;
export const SPRINT_STATUSES = new Set(["planned", "active", "completed"]);

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function validateSprint(sprint) {
  const errors = [];
  if (sprint.schema_version !== 1) errors.push("schema_version must be 1");
  if (!UUID_PATTERN.test(sprint.uid || "")) errors.push("uid must be a UUID");
  if (!SPRINT_KEY_PATTERN.test(sprint.key || "")) errors.push("key is invalid");
  if (!/^PRJ-\d{3}$/.test(sprint.project_key || ""))
    errors.push("project_key is invalid");
  if (!String(sprint.name || "").trim()) errors.push("name is required");
  if (!SPRINT_STATUSES.has(sprint.status)) errors.push("status is invalid");
  if (!isIsoDate(sprint.start_date)) errors.push("start_date is invalid");
  if (!isIsoDate(sprint.end_date)) errors.push("end_date is invalid");
  if (
    isIsoDate(sprint.start_date) &&
    isIsoDate(sprint.end_date) &&
    sprint.start_date > sprint.end_date
  ) {
    errors.push("start_date cannot be after end_date");
  }
  return errors;
}

export class SprintStore {
  constructor(workspace) {
    this.workspace = workspace;
    this.root = resolve(workspace, "work-items", "sprints");
  }

  async all() {
    let names = [];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const sprints = [];
    for (const name of names.filter((item) => item.endsWith(".yml")).sort()) {
      const sprint = YAML.parse(
        await readFile(resolve(this.root, name), "utf8"),
      );
      const errors = validateSprint(sprint);
      if (errors.length)
        throw new Error(`${sprint.key || name}: ${errors.join(", ")}`);
      sprints.push(sprint);
    }
    const keys = new Set();
    const uids = new Set();
    for (const sprint of sprints) {
      if (keys.has(sprint.key))
        throw new Error(`Duplicate sprint key: ${sprint.key}`);
      if (uids.has(sprint.uid))
        throw new Error(`Duplicate sprint uid: ${sprint.uid}`);
      keys.add(sprint.key);
      uids.add(sprint.uid);
    }
    return sprints;
  }

  async create(input) {
    const existing = await this.all();
    const keyPrefix = String(input.key_prefix || "WORK").toUpperCase();
    const max = Math.max(
      0,
      ...existing
        .filter((item) => item.key.startsWith(`${keyPrefix}-SP-`))
        .map((item) => Number(item.key.slice(-3))),
    );
    const now = new Date().toISOString();
    const sprint = {
      schema_version: 1,
      uid: newUid(),
      key: `${keyPrefix}-SP-${String(max + 1).padStart(3, "0")}`,
      project_key: input.project_key || "PRJ-001",
      name: String(input.name || "").trim(),
      status: input.status || "planned",
      start_date: input.start_date,
      end_date: input.end_date,
      created_at: now,
      updated_at: now,
    };
    const errors = validateSprint(sprint);
    if (errors.length)
      throw Object.assign(new Error(errors.join(", ")), { statusCode: 400 });
    const path = resolve(this.root, `${sprint.key.toLowerCase()}.yml`);
    await atomicWrite(path, YAML.stringify(sprint, { lineWidth: 0 }));
    return sprint;
  }
}

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { contentEtag, validateRecord } from "./identity.mjs";

export function parseRecord(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("Invalid work item frontmatter");
  return {
    data: YAML.parse(match[1]),
    body: match[2].replace(/\s+$/, "") + "\n",
  };
}

export function serializeRecord(data, body = "") {
  const yaml = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${String(body).replace(/^\s+|\s+$/g, "")}\n`;
}

export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export async function listRecordPaths(workspace) {
  const roots = [
    resolve(workspace, "work-items", "tasks"),
    resolve(workspace, "work-items", "backlog"),
  ];
  const paths = [];
  for (const root of roots) {
    let names = [];
    try {
      names = await readdir(root);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    paths.push(
      ...names
        .filter((name) => name.endsWith(".md"))
        .map((name) => join(root, name)),
    );
  }
  return paths.sort();
}

export async function loadRecords(workspace) {
  const records = [];
  for (const path of await listRecordPaths(workspace)) {
    const raw = await readFile(path, "utf8");
    const parsed = parseRecord(raw);
    records.push({
      ...parsed.data,
      body: parsed.body,
      _path: path,
      _etag: contentEtag(raw),
    });
  }
  return records;
}

export function assertRecordSet(records) {
  const keys = new Set();
  const uids = new Set();
  for (const record of records) {
    const errors = validateRecord(record);
    if (errors.length)
      throw new Error(`${record.key || record.uid}: ${errors.join(", ")}`);
    if (keys.has(record.key)) throw new Error(`Duplicate key: ${record.key}`);
    if (uids.has(record.uid)) throw new Error(`Duplicate uid: ${record.uid}`);
    keys.add(record.key);
    uids.add(record.uid);
  }
}

export async function saveRecord(workspace, record, body) {
  const folder = record.kind === "backlog" ? "backlog" : "tasks";
  const path = resolve(
    workspace,
    "work-items",
    folder,
    `${record.key.toLowerCase()}.md`,
  );
  const raw = serializeRecord(record, body);
  await atomicWrite(path, raw);
  return { path, etag: contentEtag(raw) };
}

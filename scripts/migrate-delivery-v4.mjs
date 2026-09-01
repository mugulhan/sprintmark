import { cp, mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { atomicWrite, loadRecords, saveRecord } from "../src/records.mjs";
import { normalizeWorkItem } from "../src/store.mjs";
import { normalizeProject } from "../src/projects.mjs";

export async function migrateDeliveryModel({ workspace, apply = false } = {}) {
  if (!workspace) throw new Error("workspace is required");
  const records = await loadRecords(workspace);
  const workItems = records
    .filter((record) => record.schema_version !== 4)
    .map((record) => ({
      original: record,
      normalized: normalizeWorkItem(record),
    }));
  const projectRoot = resolve(workspace, "work-items", "projects");
  let projectNames = [];
  try {
    projectNames = (await readdir(projectRoot)).filter((name) =>
      name.endsWith(".yml"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const projects = [];
  for (const name of projectNames) {
    const path = resolve(projectRoot, name);
    const project = YAML.parse(await readFile(path, "utf8"));
    if (project.schema_version === 3) continue;
    projects.push({ path, normalized: normalizeProject(project) });
  }
  let backup = null;
  if (apply && (workItems.length || projects.length)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = resolve(
      workspace,
      "data",
      "work-tracker",
      "backups",
      `delivery-v4-${stamp}`,
    );
    await mkdir(backup, { recursive: true });
    await cp(resolve(workspace, "work-items"), resolve(backup, "work-items"), {
      recursive: true,
      force: false,
    });
    for (const { original, normalized } of workItems) {
      delete normalized._path;
      delete normalized._etag;
      await saveRecord(workspace, normalized, original.body || "");
    }
    for (const project of projects)
      await atomicWrite(
        project.path,
        YAML.stringify(project.normalized, { lineWidth: 0 }),
      );
  }
  return {
    mode: apply ? "apply" : "dry-run",
    work_items_total: records.length,
    work_items_to_migrate: workItems.length,
    projects_total: projectNames.length,
    projects_to_migrate: projects.length,
    backup,
  };
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = new Set(process.argv.slice(2));
  const workspaceArg = process.argv.find((value) =>
    value.startsWith("--workspace="),
  );
  const report = await migrateDeliveryModel({
    workspace: resolve(
      workspaceArg?.slice("--workspace=".length) || process.cwd(),
    ),
    apply: args.has("--apply"),
  });
  process.stdout.write(`${YAML.stringify(report, { lineWidth: 0 })}\n`);
}

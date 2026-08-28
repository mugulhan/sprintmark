import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { CollaborationStore, legacyActor } from "../src/collaboration.mjs";
import { atomicWrite, loadRecords, saveRecord } from "../src/records.mjs";
import { normalizeWorkItem } from "../src/store.mjs";

const STATUS_MAP = {
  open: "planned",
  triage: "backlog",
  software: "planned",
  waiting: "waiting",
  done: "done",
};

function migrationActivity(record) {
  return {
    id: `created-${record.uid}`,
    type: "created",
    actor: { type: "system", id: "sprintmark", display_name: "Sprintmark" },
    created_at: record.created_at,
  };
}

export async function migrateCollaboration({
  workspace,
  apply = false,
  bootstrapEmails = [],
  localUser = null,
} = {}) {
  if (!workspace) throw new Error("workspace is required");
  const collaboration = new CollaborationStore(workspace);
  const requestedLocalUser =
    localUser ||
    (!bootstrapEmails.length
      ? { email: "local@sprintmark.invalid", display_name: "Local user" }
      : null);
  const currentDirectory = await collaboration.read();
  let backup = null;
  if (apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = resolve(
      workspace,
      "data",
      "work-tracker",
      "backups",
      `collaboration-v3-${stamp}`,
    );
    await mkdir(backup, { recursive: true });
    await cp(resolve(workspace, "work-items"), resolve(backup, "work-items"), {
      recursive: true,
      force: false,
    });
  }
  const directory =
    currentDirectory._missing && !apply
      ? {
          users: [
            {
              id: requestedLocalUser ? "usr-local" : "usr-bootstrap-dry-run",
              email: requestedLocalUser?.email || bootstrapEmails[0],
              display_name:
                requestedLocalUser?.display_name || bootstrapEmails[0],
              system_role: "admin",
            },
          ],
        }
      : await collaboration.ensureBootstrap({
          emails: bootstrapEmails,
          localUser: requestedLocalUser,
        });
  const owner =
    directory.users.find((user) => user.system_role === "admin") ||
    directory.users[0];
  if (!owner) throw new Error("bootstrap administrator could not be resolved");

  const projectRoot = resolve(workspace, "work-items", "projects");
  let projectNames = [];
  try {
    projectNames = (await readdir(projectRoot)).filter((name) =>
      name.endsWith(".yml"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const projectChanges = [];
  for (const name of projectNames) {
    const path = resolve(projectRoot, name);
    const raw = await readFile(path, "utf8");
    const project = YAML.parse(raw);
    if (project.schema_version === 2) continue;
    projectChanges.push({
      path,
      record: {
        ...project,
        schema_version: 2,
        owner_user_id: owner.id,
        members: [],
        team_ids: ["team-content-technical", "team-web-development"],
        activities: [migrationActivity(project)],
      },
    });
  }

  const records = await loadRecords(workspace);
  const workItemChanges = records.flatMap((record) => {
    if (record.schema_version === 3) return [];
    const normalized = normalizeWorkItem(record, owner.id);
    normalized.status = STATUS_MAP[record.status] || record.status;
    normalized.reporter_id = owner.id;
    normalized.activities = (
      record.activities?.length
        ? record.activities
        : [migrationActivity(record)]
    ).map((activity) => ({ ...activity, actor: legacyActor(activity.actor) }));
    delete normalized._path;
    delete normalized._etag;
    return [
      {
        record: normalized,
        body: record.body || "",
        originalPath: record._path,
      },
    ];
  });

  const report = {
    mode: apply ? "apply" : "dry-run",
    owner_user_id: owner.id,
    projects_total: projectNames.length,
    projects_to_migrate: projectChanges.length,
    work_items_total: records.length,
    work_items_to_migrate: workItemChanges.length,
    status_mapping: STATUS_MAP,
    backup,
  };
  if (!apply) return report;

  for (const project of projectChanges)
    await atomicWrite(
      project.path,
      YAML.stringify(project.record, { lineWidth: 0 }),
    );
  for (const item of workItemChanges) {
    const saved = await saveRecord(workspace, item.record, item.body);
    if (resolve(saved.path) !== resolve(item.originalPath))
      await rm(item.originalPath, { force: true });
  }
  const reportPath = resolve(backup, "migration-report.yml");
  await atomicWrite(reportPath, YAML.stringify(report, { lineWidth: 0 }));
  return report;
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = new Set(process.argv.slice(2));
  const workspaceArg = process.argv.find((value) =>
    value.startsWith("--workspace="),
  );
  const workspace = resolve(
    workspaceArg?.slice("--workspace=".length) || process.cwd(),
  );
  const bootstrapEmails = String(process.env.BOOTSTRAP_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const report = await migrateCollaboration({
    workspace,
    apply: args.has("--apply"),
    bootstrapEmails,
  });
  process.stdout.write(`${YAML.stringify(report, { lineWidth: 0 })}\n`);
}

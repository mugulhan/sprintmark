import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { migrateDeliveryModel } from "../scripts/migrate-delivery-v4.mjs";
import { ProjectStore } from "../src/projects.mjs";
import { WorkItemStore } from "../src/store.mjs";

test("delivery migration is dry-run safe, backed up and idempotent", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-delivery-"));
  const projectStore = new ProjectStore(workspace);
  const workItemStore = new WorkItemStore(workspace);
  const project = await projectStore.create({ name: "Delivery", code: "DLV" });
  const item = await workItemStore.create(
    {
      title: "Legacy timed work",
      project_key: project.key,
      key_prefix: project.code,
    },
    { actor: { id: "usr-creator", display_name: "Creator" } },
  );
  const itemPath = join(workspace, "work-items", "tasks", "dlv-0001.md");
  const legacyItem = (await readFile(itemPath, "utf8"))
    .replace("schema_version: 4", "schema_version: 3")
    .replace(/creator_id:.*\n/, "")
    .replace(/estimate_minutes:.*\n/, "")
    .replace(/started_at:.*\n/, "");
  await writeFile(itemPath, legacyItem, "utf8");
  const projectPath = join(workspace, "work-items", "projects", "prj-001.yml");
  const legacyProject = YAML.parse(await readFile(projectPath, "utf8"));
  legacyProject.schema_version = 2;
  delete legacyProject.creator_id;
  delete legacyProject.archived_at;
  await writeFile(projectPath, YAML.stringify(legacyProject), "utf8");

  const dryRun = await migrateDeliveryModel({ workspace });
  assert.equal(dryRun.work_items_to_migrate, 1);
  assert.equal(dryRun.projects_to_migrate, 1);
  assert.match(await readFile(itemPath, "utf8"), /schema_version: 3/);

  const applied = await migrateDeliveryModel({ workspace, apply: true });
  assert.ok(applied.backup);
  const migrated = await workItemStore.byUid(item.uid);
  assert.equal(migrated.schema_version, 4);
  assert.equal(migrated.creator_id, "usr-creator");
  assert.equal(migrated.estimate_minutes, null);
  assert.equal(migrated.started_at, null);
  assert.equal((await projectStore.byUid(project.uid)).schema_version, 3);

  const second = await migrateDeliveryModel({ workspace });
  assert.equal(second.work_items_to_migrate, 0);
  assert.equal(second.projects_to_migrate, 0);
});

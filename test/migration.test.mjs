import assert from "node:assert/strict";
import test from "node:test";
import { migrateRecord } from "../scripts/migrate-work-items-v2.mjs";

test("v1 migration normalizes priority and extracts a known completion time", () => {
  const migrated = migrateRecord(
    {
      schema_version: 1,
      uid: "36ffcb57-6d3a-4acf-b2e5-0d563ade31e0",
      key: "WORK-0005",
      kind: "task",
      project_key: "PRJ-001",
      title: "Published task",
      slug: "published-task",
      status: "done",
      team: "content-technical",
      scheduled_for: "2026-07-24",
      priority: "Orta",
      created_at: "2026-07-24T07:56:00.000Z",
      updated_at: "2026-07-24T08:16:00.000Z",
      legacy_ids: [],
      legacy_routes: [],
      attachments: [],
    },
    "- **Canlı doğrulama ve tamamlanma:** 24 Temmuz 2026 11:16 (Europe/Istanbul)",
  );
  assert.equal(migrated.schema_version, 2);
  assert.equal(migrated.priority, "medium");
  assert.equal(migrated.scheduled_time, null);
  assert.equal(migrated.completed_at, "2026-07-24T08:16:00.000Z");
});

test("v1 migration does not invent completion precision", () => {
  const migrated = migrateRecord(
    {
      schema_version: 1,
      status: "done",
      priority: null,
    },
    "Completed historically, without a known timestamp.",
  );
  assert.equal(migrated.completed_at, null);
});

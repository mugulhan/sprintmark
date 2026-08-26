import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SprintStore, validateSprint } from "../src/sprints.mjs";

test("sprint store creates stable sequential keys and persists date ranges", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-sprint-"));
  const store = new SprintStore(workspace);
  const first = await store.create({
    name: "Ağustos SEO Sprinti",
    start_date: "2026-08-24",
    end_date: "2026-08-28",
  });
  const second = await store.create({
    name: "Eylül İçerik Sprinti",
    start_date: "2026-09-01",
    end_date: "2026-09-11",
    status: "active",
  });
  assert.equal(first.key, "WORK-SP-001");
  assert.equal(first.project_key, "PRJ-001");
  assert.equal(second.key, "WORK-SP-002");
  assert.deepEqual(
    (await store.all()).map((item) => item.key),
    ["WORK-SP-001", "WORK-SP-002"],
  );
});

test("sprint keys are namespaced by project code", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "work-sprint-"));
  const store = new SprintStore(workspace);
  const sprint = await store.create({
    name: "Mobil Sprint",
    project_key: "PRJ-002",
    key_prefix: "MOBIL",
    start_date: "2026-09-01",
    end_date: "2026-09-05",
  });
  assert.equal(sprint.key, "MOBIL-SP-001");
  assert.equal(sprint.project_key, "PRJ-002");
});

test("sprint validation rejects reversed and malformed ranges", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-sprint-"));
  const store = new SprintStore(workspace);
  await assert.rejects(
    () =>
      store.create({
        name: "Ters Sprint",
        start_date: "2026-08-30",
        end_date: "2026-08-20",
      }),
    (error) => error.statusCode === 400,
  );
  assert.ok(validateSprint({}).length >= 6);
});

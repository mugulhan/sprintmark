import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkItemStore } from "../src/store.mjs";

test("store writes atomically and enforces optimistic concurrency", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-store-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({
    title: "Deneme görevi",
    kind: "task",
    body: "1. İlk adım\n2. İkinci adım",
  });
  assert.equal(created.key, "WORK-0001");
  assert.equal(created.project_key, "PRJ-001");
  const updated = await store.patch(
    created.uid,
    { title: "Güncel görev" },
    created._etag,
  );
  assert.equal(updated.title, "Güncel görev");
  await assert.rejects(
    () => store.patch(created.uid, { title: "Eski yazma" }, created._etag),
    (error) => error.statusCode === 409,
  );
  const raw = await readFile(
    join(workspace, "work-items", "tasks", "work-0001.md"),
    "utf8",
  );
  assert.match(raw, /uid: [0-9a-f-]{36}/);
  assert.match(raw, /Güncel görev/);
});

test("store uses the selected project's immutable code for new keys", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "work-store-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({
    title: "Mobil görev",
    project_key: "PRJ-002",
    key_prefix: "MOBIL",
  });
  assert.equal(created.key, "MOBIL-0001");
  assert.equal(created.project_key, "PRJ-002");
});

test("store rejects invalid teams", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-store-"));
  const store = new WorkItemStore(workspace);
  await assert.rejects(
    () => store.create({ title: "Test", team: "unknown" }),
    (error) => error.statusCode === 400,
  );
});

test("store persists priority and planned time while rejecting invalid values", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-store-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({
    title: "Timed task",
    priority: "critical",
    scheduled_for: "2026-08-26",
    scheduled_time: "14:35",
  });
  assert.equal(created.schema_version, 2);
  assert.equal(created.priority, "critical");
  assert.equal(created.scheduled_time, "14:35");
  await assert.rejects(
    () => store.create({ title: "Invalid", priority: "urgent" }),
    (error) => error.statusCode === 400,
  );
  await assert.rejects(
    () => store.create({ title: "Invalid time", scheduled_time: "25:00" }),
    (error) => error.statusCode === 400,
  );
});

test("store timestamps done transitions and clears completion when reopened", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-store-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({ title: "Lifecycle" });
  assert.equal(created.completed_at, null);

  const completed = await store.patch(
    created.uid,
    { status: "done" },
    created._etag,
  );
  assert.equal(completed.status, "done");
  assert.ok(!Number.isNaN(Date.parse(completed.completed_at)));
  assert.equal(completed.completed_at, completed.updated_at);

  const reopened = await store.patch(
    completed.uid,
    { status: "open" },
    completed._etag,
  );
  assert.equal(reopened.status, "open");
  assert.equal(reopened.completed_at, null);

  const completedAgain = await store.patch(
    reopened.uid,
    { status: "done" },
    reopened._etag,
  );
  assert.ok(
    Date.parse(completedAgain.completed_at) >=
      Date.parse(completed.completed_at),
  );
});

test("attachment guard rejects unsupported and oversized files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-store-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({ title: "Kanıt görevi" });
  await assert.rejects(
    () =>
      store.addAttachment(created.uid, {
        name: "test.svg",
        type: "image/svg+xml",
        data: Buffer.from("x"),
      }),
    (error) => error.statusCode === 415,
  );
  await assert.rejects(
    () =>
      store.addAttachment(created.uid, {
        name: "huge.png",
        type: "image/png",
        data: Buffer.alloc(25 * 1024 * 1024 + 1),
      }),
    (error) => error.statusCode === 413,
  );
  assert.equal(await store.attachmentPath(created.uid, "../outside.png"), null);
});

test("evidence files accept safe document formats and keep body images at 8 MB", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-files-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({ title: "Dosya kanıtları" });
  const files = [
    { name: "report.csv", type: "text/csv", data: Buffer.from("a,b\n1,2\n") },
    {
      name: "result.json",
      type: "application/json",
      data: Buffer.from('{"ok":true}'),
    },
    {
      name: "report.pdf",
      type: "application/pdf",
      data: Buffer.from("%PDF-1.7\n"),
    },
    {
      name: "report.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: Buffer.from("504b030400000000", "hex"),
    },
  ];
  let latest = created;
  for (const file of files) {
    const uploaded = await store.addAttachment(created.uid, file);
    latest = uploaded.record;
  }
  assert.equal(latest.attachments.length, files.length);
  assert.deepEqual(
    latest.attachments.map((attachment) => attachment.original_name),
    files.map((file) => file.name),
  );
  await assert.rejects(
    () =>
      store.addAttachment(created.uid, {
        name: "invalid.json",
        type: "application/json",
        data: Buffer.from("not-json"),
      }),
    (error) => error.statusCode === 415,
  );
  await assert.rejects(
    () =>
      store.addAttachment(
        created.uid,
        {
          name: "large.png",
          type: "image/png",
          data: Buffer.concat([
            Buffer.from("89504e470d0a1a0a", "hex"),
            Buffer.alloc(8 * 1024 * 1024),
          ]),
        },
        "body",
      ),
    (error) => error.statusCode === 413,
  );
});

test("workspace references are task-scoped and cannot escape safe roots", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-references-"));
  const runDirectory = join(workspace, "data", "runs");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "report.csv"), "a,b\n1,2\n", "utf8");
  await writeFile(join(workspace, ".env"), "SECRET=value\n", "utf8");
  const store = new WorkItemStore(workspace);
  const created = await store.create({
    title: "Referanslı görev",
    body: [
      "- `data/runs/report.csv`",
      "- `data/runs/missing.json`",
      "- `.env`",
    ].join("\n"),
  });
  const references = await store.fileReferences(created.uid);
  assert.equal(references.length, 2);
  assert.equal(references[0].exists, true);
  assert.equal(references[1].exists, false);
  assert.ok(
    (await store.workspaceReferencePath(created.uid, "data/runs/report.csv"))
      .file,
  );
  assert.equal(
    await store.workspaceReferencePath(
      created.uid,
      "data/runs/../runs/report.csv",
    ),
    null,
  );
  assert.equal(await store.workspaceReferencePath(created.uid, ".env"), null);

  const other = await store.create({ title: "Başka görev" });
  assert.equal(
    await store.workspaceReferencePath(other.uid, "data/runs/report.csv"),
    null,
  );

  const outside = join(workspace, "..", `outside-${Date.now()}.csv`);
  await writeFile(outside, "outside", "utf8");
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(outside, { force: true });
  });
  try {
    await symlink(outside, join(runDirectory, "linked.csv"), "file");
    const linked = await store.create({
      title: "Bağlı dosya",
      body: "`data/runs/linked.csv`",
    });
    assert.equal((await store.fileReferences(linked.uid)).length, 0);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
});

test("evidence attachments can be removed with optimistic locking", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-store-"));
  const store = new WorkItemStore(workspace);
  const created = await store.create({ title: "Evidence gallery" });
  const uploaded = await store.addAttachment(created.uid, {
    name: "proof.png",
    type: "image/png",
    data: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
  });
  await assert.rejects(
    () =>
      store.removeAttachment(
        created.uid,
        uploaded.attachment.name,
        created._etag,
      ),
    (error) => error.statusCode === 409,
  );
  const removed = await store.removeAttachment(
    created.uid,
    uploaded.attachment.name,
    uploaded.record._etag,
  );
  assert.equal(removed.attachments.length, 0);
  assert.equal(
    await store.attachmentPath(created.uid, uploaded.attachment.name),
    null,
  );
});

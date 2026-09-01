import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/projects.mjs";

test("project store starts empty and creates unique project codes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "work-project-"));
  const store = new ProjectStore(workspace);
  const defaults = await store.all();
  assert.equal(defaults.length, 0);

  const project = await store.create({
    name: "Mobil Uygulama",
    code: "MOBIL",
    description: "Mobil ürün geliştirme projesi",
    created_at: "2000-01-01T00:00:00.000Z",
  });
  assert.equal(project.key, "PRJ-001");
  assert.equal(project.slug, "mobil-uygulama");
  assert.equal(project.schema_version, 3);
  assert.ok(!Number.isNaN(Date.parse(project.created_at)));
  assert.notEqual(project.created_at, "2000-01-01T00:00:00.000Z");
  assert.equal(project.archived_at, null);
  assert.equal(project.description, "Mobil ürün geliştirme projesi");
  const updated = await store.patch(
    project.uid,
    { name: "Mobil Deneyim", status: "archived" },
    project._etag,
  );
  assert.equal(updated.slug, "mobil-deneyim");
  assert.equal(updated.status, "archived");
  assert.ok(!Number.isNaN(Date.parse(updated.archived_at)));
  const reactivated = await store.patch(
    updated.uid,
    { status: "active" },
    updated._etag,
  );
  assert.equal(reactivated.archived_at, null);
  await assert.rejects(
    () => store.patch(project.uid, { status: "active" }, project._etag),
    (error) => error.statusCode === 409,
  );
  await assert.rejects(
    () => store.create({ name: "İkinci Mobil", code: "MOBIL" }),
    (error) => error.statusCode === 409,
  );
});

test("project documents support safe workspace references and managed uploads", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "work-project-docs-"));
  await mkdir(join(workspace, "docs"), { recursive: true });
  await writeFile(
    join(workspace, "YENIWEB_MIMARISI.md"),
    "# Mimari\n\n## Yayın modeli\n",
    "utf8",
  );
  await writeFile(join(workspace, ".env"), "SECRET=value\n", "utf8");
  const store = new ProjectStore(workspace);
  const created = await store.create({ name: "Yeniweb", code: "YWEB" });
  const linked = await store.addDocumentReference(
    created.uid,
    "YENIWEB_MIMARISI.md",
    created._etag,
  );
  const listed = await store.documents(created.uid);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].source, "workspace");
  assert.equal(listed[0].exists, true);
  assert.match(listed[0].type, /^text\/markdown/);
  await assert.rejects(
    () => store.addDocumentReference(created.uid, "../secret.md", linked._etag),
    (error) => error.statusCode === 400,
  );
  await assert.rejects(
    () => store.addDocumentReference(created.uid, ".env", linked._etag),
    (error) => error.statusCode === 400,
  );
  const uploaded = await store.addDocument(
    created.uid,
    {
      name: "runbook.json",
      type: "application/json",
      data: Buffer.from('{"ready":true}\n'),
    },
    linked._etag,
  );
  assert.equal(uploaded.project.documents.length, 2);
  assert.equal((await store.documents(created.uid))[1].source, "upload");
  const removed = await store.removeDocument(
    created.uid,
    1,
    uploaded.project._etag,
  );
  assert.equal(removed.documents.length, 1);
  await assert.rejects(
    () => store.removeDocument(created.uid, 0, uploaded.project._etag),
    (error) => error.statusCode === 409,
  );
});

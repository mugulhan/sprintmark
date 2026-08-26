import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
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
  });
  assert.equal(project.key, "PRJ-001");
  assert.equal(project.slug, "mobil-uygulama");
  assert.equal(project.description, "Mobil ürün geliştirme projesi");
  const updated = await store.patch(
    project.uid,
    { name: "Mobil Deneyim", status: "archived" },
    project._etag,
  );
  assert.equal(updated.slug, "mobil-deneyim");
  assert.equal(updated.status, "archived");
  await assert.rejects(
    () => store.patch(project.uid, { status: "active" }, project._etag),
    (error) => error.statusCode === 409,
  );
  await assert.rejects(
    () => store.create({ name: "İkinci Mobil", code: "MOBIL" }),
    (error) => error.statusCode === 409,
  );
});

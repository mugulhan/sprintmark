import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const publicRoot = resolve(import.meta.dirname, "..", "public");

test("project navigation and Markdown rich editing are wired in the UI", async () => {
  const [html, app] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
  ]);
  assert.match(html, /data-view="projects"/);
  assert.match(html, /class="brand-lockup"/);
  assert.match(html, /sprintmark-mark\.svg/);
  assert.match(html, /class="nav projects-home"/);
  assert.equal((html.match(/data-view="projects"/g) || []).length, 1);
  assert.match(html, /id="createEditor"/);
  assert.match(html, /id="editStatus"/);
  assert.match(html, /id="editPriority"/);
  assert.match(html, /id="toggleDone"/);
  assert.match(html, /vendor\/toastui-editor\.js/);
  assert.match(app, /window\.toastui\.Editor/);
  assert.match(app, /viewer: true/);
  assert.doesNotMatch(app, /Henüz sprint oluşturulmadı/);
});

test("the rich viewer replaces the legacy Markdown renderer so tables can render", async () => {
  const app = await readFile(resolve(publicRoot, "app.js"), "utf8");
  assert.match(app, /renderWorkItemViewer/);
  assert.doesNotMatch(app, /function markdown\(/);
  assert.match(app, /toolbarItems: editorToolbar/);
  assert.match(app, /addImageBlobHook/);
  assert.match(app, /data-create-date/);
  assert.match(app, /scheduled_time/);
  assert.match(app, /priorityFilter/);
  assert.match(app, /completed_at/);
  assert.match(app, /relativeElapsed/);
  assert.match(app, /patchSelectedWorkItem/);
  assert.match(app, /`v\$\{meta\.version\}`/);
  assert.doesNotMatch(app, /çalışma ağacı kirli/);
});

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
  assert.match(html, /id="createEditor"/);
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
});

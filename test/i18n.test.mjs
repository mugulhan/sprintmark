import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { messages, t, tp } from "../public/i18n.js";

const publicRoot = resolve(import.meta.dirname, "..", "public");

test("Turkish and English catalogs expose identical stable keys", () => {
  assert.deepEqual(
    Object.keys(messages.en).sort(),
    Object.keys(messages.tr).sort(),
  );
});

test("message interpolation and English plural forms are locale aware", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { documentElement: { lang: "en" } };
  try {
    assert.equal(t("project.goCalendar"), "Go to calendar");
    assert.equal(tp("count.project", 1), "1 project");
    assert.equal(tp("count.project", 2), "2 projects");
    assert.equal(tp("summary.calendarItems", 1), "1 calendar item");
    assert.equal(tp("summary.calendarItems", 2), "2 calendar items");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("every static and direct dynamic i18n key exists in both catalogs", async () => {
  const [html, app] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
  ]);
  const staticKeys = [
    ...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g),
  ].map((match) => match[1]);
  const directKeys = [...app.matchAll(/\b(t|tp)\("([^"]+)"/g)].map((match) => ({
    helper: match[1],
    key: match[2],
  }));
  for (const key of staticKeys) {
    assert.ok(messages.tr[key], `Missing Turkish static key: ${key}`);
    assert.ok(messages.en[key], `Missing English static key: ${key}`);
  }
  for (const { helper, key } of directKeys) {
    if (helper === "tp") {
      assert.ok(
        messages.tr[`${key}.other`],
        `Missing Turkish plural key: ${key}`,
      );
      assert.ok(
        messages.en[`${key}.other`],
        `Missing English plural key: ${key}`,
      );
    } else {
      assert.ok(messages.tr[key], `Missing Turkish dynamic key: ${key}`);
      assert.ok(messages.en[key], `Missing English dynamic key: ${key}`);
    }
  }
});

test("localization never walks or rewrites stored user content", async () => {
  const [i18n, app] = await Promise.all([
    readFile(resolve(publicRoot, "i18n.js"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
  ]);
  assert.doesNotMatch(i18n, /createTreeWalker|NodeFilter/);
  assert.match(i18n, /querySelectorAll\("\[data-i18n\]"\)/);
  assert.match(app, /escapeHtml\(project\.description \|\| ""\)/);
  assert.match(app, /escapeHtml\(item\.title\)/);
});

test("breadcrumb derives canonical workspace and work-item paths", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(resolve(publicRoot, "index.html"), "utf8"),
    readFile(resolve(publicRoot, "app.js"), "utf8"),
    readFile(resolve(publicRoot, "styles.css"), "utf8"),
  ]);
  assert.match(html, /<nav id="breadcrumb" class="breadcrumb"/);
  assert.match(app, /function breadcrumbItems\(\)/);
  assert.match(app, /function returnPathContext\(\)/);
  assert.match(app, /location\.pathname\.startsWith\("\/work-items\/"\)/);
  assert.match(app, /aria-current="page"/);
  assert.match(app, /href: "\/projects\/"/);
  assert.match(styles, /\.breadcrumb-current/);
  assert.match(styles, /overflow-x: auto/);
});

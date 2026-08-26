import assert from "node:assert/strict";
import test from "node:test";
import { slugify, validateRecord } from "../src/identity.mjs";

test("slugify normalizes Turkish text and never leaves a trailing separator", () => {
  assert.equal(
    slugify("İçerik Şeması: Ölçüm ve Çözüm"),
    "icerik-semasi-olcum-ve-cozum",
  );
  assert.ok(!slugify(`${"çok uzun başlık ".repeat(20)}`).endsWith("-"));
});

test("slugify preserves readable canonical slugs up to 120 characters", () => {
  const slug =
    "redirect-manager-kaydi-bulunan-eski-urllerin-nextjs-cache-nedeniyle-404-donmesi";
  assert.equal(slugify(slug), slug);
});

test("record validation rejects unknown status and malformed keys", () => {
  const errors = validateRecord({
    schema_version: 1,
    uid: "bad",
    key: "94",
    kind: "task",
    title: "Test",
    slug: "test",
    status: "mystery",
    team: "content-technical",
    scheduled_for: null,
    legacy_ids: [],
    legacy_routes: [],
    attachments: [],
  });
  assert.ok(errors.some((error) => error.includes("UUID")));
  assert.ok(errors.some((error) => error.includes("key")));
  assert.ok(errors.some((error) => error.includes("status")));
});

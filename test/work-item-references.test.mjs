import assert from "node:assert/strict";
import test from "node:test";

import {
  matchWorkItemCommand,
  searchWorkItemReferences,
  WORK_ITEM_KEY_PATTERN,
  workItemKeyFromHref,
  workItemReferenceHref,
} from "../public/work-item-references.js";

const projects = [
  { key: "PRJ-001", name: "Yeniweb" },
  { key: "PRJ-002", name: "Product platform" },
];
const items = [
  {
    key: "YWEB-0090",
    title: "Kariyer görsellerini optimize et",
    project_key: "PRJ-001",
  },
  {
    key: "YWEB-0126",
    title: "Kariyer sayfasındaki bozuk görseller",
    project_key: "PRJ-001",
  },
  {
    key: "PROD-BL-001",
    title: "Public roadmap",
    project_key: "PRJ-002",
  },
];

test("localized slash commands expose their query without consuming leading text", () => {
  assert.deepEqual(matchWorkItemCommand("/iş kariyer"), {
    command: "/iş kariyer",
    query: "kariyer",
  });
  assert.deepEqual(matchWorkItemCommand("Not: /work YWEB-0090"), {
    command: "/work YWEB-0090",
    query: "YWEB-0090",
  });
  assert.equal(matchWorkItemCommand("https://example.com/work"), null);
  assert.equal(matchWorkItemCommand("metin/iş"), null);
});

test("reference search matches keys, titles and projects with exact keys first", () => {
  assert.deepEqual(
    searchWorkItemReferences(items, projects, "YWEB-0090").map(
      (item) => item.key,
    ),
    ["YWEB-0090"],
  );
  assert.deepEqual(
    searchWorkItemReferences(items, projects, "kariyer").map(
      (item) => item.key,
    ),
    ["YWEB-0090", "YWEB-0126"],
  );
  assert.deepEqual(
    searchWorkItemReferences(items, projects, "product").map(
      (item) => item.key,
    ),
    ["PROD-BL-001"],
  );
  assert.equal(
    searchWorkItemReferences(items, projects, "", {
      excludeKey: "YWEB-0090",
      limit: 1,
    })[0].key,
    "PROD-BL-001",
  );
});

test("work item references use portable key-only internal URLs", () => {
  assert.equal(workItemReferenceHref("yweb-0090"), "/work-items/YWEB-0090");
  assert.equal(
    workItemKeyFromHref(
      "/work-items/YWEB-0090/old-slug",
      "http://127.0.0.1:4310",
    ),
    "YWEB-0090",
  );
  assert.equal(
    workItemKeyFromHref(
      "https://elsewhere.example/work-items/YWEB-0090",
      "http://127.0.0.1:4310",
    ),
    null,
  );
  assert.deepEqual(
    [..."See YWEB-0090 and PROD-BL-001".matchAll(WORK_ITEM_KEY_PATTERN)].map(
      (match) => match[1],
    ),
    ["YWEB-0090", "PROD-BL-001"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectInsights, cycleMinutes } from "../src/insights.mjs";

const now = Date.parse("2026-09-01T12:00:00.000Z");
const task = (key, overrides = {}) => ({
  key,
  uid: `00000000-0000-4000-8000-${key.padStart(12, "0")}`,
  slug: `task-${key}`,
  title: `Task ${key}`,
  kind: "task",
  status: "planned",
  updated_at: "2026-09-01T10:00:00.000Z",
  estimate_minutes: null,
  started_at: null,
  completed_at: null,
  ...overrides,
});

test("project insights aggregate estimates and measured cycle time", () => {
  const records = [
    task("1", { estimate_minutes: 60 }),
    task("2", {
      status: "done",
      estimate_minutes: 120,
      started_at: "2026-09-01T08:00:00.000Z",
      completed_at: "2026-09-01T10:00:00.000Z",
    }),
    task("3", {
      status: "in_progress",
      estimate_minutes: 240,
      started_at: "2026-09-01T11:00:00.000Z",
    }),
    { ...task("BL"), kind: "backlog" },
  ];
  const result = buildProjectInsights(records, { now });
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.estimated_count, 3);
  assert.equal(result.summary.total_estimate_minutes, 420);
  assert.equal(result.summary.remaining_estimate_minutes, 300);
  assert.equal(result.summary.median_cycle_minutes, 120);
  assert.equal(result.items.find((item) => item.key === "3").cycle_minutes, 60);
});

test("project insight filters and paginates without inventing durations", () => {
  const records = Array.from({ length: 25 }, (_, index) =>
    task(String(index), {
      estimate_minutes: index % 2 ? null : 30,
    }),
  );
  const result = buildProjectInsights(records, {
    filter: "unestimated",
    page: 2,
    pageSize: 5,
    now,
  });
  assert.equal(result.pagination.total, 12);
  assert.equal(result.pagination.page, 2);
  assert.equal(result.items.length, 5);
  assert.equal(cycleMinutes(task("x"), now), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEffort,
  formatElapsed,
  parseEffort,
} from "../public/durations.js";

test("effort parser accepts quick-entry Turkish and English units", () => {
  assert.equal(parseEffort("90dk"), 90);
  assert.equal(parseEffort("3sa"), 180);
  assert.equal(parseEffort("2g"), 960);
  assert.equal(parseEffort("1.5h"), 90);
  assert.equal(parseEffort("2d"), 960);
  assert.equal(parseEffort(""), null);
  assert.ok(Number.isNaN(parseEffort("tomorrow")));
});

test("effort and elapsed durations use different day conventions", () => {
  assert.equal(formatEffort(960, "en"), "2 d");
  assert.equal(formatElapsed(2880, "en"), "2 d");
  assert.equal(formatElapsed(1500, "tr"), "1 g 1 sa");
});

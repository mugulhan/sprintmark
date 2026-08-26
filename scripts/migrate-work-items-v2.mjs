import { resolve } from "node:path";
import {
  atomicWrite,
  listRecordPaths,
  parseRecord,
  serializeRecord,
} from "../src/records.mjs";
import { readFile } from "node:fs/promises";
import { validateRecord } from "../src/identity.mjs";
import { generateSummaries } from "../src/summaries.mjs";

const monthNumbers = new Map([
  ["ocak", 1],
  ["şubat", 2],
  ["mart", 3],
  ["nisan", 4],
  ["mayıs", 5],
  ["haziran", 6],
  ["temmuz", 7],
  ["ağustos", 8],
  ["eylül", 9],
  ["ekim", 10],
  ["kasım", 11],
  ["aralık", 12],
]);

const priorityMap = new Map([
  ["kritik", "critical"],
  ["yüksek", "high"],
  ["orta", "medium"],
  ["düşük", "low"],
]);

function completionFromBody(body) {
  const candidates = String(body)
    .split(/\r?\n/)
    .filter((line) => /tamamlan|doğrulama/i.test(line));
  for (const line of candidates) {
    const match = line.match(
      /(\d{1,2})\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+(20\d{2})\s+(\d{1,2}):(\d{2})/iu,
    );
    if (!match) continue;
    const [, day, monthName, year, hour, minute] = match;
    const month = monthNumbers.get(monthName.toLocaleLowerCase("tr-TR"));
    if (!month) continue;
    return new Date(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00+03:00`,
    ).toISOString();
  }
  return null;
}

export function migrateRecord(data, body) {
  const priority =
    typeof data.priority === "string"
      ? priorityMap.get(data.priority.toLocaleLowerCase("tr-TR")) ||
        data.priority
      : null;
  return {
    ...data,
    schema_version: 2,
    scheduled_time: data.scheduled_time || null,
    priority,
    completed_at:
      data.status === "done"
        ? data.completed_at || completionFromBody(body)
        : null,
  };
}

export async function migrateWorkspace(workspace, { dryRun = false } = {}) {
  const changes = [];
  for (const path of await listRecordPaths(workspace)) {
    const raw = await readFile(path, "utf8");
    const { data, body } = parseRecord(raw);
    const migrated = migrateRecord(data, body);
    const next = serializeRecord(migrated, body);
    const errors = validateRecord(migrated);
    if (errors.length) throw new Error(`${data.key}: ${errors.join(", ")}`);
    if (next === raw) continue;
    changes.push({ key: migrated.key, path });
    if (!dryRun) await atomicWrite(path, next);
  }
  if (!dryRun && changes.length) await generateSummaries(workspace);
  return { workspace, dryRun, changed: changes.length, changes };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const workspaceArgument = process.argv.find((value) =>
    value.startsWith("--workspace="),
  );
  const workspace = resolve(
    workspaceArgument?.slice("--workspace=".length) ||
      process.env.SPRINTMARK_DATA_DIR ||
      process.cwd(),
  );
  const result = await migrateWorkspace(workspace, {
    dryRun: process.argv.includes("--dry-run"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

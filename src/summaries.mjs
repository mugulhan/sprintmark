import { resolve } from "node:path";
import { atomicWrite, loadRecords } from "./records.mjs";

const warning =
  "<!-- GENERATED FILE: Kaynak kayıtlar work-items/ altındadır. Bu dosyayı doğrudan düzenlemeyin. -->";

function taskLine(record) {
  const check = record.status === "done" ? "x" : " ";
  const date = record.scheduled_for ? ` — ${record.scheduled_for}` : "";
  return `- [${check}] **${record.key} — ${record.title}**${date}\n${record.body.trimEnd()}\n`;
}

export async function generateSummaries(workspace) {
  const records = await loadRecords(workspace);
  const tasks = records
    .filter((item) => item.kind === "task")
    .sort((a, b) => a.key.localeCompare(b.key));
  const backlog = records
    .filter((item) => item.kind === "backlog")
    .sort((a, b) => a.key.localeCompare(b.key));
  const todoText = `${warning}\n\n# Sprintmark Tasks\n\n${tasks.map(taskLine).join("\n")}`;
  const backlogText = `${warning}\n\n# Sprintmark Backlog\n\n${backlog.map(taskLine).join("\n")}`;
  await atomicWrite(resolve(workspace, "SPRINTMARK_TASKS.md"), todoText);
  await atomicWrite(resolve(workspace, "SPRINTMARK_BACKLOG.md"), backlogText);
  return { tasks: tasks.length, backlog: backlog.length };
}

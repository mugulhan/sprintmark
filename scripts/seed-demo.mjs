import { resolve } from "node:path";
import { ProjectStore } from "../src/projects.mjs";
import { WorkItemStore } from "../src/store.mjs";
import { SprintStore } from "../src/sprints.mjs";

const workspace = resolve(process.env.SPRINTMARK_DATA_DIR || "data");
const projects = new ProjectStore(workspace);
if ((await projects.all()).length) {
  console.log("A workspace already exists; demo seed skipped.");
  process.exit(0);
}

const project = await projects.create({
  name: "Website launch",
  code: "WEB",
  description: "A small sample project for exploring Sprintmark.",
});
const today = new Date().toLocaleDateString("sv-SE");
await new WorkItemStore(workspace).create({
  title: "Review launch checklist",
  project_key: project.key,
  key_prefix: project.code,
  priority: "high",
  scheduled_for: today,
  scheduled_time: "10:00",
  body: "## Acceptance criteria\n\n- [ ] Content approved\n- [ ] Monitoring ready\n",
});
await new SprintStore(workspace).create({
  name: "Launch sprint",
  project_key: project.key,
  key_prefix: project.code,
  start_date: today,
  end_date: today,
  status: "active",
});
console.log(`Demo project created in ${workspace}`);

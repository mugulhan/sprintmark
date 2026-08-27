import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkTrackerServer } from "../src/server.mjs";
import { WorkItemStore } from "../src/store.mjs";
import { ProjectStore } from "../src/projects.mjs";

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-server-"));
  await new ProjectStore(workspace).create({
    name: "Demo Project",
    code: "DEMO",
  });
  const store = new WorkItemStore(workspace);
  const item = await store.create({
    title: "Doktor profil şeması",
    kind: "task",
    project_key: "PRJ-001",
    key_prefix: "DEMO",
  });
  item.legacy_routes = ["/task/94"];
  const existing = await store.byUid(item.uid);
  const patchedRaw = { ...existing, legacy_routes: ["/task/94"] };
  const { saveRecord } = await import("../src/records.mjs");
  delete patchedRaw.body;
  delete patchedRaw._path;
  delete patchedRaw._etag;
  await saveRecord(workspace, patchedRaw, existing.body);
  const server = createWorkTrackerServer({ workspace });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    workspace,
    item: patchedRaw,
    base: `http://127.0.0.1:${address.port}`,
  };
}

test("canonical and legacy routes use permanent redirects and unknown keys return 404", async (context) => {
  const { server, item, base } = await fixture();
  context.after(() => server.close());
  const legacy = await fetch(`${base}/task/94`, { redirect: "manual" });
  assert.equal(legacy.status, 308);
  assert.equal(
    legacy.headers.get("location"),
    `/work-items/${item.key}/${item.slug}`,
  );
  const wrongSlug = await fetch(`${base}/work-items/${item.key}/eski-slug`, {
    redirect: "manual",
  });
  assert.equal(wrongSlug.status, 308);
  const missing = await fetch(`${base}/work-items/WORK-9999/missing`, {
    redirect: "manual",
  });
  assert.equal(missing.status, 404);
});

test("API returns ETags and rejects stale updates", async (context) => {
  const { server, item, base } = await fixture();
  context.after(() => server.close());
  const get = await fetch(`${base}/api/v1/work-items/${item.key}`);
  const etag = get.headers.get("etag");
  assert.ok(etag);
  const update = await fetch(`${base}/api/v1/work-items/${item.uid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ status: "done" }),
  });
  assert.equal(update.status, 200);
  const completed = await update.json();
  assert.equal(completed.status, "done");
  assert.ok(!Number.isNaN(Date.parse(completed.completed_at)));
  assert.equal(completed.completed_at, completed.updated_at);
  const stale = await fetch(`${base}/api/v1/work-items/${item.uid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ status: "open" }),
  });
  assert.equal(stale.status, 409);

  const reopenedResponse = await fetch(
    `${base}/api/v1/work-items/${item.uid}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": completed._etag,
      },
      body: JSON.stringify({ status: "open" }),
    },
  );
  assert.equal(reopenedResponse.status, 200);
  const reopened = await reopenedResponse.json();
  assert.equal(reopened.completed_at, null);
});

test("sprint API persists valid ranges and rejects reversed dates", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const created = await fetch(`${base}/api/v1/sprints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Planlama Sprinti",
      start_date: "2026-08-24",
      end_date: "2026-08-28",
    }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).key, "DEMO-SP-001");
  const list = await fetch(`${base}/api/v1/sprints`).then((response) =>
    response.json(),
  );
  assert.equal(list.count, 1);
  const invalid = await fetch(`${base}/api/v1/sprints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Ters",
      start_date: "2026-08-30",
      end_date: "2026-08-20",
    }),
  });
  assert.equal(invalid.status, 400);
});

test("project API isolates work items and sprint keys by project code", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const projectResponse = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mobil Uygulama", code: "MOBIL" }),
  });
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json();

  const workResponse = await fetch(`${base}/api/v1/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Mobil görev", project_key: project.key }),
  });
  assert.equal(workResponse.status, 201);
  const workItem = await workResponse.json();
  assert.equal(workItem.key, "MOBIL-0001");
  assert.equal(workItem.project_key, project.key);
  const genericRoute = await fetch(
    `${base}/work-items/${workItem.key}/yanlis-slug`,
    { redirect: "manual" },
  );
  assert.equal(genericRoute.status, 308);
  assert.equal(
    genericRoute.headers.get("location"),
    `/work-items/${workItem.key}/${workItem.slug}`,
  );

  const sprintResponse = await fetch(`${base}/api/v1/sprints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Mobil Sprint",
      project_key: project.key,
      start_date: "2026-09-01",
      end_date: "2026-09-05",
    }),
  });
  assert.equal(sprintResponse.status, 201);
  assert.equal((await sprintResponse.json()).key, "MOBIL-SP-001");

  const list = await fetch(
    `${base}/api/v1/work-items?project_key=${project.key}`,
  ).then((response) => response.json());
  assert.equal(list.count, 1);
  assert.equal(list.items[0].key, "MOBIL-0001");
});

test("project detail API and canonical routes enforce immutable identity and ETags", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const get = await fetch(`${base}/api/v1/projects/PRJ-001`);
  assert.equal(get.status, 200);
  const project = await get.json();
  const etag = get.headers.get("etag");
  assert.ok(etag);
  const updatedResponse = await fetch(
    `${base}/api/v1/projects/${project.uid}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", "if-match": etag },
      body: JSON.stringify({
        name: "Demo Platform",
        description: "Merkezi çalışma alanı",
        status: "active",
      }),
    },
  );
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.slug, "demo-platform");
  const wrongSlug = await fetch(`${base}/projects/PRJ-001/demo-project`, {
    redirect: "manual",
  });
  assert.equal(wrongSlug.status, 308);
  assert.equal(
    wrongSlug.headers.get("location"),
    "/projects/PRJ-001/demo-platform",
  );
  const immutable = await fetch(`${base}/api/v1/projects/${project.uid}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "if-match": updated._etag,
    },
    body: JSON.stringify({ code: "OTHER" }),
  });
  assert.equal(immutable.status, 400);
  const stale = await fetch(`${base}/api/v1/projects/${project.uid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ status: "archived" }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await fetch(`${base}/projects/PRJ-999/yok`)).status, 404);
});

test("rich editor assets are served locally", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  for (const path of [
    "/sprintmark-mark.svg",
    "/vendor/toastui-editor.js",
    "/vendor/toastui-editor.css",
    "/vendor/dompurify.js",
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(
      Number(response.headers.get("content-length")) >
        (path.endsWith(".svg") ? 500 : 1000),
      path,
    );
  }
});

test("draft multipart images are promoted into a new work item", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const draftResponse = await fetch(`${base}/api/v1/drafts`, {
    method: "POST",
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  const form = new globalThis.FormData();
  form.append(
    "file",
    new globalThis.Blob(
      [Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")],
      {
        type: "image/png",
      },
    ),
    "clipboard.png",
  );
  form.append("placement", "body");
  form.append("alt", "Architecture");
  const uploadedResponse = await fetch(
    `${base}/api/v1/drafts/${draft.id}/attachments`,
    { method: "POST", body: form },
  );
  assert.equal(uploadedResponse.status, 201);
  const uploaded = await uploadedResponse.json();
  const createResponse = await fetch(`${base}/api/v1/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Clipboard task",
      draft_id: draft.id,
      body: uploaded.markdown,
      priority: "high",
      scheduled_for: "2026-08-26",
      scheduled_time: "13:40",
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.attachments.length, 1);
  assert.equal(created.attachments[0].placement, "body");
  assert.match(created.body, new RegExp(`/attachments/${created.uid}/`));
  assert.equal(created.priority, "high");
  assert.equal(created.scheduled_time, "13:40");
  assert.equal(
    (await fetch(`${base}${created.attachments[0].url}`)).status,
    200,
  );
});

test("evidence API uploads and removes gallery images with ETags", async (context) => {
  const { server, item, base } = await fixture();
  context.after(() => server.close());
  const form = new globalThis.FormData();
  form.append(
    "file",
    new globalThis.Blob(
      [Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")],
      { type: "image/png" },
    ),
    "evidence.png",
  );
  form.append("placement", "evidence");
  const upload = await fetch(
    `${base}/api/v1/work-items/${item.uid}/attachments`,
    { method: "POST", body: form },
  );
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  assert.equal(uploaded.record.attachments.length, 1);
  const remove = await fetch(
    `${base}/api/v1/work-items/${item.uid}/attachments/${encodeURIComponent(uploaded.attachment.name)}`,
    {
      method: "DELETE",
      headers: { "if-match": upload.headers.get("etag") },
    },
  );
  assert.equal(remove.status, 200);
  assert.equal((await remove.json()).attachments.length, 0);
  assert.equal((await fetch(`${base}${uploaded.attachment.url}`)).status, 404);
});

test("evidence API opens text files inline and forces Office downloads", async (context) => {
  const { server, item, base } = await fixture();
  context.after(() => server.close());
  const csvForm = new globalThis.FormData();
  csvForm.append(
    "file",
    new globalThis.Blob(["old,new\n/a,/b\n"], { type: "text/csv" }),
    "redirects.csv",
  );
  csvForm.append("placement", "evidence");
  const csvUpload = await fetch(
    `${base}/api/v1/work-items/${item.uid}/attachments`,
    { method: "POST", body: csvForm },
  );
  assert.equal(csvUpload.status, 201);
  const csv = await csvUpload.json();
  const opened = await fetch(`${base}${csv.attachment.url}`);
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get("content-type"), /^text\/csv/);
  assert.match(opened.headers.get("content-disposition"), /^inline;/);
  assert.equal(await opened.text(), "old,new\n/a,/b\n");
  const downloaded = await fetch(`${base}${csv.attachment.url}?download=1`);
  assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
  assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");

  const xlsxForm = new globalThis.FormData();
  xlsxForm.append(
    "file",
    new globalThis.Blob([Buffer.from("504b030400000000", "hex")], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "report.xlsx",
  );
  xlsxForm.append("placement", "evidence");
  const xlsxUpload = await fetch(
    `${base}/api/v1/work-items/${item.uid}/attachments`,
    { method: "POST", body: xlsxForm },
  );
  assert.equal(xlsxUpload.status, 201);
  const xlsx = await xlsxUpload.json();
  const office = await fetch(`${base}${xlsx.attachment.url}`);
  assert.match(office.headers.get("content-disposition"), /^attachment;/);
});

test("workspace file references are discoverable, task-scoped and safe", async (context) => {
  const { server, workspace, base } = await fixture();
  context.after(() => server.close());
  const runDirectory = join(workspace, "data", "runs", "audit");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "result.json"), '{"valid":334}\n', "utf8");
  await writeFile(join(workspace, ".env"), "SECRET=value\n", "utf8");
  const store = new WorkItemStore(workspace);
  const referenced = await store.create({
    title: "Referans API",
    body: [
      "## Kanıtlar",
      "- `data/runs/audit/result.json`",
      "- `data/runs/audit/missing.csv`",
      "- `.env`",
    ].join("\n"),
  });
  const referencesResponse = await fetch(
    `${base}/api/v1/work-items/${referenced.uid}/file-references`,
  );
  assert.equal(referencesResponse.status, 200);
  const references = await referencesResponse.json();
  assert.equal(references.count, 2);
  assert.equal(references.items[0].exists, true);
  assert.equal(references.items[1].exists, false);
  const opened = await fetch(`${base}${references.items[0].url}`);
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get("content-type"), /^application\/json/);
  assert.equal(await opened.text(), '{"valid":334}\n');
  const downloaded = await fetch(`${base}${references.items[0].download_url}`);
  assert.match(downloaded.headers.get("content-disposition"), /^attachment;/);
  assert.equal(
    (
      await fetch(
        `${base}/work-item-files/${referenced.uid}?path=${encodeURIComponent(".env")}`,
      )
    ).status,
    404,
  );
  const unrelated = await store.create({ title: "İlişkisiz görev" });
  assert.equal(
    (
      await fetch(
        `${base}/work-item-files/${unrelated.uid}?path=${encodeURIComponent("data/runs/audit/result.json")}`,
      )
    ).status,
    404,
  );
});

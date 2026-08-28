import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const server = createWorkTrackerServer({
    workspace,
    authConfig: {
      mode: "local",
      sessionSecret: "test-only",
      localEmail: "test@sprintmark.invalid",
      localName: "Test admin",
      localAutoLogin: true,
      csrfDisabled: true,
    },
  });
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

test("disabled Google routes return an error without terminating local mode", async (context) => {
  const { server, base } = await fixture();
  context.after(() => server.close());
  const disabled = await fetch(`${base}/auth/google/start`, {
    redirect: "manual",
  });
  assert.equal(disabled.status, 404);
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", version: "0.10.0" });
});

test("local developer sign-out remains signed out until an explicit sign-in", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-local-auth-"));
  const server = createWorkTrackerServer({
    workspace,
    authConfig: {
      mode: "local",
      sessionSecret: "test-local-session-secret",
      localEmail: "local@sprintmark.invalid",
      localName: "Local developer",
      secureCookies: false,
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const signedOut = await fetch(`${base}/api/v1/session`);
  assert.equal(signedOut.status, 401);
  assert.deepEqual(await signedOut.json(), {
    error: "authentication_required",
    auth_mode: "local",
    login_url: "/auth/local/start",
  });

  const login = await fetch(`${base}/auth/local/start`, {
    redirect: "manual",
  });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get("location"), "/projects/");
  const sessionCookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("sprintmark_session="));
  assert.ok(sessionCookie);

  const active = await fetch(`${base}/api/v1/session`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(active.status, 200);
  const activeSession = await active.json();
  assert.equal(activeSession.auth_mode, "local");
  assert.equal(activeSession.user.display_name, "Local developer");

  const logout = await fetch(`${base}/api/v1/logout`, {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      "x-csrf-token": activeSession.csrf_token,
    },
  });
  assert.equal(logout.status, 204);

  const afterLogout = await fetch(`${base}/api/v1/session`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(afterLogout.status, 401);
});

test("first-run setup is loopback-only, CSRF-bound and activates local auth", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-first-run-"));
  const configPath = join(workspace, ".env.local");
  const server = createWorkTrackerServer({
    workspace,
    setup: {
      enabled: true,
      host: "127.0.0.1",
      port: 4310,
      baseUrl: "http://127.0.0.1:4310",
      configPath,
      dataDir: "./data",
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const session = await fetch(`${base}/api/v1/session`);
  assert.equal(session.status, 428);
  assert.deepEqual(await session.json(), {
    error: "setup_required",
    setup_url: "/api/v1/setup",
  });

  const challengeResponse = await fetch(`${base}/api/v1/setup`);
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  const setupCookie = challengeResponse.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("sprintmark_setup="));
  assert.ok(challenge.setup_token);
  assert.ok(setupCookie);
  assert.equal(
    challenge.redirect_uri,
    "http://127.0.0.1:4310/auth/google/callback",
  );

  const rejected = await fetch(`${base}/api/v1/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "local" }),
  });
  assert.equal(rejected.status, 403);

  const invalidConfiguration = await fetch(`${base}/api/v1/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-setup-token": challenge.setup_token,
      cookie: setupCookie,
      origin: base,
    },
    body: JSON.stringify({ mode: "google" }),
  });
  assert.equal(invalidConfiguration.status, 400);

  const completed = await fetch(`${base}/api/v1/setup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-setup-token": challenge.setup_token,
      cookie: setupCookie,
      origin: base,
    },
    body: JSON.stringify({
      mode: "local",
      local_name: "First-run admin",
      local_email: "admin@sprintmark.invalid",
      locale: "en",
      timezone: "Europe/Istanbul",
    }),
  });
  assert.equal(completed.status, 201);
  const result = await completed.json();
  assert.deepEqual(result, {
    configured: true,
    auth_mode: "local",
    login_url: "/auth/local/start",
  });
  assert.doesNotMatch(JSON.stringify(result), /SESSION_SECRET|client_secret/i);
  const persisted = await readFile(configPath, "utf8");
  assert.match(persisted, /SPRINTMARK_AUTH_MODE="local"/);
  assert.match(persisted, /SPRINTMARK_LOCAL_USER_NAME="First-run admin"/);
  assert.match(persisted, /SESSION_SECRET="[^"]{32,}"/);

  const repeat = await fetch(`${base}/api/v1/setup`);
  assert.equal(repeat.status, 409);
  const login = await fetch(`${base}${result.login_url}`, {
    redirect: "manual",
  });
  assert.equal(login.status, 302);
});

test("first-run setup cannot be exposed for a non-loopback host", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-remote-setup-"));
  const server = createWorkTrackerServer({
    workspace,
    setup: {
      enabled: true,
      host: "0.0.0.0",
      port: 4310,
      configPath: join(workspace, ".env.local"),
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/v1/setup`,
  );
  assert.equal(response.status, 403);
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
    body: JSON.stringify({ status: "in_progress", assignee_id: "usr-local" }),
  });
  assert.equal(update.status, 200);
  const started = await update.json();
  const completionResponse = await fetch(
    `${base}/api/v1/work-items/${item.uid}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "if-match": started._etag,
      },
      body: JSON.stringify({ status: "done" }),
    },
  );
  assert.equal(completionResponse.status, 200);
  const completed = await completionResponse.json();
  assert.equal(completed.status, "done");
  assert.ok(!Number.isNaN(Date.parse(completed.completed_at)));
  assert.equal(completed.completed_at, completed.updated_at);
  assert.deepEqual(
    completed.activities.at(-1).changes.map((change) => change.field),
    ["status"],
  );
  const stale = await fetch(`${base}/api/v1/work-items/${item.uid}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ status: "in_progress" }),
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
      body: JSON.stringify({
        status: "in_progress",
        transition_note: "A new problem was found.",
      }),
    },
  );
  assert.equal(reopenedResponse.status, 200);
  const reopened = await reopenedResponse.json();
  assert.equal(reopened.completed_at, null);
});

test("activity API appends notes and returns the updated work item", async (context) => {
  const { server, item, base } = await fixture();
  context.after(() => server.close());
  const currentResponse = await fetch(`${base}/api/v1/work-items/${item.key}`);
  const current = await currentResponse.json();
  const response = await fetch(
    `${base}/api/v1/work-items/${item.uid}/activities`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": current._etag,
      },
      body: JSON.stringify({ body: "Release completed." }),
    },
  );
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.activity.type, "comment");
  assert.equal(result.record.activities.at(-1).body, "Release completed.");
  assert.equal(response.headers.get("etag"), result.record._etag);

  const stale = await fetch(
    `${base}/api/v1/work-items/${item.uid}/activities`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": current._etag,
      },
      body: JSON.stringify({ body: "Stale comment" }),
    },
  );
  assert.equal(stale.status, 409);

  const collection = await fetch(`${base}/api/v1/work-items`).then((result) =>
    result.json(),
  );
  assert.equal(Object.hasOwn(collection.items[0], "activities"), false);
  const detail = await fetch(`${base}/api/v1/work-items/${item.key}`).then(
    (result) => result.json(),
  );
  assert.ok(detail.activities.length >= 2);
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
  const home = await fetch(`${base}/`, { redirect: "manual" });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/projects/PRJ-001/demo-platform");
  assert.equal((await fetch(`${base}/projects/`)).status, 200);
  assert.equal((await fetch(`${base}/calendar`)).status, 200);
  assert.equal((await fetch(`${base}/backlog`)).status, 200);
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

test("project documents can link, preview, upload, download and remove safely", async (context) => {
  const { server, workspace, base } = await fixture();
  context.after(() => server.close());
  await writeFile(
    join(workspace, "YENIWEB_MIMARISI.md"),
    "# Yeniweb Mimarisi\n\n## Yayın modeli\n",
    "utf8",
  );
  const projectResponse = await fetch(`${base}/api/v1/projects/PRJ-001`);
  const project = await projectResponse.json();
  const linkedResponse = await fetch(
    `${base}/api/v1/projects/${project.uid}/document-references`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "if-match": projectResponse.headers.get("etag"),
      },
      body: JSON.stringify({ path: "YENIWEB_MIMARISI.md" }),
    },
  );
  assert.equal(linkedResponse.status, 201);
  const linked = await linkedResponse.json();
  const documentsResponse = await fetch(
    `${base}/api/v1/projects/${project.uid}/documents`,
  );
  const documents = await documentsResponse.json();
  assert.equal(documents.count, 1);
  assert.equal(documents.items[0].path, "YENIWEB_MIMARISI.md");
  const preview = await fetch(`${base}${documents.items[0].url}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-type"), /^text\/markdown/);
  assert.match(preview.headers.get("content-disposition"), /^inline;/);
  assert.match(await preview.text(), /Yayın modeli/);
  const unsafe = await fetch(
    `${base}/project-files/${project.uid}?path=${encodeURIComponent("../secret.md")}`,
  );
  assert.equal(unsafe.status, 404);

  const form = new globalThis.FormData();
  form.append(
    "file",
    new globalThis.Blob(['{"status":"ok"}\n'], {
      type: "application/json",
    }),
    "architecture.json",
  );
  const upload = await fetch(
    `${base}/api/v1/projects/${project.uid}/documents`,
    {
      method: "POST",
      headers: { "if-match": linked._etag },
      body: form,
    },
  );
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  const afterUpload = await fetch(
    `${base}/api/v1/projects/${project.uid}/documents`,
  ).then((response) => response.json());
  assert.equal(afterUpload.count, 2);
  const uploadedDocument = afterUpload.items[1];
  const download = await fetch(`${base}${uploadedDocument.download_url}`);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  const remove = await fetch(
    `${base}/api/v1/projects/${project.uid}/documents/1`,
    {
      method: "DELETE",
      headers: { "if-match": uploaded.project._etag },
    },
  );
  assert.equal(remove.status, 200);
  assert.equal((await remove.json()).documents.length, 1);
  assert.equal((await fetch(`${base}${uploadedDocument.url}`)).status, 404);
});

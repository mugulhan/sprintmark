import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { AuthService } from "../src/auth.mjs";
import { CollaborationStore } from "../src/collaboration.mjs";
import {
  assertProjectAccess,
  assertWorkflowTransition,
  projectRole,
} from "../src/policy.mjs";
import { migrateCollaboration } from "../scripts/migrate-collaboration-v3.mjs";
import { ProjectStore } from "../src/projects.mjs";
import { WorkItemStore } from "../src/store.mjs";

function responseCapture() {
  return {
    status: null,
    headers: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end() {},
  };
}

test("Google OAuth uses state, PKCE and an invited verified identity", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-auth-"));
  const collaboration = new CollaborationStore(workspace);
  const google = {
    authorizationUrl(input) {
      this.input = input;
      return `https://accounts.google.test/auth?state=${input.state}`;
    },
    async exchangeAndVerify(code, verifier, nonce) {
      assert.equal(code, "code-1");
      assert.equal(verifier, this.input.verifier);
      assert.equal(nonce, this.input.nonce);
      return {
        sub: "google-sub-1",
        email: "owner@example.com",
        email_verified: true,
        name: "Project Owner",
      };
    },
  };
  const auth = new AuthService({
    workspace,
    collaboration,
    googleClient: google,
    config: {
      mode: "google",
      sessionSecret: "a-test-secret",
      bootstrapAdminEmails: "owner@example.com",
      secureCookies: false,
      baseUrl: "http://127.0.0.1:4310",
    },
  });
  await auth.initialize();
  const start = responseCapture();
  await auth.startGoogle(start);
  assert.equal(start.status, 302);
  assert.ok(google.input.verifier.length > 40);
  assert.ok(google.input.nonce);
  const oauthCookie = start.headers["Set-Cookie"].split(";")[0];
  const callback = responseCapture();
  await auth.finishGoogle(
    { headers: { cookie: oauthCookie } },
    callback,
    new URL(
      `http://127.0.0.1/auth/google/callback?state=${google.input.state}&code=code-1`,
    ),
  );
  assert.equal(callback.status, 302);
  const sessionCookie = callback.headers["Set-Cookie"][0].split(";")[0];
  const session = await auth.session({ headers: { cookie: sessionCookie } });
  assert.equal(session.user.google_sub, "google-sub-1");
  assert.equal(session.user.system_role, "admin");
});

test("project roles include global teams but keep settings owner-only", async () => {
  const owner = { id: "usr-owner", status: "active", system_role: "user" };
  const lead = { id: "usr-lead", status: "active", system_role: "user" };
  const viewer = { id: "usr-viewer", status: "active", system_role: "user" };
  const project = {
    owner_user_id: owner.id,
    members: [{ user_id: viewer.id, role: "viewer" }],
    team_ids: ["team-web"],
  };
  const directory = {
    teams: [
      {
        id: "team-web",
        member_user_ids: [lead.id],
        lead_user_ids: [lead.id],
      },
    ],
  };
  assert.equal(projectRole(project, owner, directory), "owner");
  assert.equal(projectRole(project, lead, directory), "member");
  assert.equal(projectRole(project, viewer, directory), "viewer");
  assert.throws(
    () => assertProjectAccess(project, viewer, directory, "member"),
    (error) => error.statusCode === 403,
  );
});

test("workflow enforces assignment, conditional review and explanatory notes", () => {
  const user = { id: "usr-worker" };
  assert.throws(
    () =>
      assertWorkflowTransition(
        { status: "planned", assignee_id: null, reviewer_id: null },
        { status: "in_progress" },
        user,
        "member",
      ),
    /assignee is required/,
  );
  assert.throws(
    () =>
      assertWorkflowTransition(
        {
          status: "review",
          assignee_id: "usr-worker",
          reviewer_id: "usr-reviewer",
        },
        { status: "done" },
        user,
        "member",
      ),
    /reviewer approval/,
  );
  assert.throws(
    () =>
      assertWorkflowTransition(
        {
          status: "done",
          assignee_id: "usr-worker",
          reviewer_id: null,
        },
        { status: "in_progress" },
        user,
        "member",
      ),
    /transition note/,
  );
});

test("notifications are idempotent per event and recipient", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-notify-"));
  const store = new CollaborationStore(workspace);
  const event = {
    event_id: "event-1",
    actor_id: "usr-owner",
    type: "assignment",
    title: "Assigned",
    url: "/work-items/DEMO-0001/task",
  };
  assert.ok(await store.addNotification("usr-worker", event));
  assert.equal(await store.addNotification("usr-worker", event), null);
  assert.equal((await store.notifications("usr-worker")).items.length, 1);
});

test("collaboration migration has a write-free dry-run, backup and idempotency", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-migrate-"));
  const project = await new ProjectStore(workspace).create({
    name: "Migration",
    code: "MIG",
  });
  const item = await new WorkItemStore(workspace).create({
    title: "Legacy-compatible item",
    project_key: project.key,
    key_prefix: project.code,
  });
  const itemPath = join(workspace, "work-items", "tasks", "mig-0001.md");
  const raw = await readFile(itemPath, "utf8");
  const legacy = raw
    .replace("schema_version: 3", "schema_version: 2")
    .replace("status: planned", "status: open")
    .replace(/team_id:.*\n/, "team: content-technical\n")
    .replace(/reporter_id:.*\n/, "")
    .replace(/assignee_id:.*\n/, "")
    .replace(/reviewer_id:.*\n/, "")
    .replace(/follower_ids:.*\n/, "");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(itemPath, legacy),
  );
  const dry = await migrateCollaboration({ workspace });
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.work_items_to_migrate, 1);
  await assert.rejects(() =>
    access(join(workspace, "work-items", "collaboration.yml")),
  );
  const applied = await migrateCollaboration({ workspace, apply: true });
  assert.ok(applied.backup);
  const migrated = await new WorkItemStore(workspace).byUid(item.uid);
  assert.equal(migrated.schema_version, 3);
  assert.equal(migrated.status, "planned");
  const second = await migrateCollaboration({ workspace, apply: false });
  assert.equal(second.work_items_to_migrate, 0);
  assert.equal(
    YAML.parse(
      await readFile(
        join(workspace, "work-items", "collaboration.yml"),
        "utf8",
      ),
    ).users.length,
    1,
  );
});

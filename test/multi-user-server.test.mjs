import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkTrackerServer } from "../src/server.mjs";

function cookieValue(response, name) {
  const cookies = response.headers.getSetCookie();
  return cookies
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith(`${name}=`));
}

async function signIn(base, code) {
  const start = await fetch(`${base}/auth/google/start`, {
    redirect: "manual",
  });
  const oauthCookie = cookieValue(start, "sprintmark_oauth_state");
  const state = new URL(start.headers.get("location")).searchParams.get(
    "state",
  );
  const callback = await fetch(
    `${base}/auth/google/callback?state=${state}&code=${code}`,
    { headers: { cookie: oauthCookie }, redirect: "manual" },
  );
  assert.equal(callback.status, 302);
  const sessionCookie = cookieValue(callback, "sprintmark_session");
  const sessionResponse = await fetch(`${base}/api/v1/session`, {
    headers: { cookie: sessionCookie },
  });
  return { cookie: sessionCookie, session: await sessionResponse.json() };
}

function writeHeaders(identity, extra = {}) {
  return {
    cookie: identity.cookie,
    "x-csrf-token": identity.session.csrf_token,
    "content-type": "application/json",
    ...extra,
  };
}

test("two invited users complete assignment, review and notification flow", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-multi-user-"));
  const claims = {
    owner: {
      sub: "google-owner",
      email: "owner@example.com",
      email_verified: true,
      name: "Owner",
    },
    member: {
      sub: "google-member",
      email: "member@example.com",
      email_verified: true,
      name: "Member",
    },
  };
  const googleClient = {
    authorizationUrl({ state }) {
      return `https://accounts.google.test/auth?state=${state}`;
    },
    async exchangeAndVerify(code) {
      return claims[code];
    },
  };
  const server = createWorkTrackerServer({
    workspace,
    googleClient,
    authConfig: {
      mode: "google",
      clientId: "client",
      clientSecret: "secret",
      sessionSecret: "test-session-secret",
      baseUrl: "http://127.0.0.1",
      secureCookies: false,
      bootstrapAdminEmails: "owner@example.com,member@example.com",
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = await signIn(base, "owner");
  const member = await signIn(base, "member");

  const denied = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Denied", code: "NOPE" }),
  });
  assert.equal(denied.status, 403);

  const projectResponse = await fetch(`${base}/api/v1/projects`, {
    method: "POST",
    headers: writeHeaders(owner),
    body: JSON.stringify({ name: "Collaboration", code: "COLLAB" }),
  });
  assert.equal(projectResponse.status, 201);
  const project = await projectResponse.json();
  const membershipResponse = await fetch(
    `${base}/api/v1/projects/${project.uid}/members`,
    {
      method: "PATCH",
      headers: writeHeaders(owner, { "if-match": project._etag }),
      body: JSON.stringify({
        members: [{ user_id: member.session.user.id, role: "member" }],
        team_ids: [],
      }),
    },
  );
  assert.equal(membershipResponse.status, 200);

  const createResponse = await fetch(`${base}/api/v1/work-items`, {
    method: "POST",
    headers: writeHeaders(member),
    body: JSON.stringify({
      title: "Reviewed work",
      project_key: project.key,
      team_id: null,
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.reporter_id, member.session.user.id);

  const assignedResponse = await fetch(
    `${base}/api/v1/work-items/${created.uid}`,
    {
      method: "PATCH",
      headers: writeHeaders(owner, { "if-match": created._etag }),
      body: JSON.stringify({
        assignee_id: member.session.user.id,
        reviewer_id: owner.session.user.id,
      }),
    },
  );
  assert.equal(assignedResponse.status, 200);
  const assigned = await assignedResponse.json();

  const startedResponse = await fetch(
    `${base}/api/v1/work-items/${created.uid}`,
    {
      method: "PATCH",
      headers: writeHeaders(member, { "if-match": assigned._etag }),
      body: JSON.stringify({ status: "in_progress" }),
    },
  );
  assert.equal(startedResponse.status, 200);
  const started = await startedResponse.json();
  const reviewResponse = await fetch(
    `${base}/api/v1/work-items/${created.uid}`,
    {
      method: "PATCH",
      headers: writeHeaders(member, { "if-match": started._etag }),
      body: JSON.stringify({ status: "review" }),
    },
  );
  assert.equal(reviewResponse.status, 200);
  const review = await reviewResponse.json();
  const doneResponse = await fetch(`${base}/api/v1/work-items/${created.uid}`, {
    method: "PATCH",
    headers: writeHeaders(owner, { "if-match": review._etag }),
    body: JSON.stringify({ status: "done" }),
  });
  assert.equal(doneResponse.status, 200);
  const done = await doneResponse.json();
  assert.equal(done.status, "done");
  assert.equal(done.activities.at(-1).actor.id, owner.session.user.id);

  const ownerNotifications = await fetch(`${base}/api/v1/notifications`, {
    headers: { cookie: owner.cookie },
  }).then((response) => response.json());
  const memberNotifications = await fetch(`${base}/api/v1/notifications`, {
    headers: { cookie: member.cookie },
  }).then((response) => response.json());
  assert.ok(ownerNotifications.items.some((item) => item.type === "review"));
  assert.ok(
    memberNotifications.items.some((item) => item.type === "assignment"),
  );

  const usersResponse = await fetch(`${base}/api/v1/users`, {
    headers: { cookie: owner.cookie },
  });
  const directoryEtag = usersResponse.headers.get("etag");
  const users = await usersResponse.json();
  assert.ok(
    users.invitations.some((invitation) => invitation.status === "accepted"),
  );
  const suspendedResponse = await fetch(
    `${base}/api/v1/users/${member.session.user.id}`,
    {
      method: "PATCH",
      headers: writeHeaders(owner, { "if-match": directoryEtag }),
      body: JSON.stringify({ status: "suspended" }),
    },
  );
  assert.equal(suspendedResponse.status, 200);
  const expiredMemberSession = await fetch(`${base}/api/v1/session`, {
    headers: { cookie: member.cookie },
  });
  assert.equal(expiredMemberSession.status, 401);
});

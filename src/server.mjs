import { createReadStream } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Busboy from "busboy";
import { WorkItemStore } from "./store.mjs";
import { DraftStore } from "./drafts.mjs";
import { newUid } from "./identity.mjs";
import { gitMeta } from "./git-meta.mjs";
import { ProjectStore } from "./projects.mjs";
import { SprintStore } from "./sprints.mjs";
import { FILE_LIMIT, fileTypeForName } from "./files.mjs";
import { CollaborationStore } from "./collaboration.mjs";
import { buildProjectInsights } from "./insights.mjs";
import { AuthService, authConfigFromEnv, parseCookies } from "./auth.mjs";
import {
  buildAuthEnvironment,
  hasExplicitAuthConfiguration,
  isLoopbackAddress,
  isLoopbackHost,
  writeAuthEnvironment,
} from "./setup-config.mjs";
import {
  assertAssignmentHandoff,
  assertProjectAccess,
  assertWorkItemEdit,
  assertWorkflowTransition,
  projectRole,
  visibleProjects,
} from "./policy.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultWorkspace = resolve(appRoot, "data");
const publicRoot = resolve(appRoot, "public");
const toastUiBundle = resolve(appRoot, "dist", "vendor", "toastui-editor.js");
const toastUiRoot = resolve(
  appRoot,
  "node_modules",
  "@toast-ui",
  "editor",
  "dist",
);
const domPurifyRoot = resolve(appRoot, "node_modules", "dompurify", "dist");
const VERSION = "0.10.0";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function send(res, status, body, headers = {}) {
  const content =
    typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(content);
}

async function jsonBody(req, limit = 10 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit)
      throw Object.assign(new Error("request too large"), { statusCode: 413 });
    parts.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON"), { statusCode: 400 });
  }
}

function multipartBody(req) {
  return new Promise((resolveBody, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { fileSize: FILE_LIMIT, files: 1, fields: 12 },
      });
    } catch {
      reject(
        Object.assign(new Error("invalid multipart request"), {
          statusCode: 400,
        }),
      );
      return;
    }
    const fields = {};
    let file = null;
    let failed = false;
    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("file", (_name, stream, info) => {
      const parts = [];
      let truncated = false;
      stream.on("limit", () => {
        truncated = true;
      });
      stream.on("data", (part) => parts.push(part));
      stream.on("end", () => {
        if (truncated) {
          failed = true;
          reject(
            Object.assign(new Error("file must not exceed 25 MB"), {
              statusCode: 413,
            }),
          );
          return;
        }
        file = {
          name: info.filename,
          type: info.mimeType,
          data: Buffer.concat(parts),
        };
      });
    });
    parser.on("error", (error) => {
      failed = true;
      reject(Object.assign(error, { statusCode: 400 }));
    });
    parser.on("finish", () => {
      if (!failed) resolveBody({ fields, file });
    });
    req.pipe(parser);
  });
}

async function attachmentBody(req) {
  if (
    String(req.headers["content-type"] || "").startsWith("multipart/form-data")
  )
    return multipartBody(req);
  const body = await jsonBody(req, 35 * 1024 * 1024);
  return {
    fields: body,
    file: {
      name: body.name,
      type: body.type,
      data: Buffer.from(
        String(body.data || "").replace(/^data:[^;]+;base64,/, ""),
        "base64",
      ),
    },
  };
}

function publicRecord(record, { includeActivities = true } = {}) {
  const safe = { ...record };
  delete safe._path;
  if (!includeActivities) delete safe.activities;
  return safe;
}

function publicProject(project, { includeActivities = true } = {}) {
  const safe = { ...project };
  delete safe._path;
  if (!includeActivities) delete safe.activities;
  return safe;
}

function collaboratorSummary(user) {
  return {
    id: user.id,
    display_name: user.display_name,
    avatar_url: user.avatar_url || null,
    status: user.status,
  };
}

function contentDisposition(filename, disposition) {
  const safeName = basename(filename || "download");
  const asciiName = safeName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

async function streamFile(res, path, statusCode = 200, options = {}) {
  try {
    const info = await stat(path);
    const fileType = fileTypeForName(options.filename || path);
    const headers = {
      "Content-Type":
        options.contentType ||
        types[extname(path).toLowerCase()] ||
        fileType.type,
      "Content-Length": info.size,
      "X-Content-Type-Options": "nosniff",
    };
    if (options.filename) {
      const disposition =
        options.download || options.inline === false ? "attachment" : "inline";
      headers["Content-Disposition"] = contentDisposition(
        options.filename,
        disposition,
      );
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(statusCode, {
      ...headers,
    });
    createReadStream(path).pipe(res);
  } catch {
    send(res, 404, { error: "not_found" });
  }
}

function writeAllowed(req) {
  const origin = req.headers.origin;
  return (
    !origin || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)
  );
}

const SETUP_COOKIE = "sprintmark_setup";
const SETUP_TOKEN_TTL = 10 * 60 * 1000;

function setupCookie(value, clear = false) {
  return [
    `${SETUP_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    clear ? "Max-Age=0" : `Max-Age=${SETUP_TOKEN_TTL / 1000}`,
  ].join("; ");
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

async function notifyMentions(
  collaboration,
  directory,
  actor,
  activity,
  record,
  text,
) {
  const mentioned = new Set(
    [...String(text || "").matchAll(/user:(usr-[0-9a-z-]+)/gi)].map(
      (match) => match[1],
    ),
  );
  for (const userId of mentioned) {
    if (!directory.users.some((user) => user.id === userId)) continue;
    await collaboration.addNotification(userId, {
      event_id: activity.id,
      actor_id: actor.id,
      type: "mention",
      title: `${actor.display_name} mentioned you in ${record.key}`,
      url: `/work-items/${record.key}/${record.slug}`,
      created_at: activity.created_at,
    });
  }
}

async function notifyWorkItemChanges(collaboration, actor, previous, record) {
  const activity = record.activities.at(-1);
  const recipients = new Map();
  if (record.assignee_id && record.assignee_id !== previous.assignee_id)
    recipients.set(record.assignee_id, "assignment");
  if (record.reviewer_id && record.reviewer_id !== previous.reviewer_id)
    recipients.set(record.reviewer_id, "review");
  if (record.status === "review" && record.reviewer_id)
    recipients.set(record.reviewer_id, "review");
  for (const followerId of record.follower_ids || [])
    recipients.set(followerId, "following");
  for (const [userId, type] of recipients) {
    await collaboration.addNotification(userId, {
      event_id: activity.id,
      actor_id: actor.id,
      type,
      title: `${record.key}: ${record.title}`,
      url: `/work-items/${record.key}/${record.slug}`,
      created_at: activity.created_at,
    });
  }
}

function assertCollaborators(project, input, directory) {
  if (
    input.team_id &&
    (!directory.teams.some((team) => team.id === input.team_id) ||
      !project.team_ids.includes(input.team_id))
  )
    throw Object.assign(new Error("work item team is unknown"), {
      statusCode: 400,
    });
  const userIds = [
    input.assignee_id,
    input.reviewer_id,
    ...(input.follower_ids || []),
  ].filter(Boolean);
  for (const userId of userIds) {
    const user = directory.users.find(
      (candidate) => candidate.id === userId && candidate.status === "active",
    );
    if (!user || !projectRole(project, user, directory))
      throw Object.assign(
        new Error("work item collaborator cannot access this project"),
        { statusCode: 400 },
      );
  }
}

export function createWorkTrackerServer({
  workspace = defaultWorkspace,
  authConfig = null,
  googleClient = null,
  setup = null,
} = {}) {
  const store = new WorkItemStore(workspace);
  const draftStore = new DraftStore(workspace);
  const projectStore = new ProjectStore(workspace);
  const sprintStore = new SprintStore(workspace);
  const collaboration = new CollaborationStore(workspace);
  const setupEnabled = Boolean(setup?.enabled);
  let setupRequired = setupEnabled;
  let setupChallenge = null;
  let resolvedAuthConfig = setupRequired
    ? null
    : authConfig || authConfigFromEnv();
  let auth = resolvedAuthConfig
    ? new AuthService({
        workspace,
        collaboration,
        config: resolvedAuthConfig,
        googleClient,
      })
    : null;
  let initialized = auth ? auth.initialize() : Promise.resolve();
  const setupHost = setup?.host || "127.0.0.1";
  const setupPort = Number(setup?.port || 4310);
  const setupBaseUrl =
    setup?.baseUrl ||
    `http://${setupHost === "::1" ? "localhost" : setupHost}:${setupPort}`;
  const setupPath = setup?.configPath || resolve(appRoot, ".env.local");

  function assertSetupRequest(req) {
    if (!setupRequired)
      throw Object.assign(new Error("setup is already complete"), {
        statusCode: 409,
      });
    if (
      !isLoopbackHost(setupHost) ||
      !isLoopbackAddress(req.socket.remoteAddress)
    )
      throw Object.assign(new Error("setup is available only on loopback"), {
        statusCode: 403,
      });
  }

  async function completeSetup(req, res) {
    assertSetupRequest(req);
    if (!writeAllowed(req))
      return send(res, 403, { error: "origin_not_allowed" });
    const headerToken = req.headers["x-setup-token"];
    const cookieToken = parseCookies(req.headers.cookie)[SETUP_COOKIE];
    if (
      !setupChallenge ||
      setupChallenge.expiresAt < Date.now() ||
      !safeTokenEqual(headerToken, cookieToken) ||
      !safeTokenEqual(headerToken, setupChallenge.token)
    )
      return send(res, 403, { error: "invalid_setup_token" });
    const body = await jsonBody(req, 64 * 1024);
    let built;
    try {
      built = buildAuthEnvironment({
        mode: body.mode,
        clientId: body.client_id,
        clientSecret: body.client_secret,
        adminEmails: body.admin_emails,
        localName: body.local_name,
        localEmail: body.local_email,
        baseUrl: setupBaseUrl,
        host: setupHost,
        port: String(setupPort),
        dataDir: setup?.dataDir || "./data",
        timezone: body.timezone || "Europe/Istanbul",
        locale: body.locale || "en",
      });
    } catch (error) {
      error.statusCode = 400;
      throw error;
    }
    const nextConfig = authConfigFromEnv(
      setupHost,
      setupPort,
      built.environment,
    );
    const nextAuth = new AuthService({
      workspace,
      collaboration,
      config: nextConfig,
      googleClient,
    });
    await nextAuth.initialize();
    await writeAuthEnvironment(setupPath, built.environment);
    for (const [key, value] of Object.entries(built.environment))
      process.env[key] = value;
    auth = nextAuth;
    resolvedAuthConfig = nextConfig;
    initialized = Promise.resolve();
    setupRequired = false;
    setupChallenge = null;
    return send(
      res,
      201,
      {
        configured: true,
        auth_mode: nextConfig.mode,
        login_url:
          nextConfig.mode === "local"
            ? "/auth/local/start"
            : "/auth/google/start",
        redirect_uri:
          nextConfig.mode === "google" ? built.redirectUri : undefined,
      },
      { "Set-Cookie": setupCookie("", true) },
    );
  }

  return createServer(async (req, res) => {
    try {
      await initialized;
      const url = new URL(req.url, "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);
      if (path === "/healthz")
        return send(res, 200, {
          status: "ok",
          version: VERSION,
          ...(setupRequired ? { setup_required: true } : {}),
        });
      if (path === "/api/v1/setup" && req.method === "GET") {
        assertSetupRequest(req);
        const token = randomBytes(32).toString("base64url");
        setupChallenge = { token, expiresAt: Date.now() + SETUP_TOKEN_TTL };
        return send(
          res,
          200,
          {
            setup_required: true,
            setup_token: token,
            base_url: setupBaseUrl,
            redirect_uri: `${setupBaseUrl}/auth/google/callback`,
            defaults: {
              mode: "local",
              local_name: "Local user",
              local_email: "local@sprintmark.invalid",
              timezone: "Europe/Istanbul",
              locale: "en",
            },
          },
          { "Set-Cookie": setupCookie(token) },
        );
      }
      if (path === "/api/v1/setup" && req.method === "POST")
        return await completeSetup(req, res);
      if (setupRequired && path === "/api/v1/session" && req.method === "GET")
        return send(res, 428, {
          error: "setup_required",
          setup_url: "/api/v1/setup",
        });
      if (setupRequired && path.startsWith("/auth/"))
        return send(res, 409, { error: "setup_required" });
      if (path === "/auth/local/start" && req.method === "GET")
        return await auth.startLocal(res);
      if (path === "/auth/google/start" && req.method === "GET")
        return await auth.startGoogle(res);
      if (path === "/auth/google/callback" && req.method === "GET")
        return await auth.finishGoogle(req, res, url);
      const session = auth ? await auth.session(req) : null;
      if (path === "/api/v1/session" && req.method === "GET")
        return session
          ? send(res, 200, {
              user: session.user,
              csrf_token: session.csrf_token,
              auth_mode: session.mode,
              expires_at: session.expires_at,
            })
          : send(res, 401, {
              error: "authentication_required",
              auth_mode: resolvedAuthConfig.mode,
              login_url:
                resolvedAuthConfig.mode === "local"
                  ? "/auth/local/start"
                  : "/auth/google/start",
            });
      if (path === "/api/v1/logout" && req.method === "POST") {
        auth.assertCsrf(req, session);
        return auth.logout(req, res);
      }
      const protectedResource =
        path.startsWith("/api/v1/") ||
        path.startsWith("/attachments/") ||
        path.startsWith("/draft-attachments/") ||
        path.startsWith("/work-item-files/") ||
        path.startsWith("/project-documents/") ||
        path.startsWith("/project-files/");
      if (protectedResource && !session)
        return send(res, 401, { error: "authentication_required" });
      if (
        !session &&
        (path === "/" ||
          /^\/work-items\//.test(path) ||
          /^\/projects\/PRJ-\d{3}/i.test(path))
      )
        return streamFile(res, resolve(publicRoot, "index.html"));
      if (
        protectedResource &&
        !["GET", "HEAD", "OPTIONS"].includes(req.method)
      ) {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        auth.assertCsrf(req, session);
      }
      const directory = session ? await collaboration.read() : null;
      if (path === "/api/v1/meta")
        return send(res, 200, {
          version: VERSION,
          timezone:
            process.env.SPRINTMARK_TIMEZONE ||
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          default_locale: process.env.SPRINTMARK_DEFAULT_LOCALE || "en",
          ...(await gitMeta(workspace)),
        });
      if (path === "/api/v1/users" && req.method === "GET") {
        const result = await collaboration.users();
        const activeUsers = result.items.filter(
          (user) => user.status === "active",
        );
        return send(
          res,
          200,
          {
            items:
              session.user.system_role === "admin"
                ? activeUsers
                : activeUsers.map(collaboratorSummary),
            invitations:
              session.user.system_role === "admin"
                ? result.invitations
                : undefined,
          },
          { ETag: result._etag },
        );
      }
      if (path === "/api/v1/invitations" && req.method === "POST") {
        if (session.user.system_role !== "admin")
          return send(res, 403, { error: "permission_denied" });
        const result = await collaboration.invite(
          await jsonBody(req),
          session.user,
          req.headers["if-match"],
        );
        return send(res, 201, result.invitation, {
          ETag: result.directory._etag,
        });
      }
      if (path === "/api/v1/invitations" && req.method === "GET") {
        if (session.user.system_role !== "admin")
          return send(res, 403, { error: "permission_denied" });
        const result = await collaboration.users();
        return send(
          res,
          200,
          { items: result.invitations },
          {
            ETag: result._etag,
          },
        );
      }
      const userApi = path.match(/^\/api\/v1\/users\/(usr-[0-9a-z-]+)$/i);
      if (userApi && req.method === "PATCH") {
        if (session.user.system_role !== "admin")
          return send(res, 403, { error: "permission_denied" });
        const result = await collaboration.updateUser(
          userApi[1],
          await jsonBody(req),
          session.user,
          req.headers["if-match"],
        );
        if (result.user.status === "suspended")
          await collaboration.clearSessions(auth.sessionRoot, result.user.id);
        return send(res, 200, result.user, { ETag: result.directory._etag });
      }
      if (path === "/api/v1/teams" && req.method === "GET") {
        const result = await collaboration.teams();
        return send(res, 200, result, { ETag: result._etag });
      }
      if (path === "/api/v1/teams" && req.method === "POST") {
        if (session.user.system_role !== "admin")
          return send(res, 403, { error: "permission_denied" });
        const result = await collaboration.createTeam(
          await jsonBody(req),
          req.headers["if-match"],
        );
        return send(res, 201, result.team, { ETag: result.directory._etag });
      }
      const teamApi = path.match(/^\/api\/v1\/teams\/(team-[0-9a-z-]+)$/i);
      if (teamApi && req.method === "PATCH") {
        if (session.user.system_role !== "admin")
          return send(res, 403, { error: "permission_denied" });
        const result = await collaboration.updateTeam(
          teamApi[1],
          await jsonBody(req),
          req.headers["if-match"],
        );
        return send(res, 200, result.team, { ETag: result.directory._etag });
      }
      if (path === "/api/v1/notifications" && req.method === "GET") {
        const result = await collaboration.notifications(session.user.id);
        return send(
          res,
          200,
          {
            items: result.items,
            unread: result.items.filter((item) => !item.read_at).length,
          },
          { ETag: result._etag },
        );
      }
      const notificationApi = path.match(
        /^\/api\/v1\/notifications\/([0-9a-f]{32})$/i,
      );
      if (notificationApi && req.method === "PATCH") {
        const result = await collaboration.markNotification(
          session.user.id,
          notificationApi[1],
          (await jsonBody(req)).read !== false,
          req.headers["if-match"],
        );
        return send(res, 200, { items: result.items }, { ETag: result._etag });
      }
      if (path === "/api/v1/drafts" && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        return send(res, 201, await draftStore.create());
      }
      const draftApi = path.match(/^\/api\/v1\/drafts\/([0-9a-f-]{36})$/i);
      if (draftApi && req.method === "DELETE") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        await draftStore.delete(draftApi[1]);
        return send(res, 204, "");
      }
      const draftAttachmentApi = path.match(
        /^\/api\/v1\/drafts\/([0-9a-f-]{36})\/attachments$/i,
      );
      if (draftAttachmentApi && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const { fields, file } = await attachmentBody(req);
        if (!file?.data?.length)
          return send(res, 400, { error: "file_required" });
        const attachment = await draftStore.addAttachment(
          draftAttachmentApi[1],
          file,
          fields.placement,
          fields.alt,
        );
        return send(res, 201, {
          attachment,
          markdown: `![${String(fields.alt || attachment.original_name).replace(/[\[\]]/g, "")}](${attachment.url})`,
        });
      }
      if (path === "/api/v1/projects" && req.method === "GET") {
        const projects = visibleProjects(
          await projectStore.all(),
          session.user,
          directory,
        );
        return send(res, 200, {
          items: projects.map((project) =>
            publicProject(project, { includeActivities: false }),
          ),
          count: projects.length,
        });
      }
      if (path === "/api/v1/projects" && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        return send(
          res,
          201,
          publicProject(
            await projectStore.create(await jsonBody(req), session.user),
          ),
        );
      }
      const projectInsightsApi = path.match(
        /^\/api\/v1\/projects\/(PRJ-\d{3})\/insights$/i,
      );
      if (projectInsightsApi && req.method === "GET") {
        const project = await projectStore.byKey(projectInsightsApi[1]);
        if (!project) return send(res, 404, { error: "not_found" });
        assertProjectAccess(project, session.user, directory, "viewer");
        const records = (await store.all()).filter(
          (record) => record.project_key === project.key,
        );
        return send(
          res,
          200,
          buildProjectInsights(records, {
            filter: url.searchParams.get("filter") || "all",
            sort: url.searchParams.get("sort") || "updated",
            page: url.searchParams.get("page") || 1,
            pageSize: url.searchParams.get("page_size") || 20,
          }),
        );
      }
      const projectCollaboratorsApi = path.match(
        /^\/api\/v1\/projects\/(PRJ-\d{3})\/collaborators$/i,
      );
      if (projectCollaboratorsApi && req.method === "GET") {
        const project = await projectStore.byKey(projectCollaboratorsApi[1]);
        if (!project) return send(res, 404, { error: "not_found" });
        assertProjectAccess(project, session.user, directory, "viewer");
        const items = directory.users
          .filter(
            (user) =>
              user.status === "active" && projectRole(project, user, directory),
          )
          .map(collaboratorSummary)
          .sort((left, right) =>
            left.display_name.localeCompare(right.display_name),
          );
        return send(res, 200, { items, count: items.length });
      }
      const projectKeyApi = path.match(/^\/api\/v1\/projects\/(PRJ-\d{3})$/i);
      if (projectKeyApi && req.method === "GET") {
        const project = await projectStore.byKey(projectKeyApi[1]);
        if (!project) return send(res, 404, { error: "not_found" });
        assertProjectAccess(project, session.user, directory, "viewer");
        return send(res, 200, publicProject(project), {
          ETag: project._etag,
        });
      }
      const projectUidApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})$/i,
      );
      if (projectUidApi && req.method === "PATCH") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const current = await projectStore.byUid(projectUidApi[1]);
        const role = assertProjectAccess(
          current,
          session.user,
          directory,
          "owner",
        );
        if (!new Set(["owner", "admin"]).has(role))
          return send(res, 403, { error: "permission_denied" });
        const project = await projectStore.patch(
          projectUidApi[1],
          await jsonBody(req),
          req.headers["if-match"],
          session.user,
        );
        return send(res, 200, publicProject(project), {
          ETag: project._etag,
        });
      }
      const projectMembersApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})\/members$/i,
      );
      if (projectMembersApi && req.method === "GET") {
        const project = await projectStore.byUid(projectMembersApi[1]);
        assertProjectAccess(project, session.user, directory, "viewer");
        return send(res, 200, {
          owner_user_id: project.owner_user_id,
          members: project.members,
          team_ids: project.team_ids,
          role: projectRole(project, session.user, directory),
        });
      }
      if (projectMembersApi && req.method === "PATCH") {
        const current = await projectStore.byUid(projectMembersApi[1]);
        const role = assertProjectAccess(
          current,
          session.user,
          directory,
          "owner",
        );
        if (!new Set(["owner", "admin"]).has(role))
          return send(res, 403, { error: "permission_denied" });
        const input = await jsonBody(req);
        const knownUsers = new Set(directory.users.map((user) => user.id));
        const knownTeams = new Set(directory.teams.map((team) => team.id));
        if (
          !knownUsers.has(input.owner_user_id || current.owner_user_id) ||
          !(input.members || current.members).every((member) =>
            knownUsers.has(member.user_id),
          ) ||
          !(input.team_ids || current.team_ids).every((id) =>
            knownTeams.has(id),
          )
        )
          return send(res, 400, { error: "unknown_user_or_team" });
        const project = await projectStore.setMembers(
          projectMembersApi[1],
          input,
          req.headers["if-match"],
          session.user,
        );
        if (project.owner_user_id !== current.owner_user_id) {
          const activity = project.activities.at(-1);
          for (const userId of [project.owner_user_id, current.owner_user_id])
            await collaboration.addNotification(userId, {
              event_id: activity.id,
              actor_id: session.user.id,
              type: "ownership",
              title: `${project.name}: ownership transferred`,
              url: `/projects/${project.key}/${project.slug}`,
              created_at: activity.created_at,
            });
        }
        return send(res, 200, publicProject(project), { ETag: project._etag });
      }
      const projectDocumentsApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})\/documents$/i,
      );
      if (projectDocumentsApi && req.method === "GET") {
        const project = await projectStore.byUid(projectDocumentsApi[1]);
        assertProjectAccess(project, session.user, directory, "viewer");
        const items = await projectStore.documents(projectDocumentsApi[1]);
        return send(res, 200, { items, count: items.length });
      }
      if (projectDocumentsApi && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const current = await projectStore.byUid(projectDocumentsApi[1]);
        assertProjectAccess(current, session.user, directory, "manager");
        const { file } = await attachmentBody(req);
        if (!file?.data?.length)
          return send(res, 400, { error: "file_required" });
        const result = await projectStore.addDocument(
          projectDocumentsApi[1],
          file,
          req.headers["if-match"],
          session.user,
        );
        return send(
          res,
          201,
          { document: result.document, project: publicProject(result.project) },
          { ETag: result.project._etag },
        );
      }
      const projectDocumentReferenceApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})\/document-references$/i,
      );
      if (projectDocumentReferenceApi && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const current = await projectStore.byUid(
          projectDocumentReferenceApi[1],
        );
        assertProjectAccess(current, session.user, directory, "manager");
        const input = await jsonBody(req);
        const project = await projectStore.addDocumentReference(
          projectDocumentReferenceApi[1],
          input.path,
          req.headers["if-match"],
          session.user,
        );
        return send(res, 201, publicProject(project), { ETag: project._etag });
      }
      const projectDocumentDeleteApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})\/documents\/(\d+)$/i,
      );
      if (projectDocumentDeleteApi && req.method === "DELETE") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const current = await projectStore.byUid(projectDocumentDeleteApi[1]);
        assertProjectAccess(current, session.user, directory, "manager");
        const project = await projectStore.removeDocument(
          projectDocumentDeleteApi[1],
          projectDocumentDeleteApi[2],
          req.headers["if-match"],
          session.user,
        );
        return send(res, 200, publicProject(project), { ETag: project._etag });
      }
      if (path === "/api/v1/sprints" && req.method === "GET") {
        let sprints = await sprintStore.all();
        const visibleKeys = new Set(
          visibleProjects(
            await projectStore.all(),
            session.user,
            directory,
          ).map((project) => project.key),
        );
        sprints = sprints.filter((sprint) =>
          visibleKeys.has(sprint.project_key),
        );
        if (url.searchParams.get("project_key"))
          sprints = sprints.filter(
            (sprint) =>
              sprint.project_key === url.searchParams.get("project_key"),
          );
        return send(res, 200, { items: sprints, count: sprints.length });
      }
      if (path === "/api/v1/sprints" && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const input = await jsonBody(req);
        const project = await projectStore.byKey(
          input.project_key || "PRJ-001",
        );
        if (!project) return send(res, 400, { error: "project_not_found" });
        assertProjectAccess(project, session.user, directory, "manager");
        return send(
          res,
          201,
          await sprintStore.create({
            ...input,
            project_key: project.key,
            key_prefix: project.code,
          }),
        );
      }
      if (path === "/api/v1/work-items" && req.method === "GET") {
        let records = await store.all();
        const visibleKeys = new Set(
          visibleProjects(
            await projectStore.all(),
            session.user,
            directory,
          ).map((project) => project.key),
        );
        records = records.filter((record) =>
          visibleKeys.has(record.project_key),
        );
        if (url.searchParams.get("kind"))
          records = records.filter(
            (r) => r.kind === url.searchParams.get("kind"),
          );
        if (url.searchParams.get("team"))
          records = records.filter(
            (r) =>
              r.team_id === url.searchParams.get("team") ||
              r.team === url.searchParams.get("team"),
          );
        if (url.searchParams.get("status"))
          records = records.filter(
            (r) => r.status === url.searchParams.get("status"),
          );
        if (url.searchParams.get("project_key"))
          records = records.filter(
            (r) => r.project_key === url.searchParams.get("project_key"),
          );
        return send(res, 200, {
          items: records.map((record) =>
            publicRecord(record, { includeActivities: false }),
          ),
          count: records.length,
        });
      }
      const keyApi = path.match(
        /^\/api\/v1\/work-items\/([A-Z][A-Z0-9]{1,7}-(?:\d{4}[A-Z]?|BL-\d{3}))$/i,
      );
      if (keyApi && req.method === "GET") {
        const record = await store.byKey(keyApi[1]);
        if (!record) return send(res, 404, { error: "not_found" });
        const project = await projectStore.byKey(record.project_key);
        assertProjectAccess(project, session.user, directory, "viewer");
        return send(res, 200, publicRecord(record), { ETag: record._etag });
      }
      if (path === "/api/v1/work-items" && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const input = await jsonBody(req);
        const project = await projectStore.byKey(
          input.project_key || "PRJ-001",
        );
        if (!project) return send(res, 400, { error: "project_not_found" });
        assertProjectAccess(project, session.user, directory, "member");
        assertCollaborators(project, input, directory);
        const uid = newUid();
        let promotion = null;
        try {
          if (input.draft_id)
            promotion = await draftStore.preparePromotion(
              input.draft_id,
              uid,
              input.body,
            );
          const record = await store.create(
            {
              ...input,
              _uid: uid,
              body: promotion?.body ?? input.body,
              project_key: project.key,
              key_prefix: project.code,
            },
            {
              attachments: promotion?.attachments || [],
              actor: session.user,
            },
          );
          if (promotion) await draftStore.finalize(promotion);
          return send(res, 201, publicRecord(record), {
            Location: `/work-items/${record.key}/${record.slug}`,
            ETag: record._etag,
          });
        } catch (error) {
          if (promotion) await draftStore.rollback(promotion);
          throw error;
        }
      }
      const fileReferencesApi = path.match(
        /^\/api\/v1\/work-items\/([0-9a-f-]{36})\/file-references$/i,
      );
      if (fileReferencesApi && req.method === "GET") {
        const record = await store.byUid(fileReferencesApi[1]);
        const project = record
          ? await projectStore.byKey(record.project_key)
          : null;
        assertProjectAccess(project, session.user, directory, "viewer");
        const items = await store.fileReferences(fileReferencesApi[1]);
        return send(res, 200, { items, count: items.length });
      }
      const activityApi = path.match(
        /^\/api\/v1\/work-items\/([0-9a-f-]{36})\/activities$/i,
      );
      if (activityApi && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const input = await jsonBody(req);
        const current = await store.byUid(activityApi[1]);
        const project = current
          ? await projectStore.byKey(current.project_key)
          : null;
        assertProjectAccess(project, session.user, directory, "member");
        const result = await store.addComment(
          activityApi[1],
          input.body,
          req.headers["if-match"],
          session.user,
        );
        await notifyMentions(
          collaboration,
          directory,
          session.user,
          result.activity,
          result.record,
          input.body,
        );
        return send(res, 201, result, { ETag: result.record._etag });
      }
      const uidApi = path.match(/^\/api\/v1\/work-items\/([0-9a-f-]{36})$/i);
      if (uidApi && req.method === "PATCH") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const input = await jsonBody(req);
        const current = await store.byUid(uidApi[1]);
        if (!current) return send(res, 404, { error: "not_found" });
        const currentProject = await projectStore.byKey(current.project_key);
        const role = assertWorkItemEdit({
          project: currentProject,
          item: current,
          user: session.user,
          directory,
          input,
        });
        assertWorkflowTransition(current, input, session.user, role);
        assertAssignmentHandoff(current, input);
        const targetProject = input.project_key
          ? await projectStore.byKey(input.project_key)
          : currentProject;
        if (!targetProject)
          return send(res, 400, { error: "project_not_found" });
        if (targetProject.key !== currentProject.key)
          assertProjectAccess(
            targetProject,
            session.user,
            directory,
            "manager",
          );
        assertCollaborators(targetProject, input, directory);
        let promotion = null;
        try {
          if (input.draft_id)
            promotion = await draftStore.preparePromotion(
              input.draft_id,
              uidApi[1],
              input.body,
            );
          delete input.draft_id;
          const patchInput = { ...input };
          const transitionNote = String(patchInput.transition_note || "");
          delete patchInput.transition_note;
          if (promotion) patchInput.body = promotion.body;
          else if (!Object.hasOwn(input, "body")) delete patchInput.body;
          const record = await store.patch(
            uidApi[1],
            patchInput,
            req.headers["if-match"],
            {
              attachments: promotion?.attachments || [],
              actor: session.user,
              transitionNote,
            },
          );
          await notifyWorkItemChanges(
            collaboration,
            session.user,
            current,
            record,
          );
          if (promotion) await draftStore.finalize(promotion);
          return send(res, 200, publicRecord(record), { ETag: record._etag });
        } catch (error) {
          if (promotion) await draftStore.rollback(promotion);
          throw error;
        }
      }
      const attachmentApi = path.match(
        /^\/api\/v1\/work-items\/([0-9a-f-]{36})\/attachments$/i,
      );
      if (attachmentApi && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const current = await store.byUid(attachmentApi[1]);
        const project = current
          ? await projectStore.byKey(current.project_key)
          : null;
        assertProjectAccess(project, session.user, directory, "member");
        const { fields, file } = await attachmentBody(req);
        if (!file?.data?.length)
          return send(res, 400, { error: "file_required" });
        const result = await store.addAttachment(
          attachmentApi[1],
          file,
          fields.placement,
          session.user,
        );
        return send(
          res,
          201,
          {
            ...result,
            markdown: `![${String(fields.alt || file.name).replace(/[\[\]]/g, "")}](${result.attachment.url})`,
          },
          { ETag: result.record._etag },
        );
      }
      const attachmentDeleteApi = path.match(
        /^\/api\/v1\/work-items\/([0-9a-f-]{36})\/attachments\/([^/]+)$/i,
      );
      if (attachmentDeleteApi && req.method === "DELETE") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const current = await store.byUid(attachmentDeleteApi[1]);
        const project = current
          ? await projectStore.byKey(current.project_key)
          : null;
        assertWorkItemEdit({
          project,
          item: current,
          user: session.user,
          directory,
          input: {},
        });
        const record = await store.removeAttachment(
          attachmentDeleteApi[1],
          decodeURIComponent(attachmentDeleteApi[2]),
          req.headers["if-match"],
          session.user,
        );
        return send(res, 200, publicRecord(record), { ETag: record._etag });
      }
      const attachment = path.match(
        /^\/attachments\/([0-9a-f-]{36})\/([^/]+)$/i,
      );
      if (attachment) {
        const file = await store.attachmentPath(attachment[1], attachment[2]);
        const record = file ? await store.byUid(attachment[1]) : null;
        const project = record
          ? await projectStore.byKey(record.project_key)
          : null;
        if (record)
          assertProjectAccess(project, session.user, directory, "viewer");
        const metadata = record?.attachments.find(
          (entry) => typeof entry !== "string" && entry.name === attachment[2],
        );
        const fileType = fileTypeForName(metadata?.original_name || file);
        return file && metadata
          ? streamFile(res, file, 200, {
              filename: metadata.original_name || metadata.name,
              contentType: fileType.type,
              inline: fileType.inline,
              download: url.searchParams.get("download") === "1",
            })
          : send(res, 404, { error: "not_found" });
      }
      const draftAttachment = path.match(
        /^\/draft-attachments\/([0-9a-f-]{36})\/([^/]+)$/i,
      );
      if (draftAttachment) {
        const file = await draftStore.attachmentPath(
          draftAttachment[1],
          draftAttachment[2],
        );
        const draft = file ? await draftStore.read(draftAttachment[1]) : null;
        const metadata = draft?.attachments.find(
          (entry) => entry.name === draftAttachment[2],
        );
        const fileType = fileTypeForName(metadata?.original_name || file);
        return file && metadata
          ? streamFile(res, file, 200, {
              filename: metadata.original_name || metadata.name,
              contentType: fileType.type,
              inline: fileType.inline,
              download: url.searchParams.get("download") === "1",
            })
          : send(res, 404, { error: "not_found" });
      }
      const workspaceFile = path.match(/^\/work-item-files\/([0-9a-f-]{36})$/i);
      if (workspaceFile && req.method === "GET") {
        const record = await store.byUid(workspaceFile[1]);
        const project = record
          ? await projectStore.byKey(record.project_key)
          : null;
        if (record)
          assertProjectAccess(project, session.user, directory, "viewer");
        const reference = await store.workspaceReferencePath(
          workspaceFile[1],
          url.searchParams.get("path"),
        );
        return reference
          ? streamFile(res, reference.file, 200, {
              filename: reference.name,
              contentType: reference.type,
              inline: reference.inline,
              download: url.searchParams.get("download") === "1",
            })
          : send(res, 404, { error: "not_found" });
      }
      const projectDocument = path.match(
        /^\/project-documents\/([0-9a-f-]{36})\/([^/]+)$/i,
      );
      if (projectDocument && req.method === "GET") {
        const file = await projectStore.managedDocumentPath(
          projectDocument[1],
          projectDocument[2],
        );
        const project = file
          ? await projectStore.byUid(projectDocument[1])
          : null;
        if (project)
          assertProjectAccess(project, session.user, directory, "viewer");
        const metadata = project?.documents.find(
          (document) =>
            typeof document !== "string" &&
            document.name === projectDocument[2],
        );
        const fileType = fileTypeForName(metadata?.original_name || file);
        return file && metadata
          ? streamFile(res, file, 200, {
              filename: metadata.original_name || metadata.name,
              contentType: fileType.type,
              inline: fileType.inline,
              download: url.searchParams.get("download") === "1",
            })
          : send(res, 404, { error: "not_found" });
      }
      const projectFile = path.match(/^\/project-files\/([0-9a-f-]{36})$/i);
      if (projectFile && req.method === "GET") {
        const project = await projectStore.byUid(projectFile[1]);
        if (project)
          assertProjectAccess(project, session.user, directory, "viewer");
        const reference = await projectStore.workspaceDocumentPath(
          projectFile[1],
          url.searchParams.get("path"),
        );
        return reference
          ? streamFile(res, reference.file, 200, {
              filename: reference.name,
              contentType: reference.type,
              inline: reference.inline,
              download: url.searchParams.get("download") === "1",
            })
          : send(res, 404, { error: "not_found" });
      }
      const canonical = path.match(
        /^\/work-items\/([A-Z][A-Z0-9]{1,7}-(?:\d{4}[A-Z]?|BL-\d{3}))(?:\/([^/]+))?\/?$/i,
      );
      if (canonical) {
        const record = await store.byKey(canonical[1]);
        if (!record)
          return streamFile(res, resolve(publicRoot, "404.html"), 404);
        const wanted = `/work-items/${record.key}/${record.slug}`;
        if (path.replace(/\/$/, "") !== wanted)
          return send(res, 308, "", {
            Location: wanted,
            "Content-Type": "text/plain",
          });
        return streamFile(res, resolve(publicRoot, "index.html"));
      }
      if (/^\/(?:task|backlog)\//.test(path)) {
        const record = (await store.all()).find((item) =>
          item.legacy_routes.some(
            (route) =>
              route.toLowerCase() === path.replace(/\/$/, "").toLowerCase(),
          ),
        );
        if (record)
          return send(res, 308, "", {
            Location: `/work-items/${record.key}/${record.slug}`,
            "Content-Type": "text/plain",
          });
        return streamFile(res, resolve(publicRoot, "404.html"), 404);
      }
      if (path === "/projects" || path === "/projects/")
        return streamFile(res, resolve(publicRoot, "index.html"));
      const projectCanonical = path.match(
        /^\/projects\/(PRJ-\d{3})(?:\/([^/]+))?\/?$/i,
      );
      if (projectCanonical) {
        const project = await projectStore.byKey(projectCanonical[1]);
        if (!project)
          return streamFile(res, resolve(publicRoot, "404.html"), 404);
        const wanted = `/projects/${project.key}/${project.slug}`;
        if (path.replace(/\/$/, "") !== wanted)
          return send(res, 308, "", {
            Location: wanted,
            "Content-Type": "text/plain",
          });
        return streamFile(res, resolve(publicRoot, "index.html"));
      }
      if (path === "/calendar" || path === "/backlog")
        return streamFile(res, resolve(publicRoot, "index.html"));
      const toastUiFiles = new Map([
        ["/vendor/toastui-editor.css", "toastui-editor.css"],
      ]);
      if (path === "/vendor/toastui-editor.js")
        return streamFile(res, toastUiBundle);
      if (toastUiFiles.has(path))
        return streamFile(res, resolve(toastUiRoot, toastUiFiles.get(path)));
      if (path === "/vendor/dompurify.js")
        return streamFile(res, resolve(domPurifyRoot, "purify.js"));
      if (path === "/") {
        const projects = await projectStore.all();
        const project =
          projects.find((candidate) => candidate.status === "active") ||
          projects[0];
        return project
          ? send(res, 302, "", {
              Location: `/projects/${project.key}/${project.slug}`,
              "Content-Type": "text/plain",
            })
          : send(res, 302, "", {
              Location: "/projects",
              "Content-Type": "text/plain",
            });
      }
      if (path === "/index.html")
        return streamFile(res, resolve(publicRoot, "index.html"));
      const candidate = resolve(publicRoot, `.${path}`);
      if (candidate.startsWith(publicRoot)) return streamFile(res, candidate);
      return send(res, 404, { error: "not_found" });
    } catch (error) {
      return send(res, error.statusCode || 500, {
        error: error.message || "internal_error",
      });
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.SPRINTMARK_HOST || process.env.HOST || "127.0.0.1";
  const port = Number(
    process.env.SPRINTMARK_PORT || process.env.PORT || process.argv[2] || 4310,
  );
  const workspace = process.env.SPRINTMARK_DATA_DIR
    ? resolve(process.env.SPRINTMARK_DATA_DIR)
    : defaultWorkspace;
  const firstRunSetup =
    isLoopbackHost(host) && !hasExplicitAuthConfiguration(process.env);
  createWorkTrackerServer({
    workspace,
    authConfig: firstRunSetup ? null : authConfigFromEnv(host, port),
    setup: firstRunSetup
      ? {
          enabled: true,
          host,
          port,
          baseUrl: `http://${host === "::1" ? "localhost" : host}:${port}`,
          configPath: resolve(appRoot, ".env.local"),
          dataDir: process.env.SPRINTMARK_DATA_DIR || "./data",
        }
      : null,
  }).listen(port, host, () =>
    console.log(`Sprintmark v${VERSION}: http://${host}:${port}`),
  );
}

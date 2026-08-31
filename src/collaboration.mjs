import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import { atomicWrite } from "./records.mjs";
import { contentEtag, newUid } from "./identity.mjs";

export const SYSTEM_ROLES = new Set(["admin", "user"]);
export const USER_STATUSES = new Set(["active", "suspended"]);
export const PROJECT_ROLES = new Set(["manager", "member", "viewer"]);

const DEFAULT_TEAMS = [
  {
    id: "team-content-technical",
    code: "content-technical",
    name: "İçerik / Teknik",
  },
  {
    id: "team-web-development",
    code: "web-development",
    name: "Web Yazılım",
  },
];

const cleanEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const cleanText = (value, maximum = 160) =>
  String(value || "")
    .trim()
    .slice(0, maximum);

function emptyDirectory() {
  return {
    schema_version: 1,
    users: [],
    invitations: [],
    teams: DEFAULT_TEAMS.map((team) => ({
      ...team,
      lead_user_ids: [],
      member_user_ids: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
  };
}

function publicUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.google_sub;
  return safe;
}

function assertDirectory(directory) {
  if (directory.schema_version !== 1)
    throw new Error("identity schema is invalid");
  if (!Array.isArray(directory.users))
    throw new Error("users must be an array");
  if (!Array.isArray(directory.invitations))
    throw new Error("invitations must be an array");
  if (!Array.isArray(directory.teams))
    throw new Error("teams must be an array");
  const userIds = new Set();
  const emails = new Set();
  for (const user of directory.users) {
    if (!/^usr-[0-9a-z-]+$/i.test(user.id || ""))
      throw new Error("user id is invalid");
    if (userIds.has(user.id)) throw new Error("duplicate user id");
    if (!user.email || emails.has(cleanEmail(user.email)))
      throw new Error("user email is invalid or duplicate");
    if (!SYSTEM_ROLES.has(user.system_role))
      throw new Error("user system role is invalid");
    if (!USER_STATUSES.has(user.status))
      throw new Error("user status is invalid");
    userIds.add(user.id);
    emails.add(cleanEmail(user.email));
  }
  const teamIds = new Set();
  const teamCodes = new Set();
  for (const team of directory.teams) {
    if (!/^team-[0-9a-z-]+$/i.test(team.id || ""))
      throw new Error("team id is invalid");
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(team.code || ""))
      throw new Error("team code is invalid");
    if (teamIds.has(team.id) || teamCodes.has(team.code))
      throw new Error("duplicate team id or code");
    if (
      ![...(team.lead_user_ids || []), ...(team.member_user_ids || [])].every(
        (id) => userIds.has(id),
      )
    )
      throw new Error("team references an unknown user");
    teamIds.add(team.id);
    teamCodes.add(team.code);
  }
}

export class CollaborationStore {
  constructor(workspace) {
    this.workspace = workspace;
    this.path = resolve(workspace, "work-items", "collaboration.yml");
    this.notificationRoot = resolve(
      workspace,
      "data",
      "work-tracker",
      "notifications",
    );
    this.writeQueue = Promise.resolve();
  }

  async read() {
    let raw;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const initial = emptyDirectory();
      raw = YAML.stringify(initial, { lineWidth: 0 });
      return { ...initial, _etag: contentEtag(raw), _missing: true };
    }
    const directory = YAML.parse(raw);
    assertDirectory(directory);
    return { ...directory, _etag: contentEtag(raw) };
  }

  async ensureBootstrap({ emails = [], localUser = null } = {}) {
    const current = await this.read();
    const now = new Date().toISOString();
    const next = current._missing
      ? emptyDirectory()
      : {
          schema_version: current.schema_version,
          users: [...current.users],
          invitations: [...current.invitations],
          teams: current.teams.map((team) => ({
            ...team,
            lead_user_ids: [...team.lead_user_ids],
            member_user_ids: [...team.member_user_ids],
          })),
        };
    let changed = current._missing;
    if (localUser && !next.users.some((user) => user.id === "usr-local")) {
      next.users.push({
        id: "usr-local",
        email: cleanEmail(localUser.email || "local@sprintmark.invalid"),
        display_name: cleanText(localUser.display_name || "Local user"),
        avatar_url: null,
        google_sub: null,
        system_role: "admin",
        status: "active",
        created_at: now,
        updated_at: now,
        last_login_at: now,
      });
      for (const team of next.teams) {
        team.lead_user_ids = [...new Set([...team.lead_user_ids, "usr-local"])];
        team.member_user_ids = [
          ...new Set([...team.member_user_ids, "usr-local"]),
        ];
      }
      changed = true;
    }
    for (const [index, email] of [
      ...new Set(emails.map(cleanEmail)),
    ].entries()) {
      if (!email) continue;
      if (
        next.users.some((user) => cleanEmail(user.email) === email) ||
        next.invitations.some(
          (invitation) =>
            invitation.email === email && invitation.status === "pending",
        )
      )
        continue;
      const role = index === 0 ? "admin" : "user";
      if (index === 0) {
        const id = `usr-bootstrap-${createHash("sha256")
          .update(email)
          .digest("hex")
          .slice(0, 12)}`;
        next.users.push({
          id,
          email,
          display_name: email.split("@")[0],
          avatar_url: null,
          google_sub: null,
          system_role: role,
          status: "active",
          created_at: now,
          updated_at: now,
          last_login_at: null,
        });
        for (const team of next.teams) {
          team.lead_user_ids = [...new Set([...team.lead_user_ids, id])];
          team.member_user_ids = [...new Set([...team.member_user_ids, id])];
        }
      } else {
        next.invitations.push({
          id: newUid(),
          email,
          system_role: role,
          status: "pending",
          created_at: now,
          created_by: "bootstrap",
          accepted_at: null,
        });
      }
      changed = true;
    }
    return changed
      ? this.save(next, current._missing ? null : current._etag)
      : current;
  }

  async save(directory, expectedEtag = null) {
    const operation = async () => {
      if (expectedEtag) {
        const latest = await this.read();
        if (latest._etag !== expectedEtag)
          throw Object.assign(
            new Error("directory changed; reload before saving"),
            { statusCode: 409 },
          );
      }
      const clean = { ...directory };
      delete clean._etag;
      delete clean._missing;
      assertDirectory(clean);
      const raw = YAML.stringify(clean, { lineWidth: 0 });
      await atomicWrite(this.path, raw);
      return { ...clean, _etag: contentEtag(raw) };
    };
    const pending = this.writeQueue.then(operation, operation);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }

  assertMatch(directory, ifMatch) {
    if (!ifMatch || ifMatch !== directory._etag)
      throw Object.assign(
        new Error("directory changed; reload before saving"),
        {
          statusCode: 409,
        },
      );
  }

  async users() {
    const directory = await this.read();
    return {
      items: directory.users.map(publicUser),
      invitations: directory.invitations,
      _etag: directory._etag,
    };
  }

  async userById(id) {
    const directory = await this.read();
    return directory.users.find((user) => user.id === id) || null;
  }

  async invite(input, actor, ifMatch) {
    const directory = await this.read();
    this.assertMatch(directory, ifMatch);
    const email = cleanEmail(input.email);
    if (!email || !email.includes("@"))
      throw Object.assign(new Error("valid email is required"), {
        statusCode: 400,
      });
    if (
      directory.users.some((user) => cleanEmail(user.email) === email) ||
      directory.invitations.some(
        (invitation) =>
          invitation.email === email && invitation.status === "pending",
      )
    )
      throw Object.assign(new Error("email is already invited"), {
        statusCode: 409,
      });
    const systemRole = input.system_role === "admin" ? "admin" : "user";
    const invitation = {
      id: newUid(),
      email,
      system_role: systemRole,
      status: "pending",
      created_at: new Date().toISOString(),
      created_by: actor.id,
      accepted_at: null,
    };
    const saved = await this.save(
      {
        ...directory,
        invitations: [...directory.invitations, invitation],
      },
      directory._etag,
    );
    return { invitation, directory: saved };
  }

  async activateGoogleUser(claims) {
    const directory = await this.read();
    const email = cleanEmail(claims.email);
    if (claims.email_verified !== true || !email)
      throw Object.assign(new Error("verified Google email is required"), {
        statusCode: 403,
      });
    const existing = directory.users.find(
      (user) =>
        user.google_sub === claims.sub || cleanEmail(user.email) === email,
    );
    const now = new Date().toISOString();
    if (existing) {
      if (existing.status !== "active")
        throw Object.assign(new Error("user is suspended"), {
          statusCode: 403,
        });
      const nextUser = {
        ...existing,
        google_sub: claims.sub,
        email,
        display_name: cleanText(claims.name || existing.display_name),
        avatar_url: claims.picture || existing.avatar_url || null,
        updated_at: now,
        last_login_at: now,
      };
      const saved = await this.save(
        {
          ...directory,
          users: directory.users.map((user) =>
            user.id === existing.id ? nextUser : user,
          ),
        },
        directory._etag,
      );
      return { user: publicUser(nextUser), directory: saved };
    }
    const invitation = directory.invitations.find(
      (item) => item.email === email && item.status === "pending",
    );
    if (!invitation)
      throw Object.assign(new Error("Google account is not invited"), {
        statusCode: 403,
      });
    const user = {
      id: `usr-${newUid()}`,
      email,
      display_name: cleanText(claims.name || email),
      avatar_url: claims.picture || null,
      google_sub: claims.sub,
      system_role: invitation.system_role,
      status: "active",
      created_at: now,
      updated_at: now,
      last_login_at: now,
    };
    const saved = await this.save(
      {
        ...directory,
        users: [...directory.users, user],
        invitations: directory.invitations.map((item) =>
          item.id === invitation.id
            ? { ...item, status: "accepted", accepted_at: now }
            : item,
        ),
      },
      directory._etag,
    );
    return { user: publicUser(user), directory: saved };
  }

  async updateUser(id, input, actor, ifMatch) {
    const directory = await this.read();
    this.assertMatch(directory, ifMatch);
    const existing = directory.users.find((user) => user.id === id);
    if (!existing)
      throw Object.assign(new Error("user not found"), { statusCode: 404 });
    const status = input.status ?? existing.status;
    const systemRole = input.system_role ?? existing.system_role;
    if (!USER_STATUSES.has(status) || !SYSTEM_ROLES.has(systemRole))
      throw Object.assign(new Error("user update is invalid"), {
        statusCode: 400,
      });
    if (existing.id === actor.id && status === "suspended")
      throw Object.assign(new Error("administrator cannot suspend self"), {
        statusCode: 409,
      });
    const updated = {
      ...existing,
      status,
      system_role: systemRole,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.save(
      {
        ...directory,
        users: directory.users.map((user) => (user.id === id ? updated : user)),
      },
      directory._etag,
    );
    return { user: publicUser(updated), directory: saved };
  }

  async teams() {
    const directory = await this.read();
    return { items: directory.teams, _etag: directory._etag };
  }

  async createTeam(input, ifMatch) {
    const directory = await this.read();
    this.assertMatch(directory, ifMatch);
    const code = cleanText(input.code, 40).toLowerCase();
    const name = cleanText(input.name, 120);
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(code) || !name)
      throw Object.assign(new Error("team name or code is invalid"), {
        statusCode: 400,
      });
    if (directory.teams.some((team) => team.code === code))
      throw Object.assign(new Error("team code already exists"), {
        statusCode: 409,
      });
    const now = new Date().toISOString();
    const team = {
      id: `team-${newUid()}`,
      code,
      name,
      lead_user_ids: [],
      member_user_ids: [],
      created_at: now,
      updated_at: now,
    };
    const saved = await this.save(
      {
        ...directory,
        teams: [...directory.teams, team],
      },
      directory._etag,
    );
    return { team, directory: saved };
  }

  async updateTeam(id, input, ifMatch) {
    const directory = await this.read();
    this.assertMatch(directory, ifMatch);
    const existing = directory.teams.find((team) => team.id === id);
    if (!existing)
      throw Object.assign(new Error("team not found"), { statusCode: 404 });
    const memberIds = [
      ...new Set(input.member_user_ids ?? existing.member_user_ids),
    ];
    const leadIds = [...new Set(input.lead_user_ids ?? existing.lead_user_ids)];
    const activeIds = new Set(
      directory.users
        .filter((user) => user.status === "active")
        .map((user) => user.id),
    );
    if (![...memberIds, ...leadIds].every((id) => activeIds.has(id)))
      throw Object.assign(new Error("team references an inactive user"), {
        statusCode: 400,
      });
    const updated = {
      ...existing,
      name: cleanText(input.name ?? existing.name, 120),
      member_user_ids: [...new Set([...memberIds, ...leadIds])],
      lead_user_ids: leadIds,
      updated_at: new Date().toISOString(),
    };
    const saved = await this.save(
      {
        ...directory,
        teams: directory.teams.map((team) => (team.id === id ? updated : team)),
      },
      directory._etag,
    );
    return { team: updated, directory: saved };
  }

  async addNotification(userId, event) {
    if (!userId || event.actor_id === userId) return null;
    const id = createHash("sha256")
      .update(`${event.event_id}:${userId}`)
      .digest("hex")
      .slice(0, 32);
    const path = resolve(this.notificationRoot, `${userId}.yml`);
    let items = [];
    try {
      items = YAML.parse(await readFile(path, "utf8")) || [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (items.some((item) => item.id === id)) return null;
    const notification = {
      id,
      event_id: event.event_id,
      user_id: userId,
      type: event.type,
      title: cleanText(event.title, 240),
      url: cleanText(event.url, 500),
      created_at: event.created_at || new Date().toISOString(),
      read_at: null,
    };
    await atomicWrite(
      path,
      YAML.stringify([notification, ...items], { lineWidth: 0 }),
    );
    return notification;
  }

  async notifications(userId) {
    const path = resolve(this.notificationRoot, `${userId}.yml`);
    try {
      const raw = await readFile(path, "utf8");
      const items = YAML.parse(raw) || [];
      return { items, _etag: contentEtag(raw) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const raw = YAML.stringify([]);
      return { items: [], _etag: contentEtag(raw) };
    }
  }

  async markNotification(userId, id, read, ifMatch) {
    const current = await this.notifications(userId);
    if (!ifMatch || ifMatch !== current._etag)
      throw Object.assign(new Error("notifications changed; reload"), {
        statusCode: 409,
      });
    const existing = current.items.find((item) => item.id === id);
    if (!existing)
      throw Object.assign(new Error("notification not found"), {
        statusCode: 404,
      });
    const items = current.items.map((item) =>
      item.id === id
        ? { ...item, read_at: read ? new Date().toISOString() : null }
        : item,
    );
    const path = resolve(this.notificationRoot, `${userId}.yml`);
    const raw = YAML.stringify(items, { lineWidth: 0 });
    await atomicWrite(path, raw);
    return { items, _etag: contentEtag(raw) };
  }

  async clearSessions(sessionRoot, userId) {
    let names = [];
    try {
      names = await readdir(sessionRoot);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const name of names.filter((value) => value.endsWith(".yml"))) {
      const path = resolve(sessionRoot, name);
      try {
        const session = YAML.parse(await readFile(path, "utf8"));
        if (session.user_id === userId) await rm(path, { force: true });
      } catch {
        // Ignore an already expired or concurrently removed session.
      }
    }
  }
}

export function actorSnapshot(user) {
  if (!user)
    return { type: "system", id: "sprintmark", display_name: "Sprintmark" };
  return {
    type: "user",
    id: user.id,
    display_name: user.display_name,
  };
}

export function legacyActor(actor) {
  if (actor && typeof actor === "object") return actor;
  if (actor === "user")
    return { type: "legacy", id: "legacy-user", display_name: "Legacy user" };
  return { type: "system", id: "sprintmark", display_name: "Sprintmark" };
}

export function notificationToken() {
  return randomBytes(24).toString("base64url");
}

export { publicUser };

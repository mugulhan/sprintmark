import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { URLSearchParams } from "node:url";
import YAML from "yaml";
import { atomicWrite } from "./records.mjs";

const SESSION_COOKIE = "sprintmark_session";
const OAUTH_COOKIE = "sprintmark_oauth_state";
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 10 * 60 * 1000;

const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
const secretDigest = (value, secret) =>
  createHmac("sha256", secret).update(String(value)).digest("hex");
const b64url = (value) => Buffer.from(value, "base64url");

export function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0
          ? [part, ""]
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function cookie(name, value, { secure = false, maxAge, clear = false } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  if (clear) parts.push("Max-Age=0");
  else if (maxAge) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

export class GoogleOAuthClient {
  constructor(config, fetcher = globalThis.fetch) {
    this.config = config;
    this.fetch = fetcher;
    this.keys = { expiresAt: 0, items: [] };
  }

  authorizationUrl({ state, nonce, verifier }) {
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: `${this.config.baseUrl}/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeAndVerify(code, verifier, nonce) {
    const response = await this.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: `${this.config.baseUrl}/auth/google/callback`,
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!response.ok)
      throw Object.assign(new Error("Google token exchange failed"), {
        statusCode: 401,
      });
    const tokens = await response.json();
    return this.verifyIdToken(tokens.id_token, nonce);
  }

  async verifyIdToken(jwt, expectedNonce) {
    const parts = String(jwt || "").split(".");
    if (parts.length !== 3)
      throw Object.assign(new Error("Google ID token is invalid"), {
        statusCode: 401,
      });
    const header = JSON.parse(b64url(parts[0]).toString("utf8"));
    const claims = JSON.parse(b64url(parts[1]).toString("utf8"));
    const key = await this.googleKey(header.kid);
    const verified = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: "jwk" }),
      b64url(parts[2]),
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      !verified ||
      header.alg !== "RS256" ||
      !["https://accounts.google.com", "accounts.google.com"].includes(
        claims.iss,
      ) ||
      claims.aud !== this.config.clientId ||
      Number(claims.exp) <= now ||
      claims.nonce !== expectedNonce
    )
      throw Object.assign(new Error("Google ID token validation failed"), {
        statusCode: 401,
      });
    return claims;
  }

  async googleKey(kid) {
    if (Date.now() < this.keys.expiresAt) {
      const cached = this.keys.items.find((key) => key.kid === kid);
      if (cached) return cached;
    }
    const response = await this.fetch(
      "https://www.googleapis.com/oauth2/v3/certs",
    );
    if (!response.ok) throw new Error("Google signing keys are unavailable");
    const payload = await response.json();
    this.keys = {
      items: payload.keys || [],
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const key = this.keys.items.find((item) => item.kid === kid);
    if (!key)
      throw Object.assign(new Error("Google signing key was not found"), {
        statusCode: 401,
      });
    return key;
  }
}

export class AuthService {
  constructor({ workspace, collaboration, config, googleClient }) {
    this.workspace = workspace;
    this.collaboration = collaboration;
    this.config = config;
    this.sessionRoot = resolve(workspace, "data", "work-tracker", "sessions");
    this.oauthRoot = resolve(
      workspace,
      "data",
      "work-tracker",
      "oauth-attempts",
    );
    this.google = googleClient || new GoogleOAuthClient(config);
  }

  async initialize() {
    const emails = String(this.config.bootstrapAdminEmails || "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);
    if (this.config.mode === "google" && !emails.length) {
      const directory = await this.collaboration.read();
      if (directory._missing)
        throw new Error("BOOTSTRAP_ADMIN_EMAILS is required for Google mode");
    }
    return this.collaboration.ensureBootstrap({
      emails,
      localUser:
        this.config.mode === "local"
          ? {
              email: this.config.localEmail,
              display_name: this.config.localName,
            }
          : null,
    });
  }

  async session(req) {
    if (this.config.mode === "local" && this.config.localAutoLogin) {
      const user = await this.collaboration.userById("usr-local");
      return user
        ? { user, csrf_token: "local-csrf", mode: "local", expires_at: null }
        : null;
    }
    const rawToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!rawToken) return null;
    const path = resolve(
      this.sessionRoot,
      `${secretDigest(rawToken, this.config.sessionSecret)}.yml`,
    );
    let stored;
    try {
      stored = YAML.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
    const now = Date.now();
    if (
      Date.parse(stored.expires_at) <= now ||
      Date.parse(stored.idle_expires_at) <= now
    ) {
      await rm(path, { force: true });
      return null;
    }
    const user = await this.collaboration.userById(stored.user_id);
    if (!user || user.status !== "active") return null;
    const mode = stored.mode || "google";
    if (mode !== this.config.mode) return null;
    return {
      user,
      csrf_token: stored.csrf_token,
      mode,
      expires_at: stored.expires_at,
    };
  }

  async issueSession(res, user, mode, extraCookies = []) {
    const sessionToken = token(48);
    const now = Date.now();
    const session = {
      user_id: user.id,
      mode,
      csrf_token: token(32),
      created_at: new Date(now).toISOString(),
      idle_expires_at: new Date(now + SESSION_IDLE_MS).toISOString(),
      expires_at: new Date(now + SESSION_ABSOLUTE_MS).toISOString(),
    };
    await atomicWrite(
      resolve(
        this.sessionRoot,
        `${secretDigest(sessionToken, this.config.sessionSecret)}.yml`,
      ),
      YAML.stringify(session),
    );
    const sessionCookie = cookie(SESSION_COOKIE, sessionToken, {
      secure: this.config.secureCookies,
      maxAge: SESSION_ABSOLUTE_MS / 1000,
    });
    res.writeHead(302, {
      Location: "/projects/",
      "Set-Cookie": extraCookies.length
        ? [sessionCookie, ...extraCookies]
        : sessionCookie,
      "Cache-Control": "no-store",
    });
    res.end();
  }

  async startLocal(res) {
    if (this.config.mode !== "local")
      throw Object.assign(new Error("Local authentication is disabled"), {
        statusCode: 404,
      });
    const user = await this.collaboration.userById("usr-local");
    if (!user || user.status !== "active")
      throw Object.assign(new Error("Local user is unavailable"), {
        statusCode: 403,
      });
    return this.issueSession(res, user, "local");
  }

  assertCsrf(req, session) {
    if (!session)
      throw Object.assign(new Error("authentication required"), {
        statusCode: 401,
      });
    if (
      !this.config.csrfDisabled &&
      req.headers["x-csrf-token"] !== session.csrf_token
    )
      throw Object.assign(new Error("CSRF token is invalid"), {
        statusCode: 403,
      });
  }

  async startGoogle(res) {
    if (this.config.mode !== "google")
      throw Object.assign(new Error("Google authentication is disabled"), {
        statusCode: 404,
      });
    const state = token(24);
    const nonce = token(24);
    const verifier = token(48);
    await atomicWrite(
      resolve(this.oauthRoot, `${digest(state)}.yml`),
      YAML.stringify({
        state,
        nonce,
        verifier,
        created_at: new Date().toISOString(),
      }),
    );
    const url = this.google.authorizationUrl({ state, nonce, verifier });
    res.writeHead(302, {
      Location: url,
      "Set-Cookie": cookie(OAUTH_COOKIE, state, {
        secure: this.config.secureCookies,
        maxAge: 600,
      }),
      "Cache-Control": "no-store",
    });
    res.end();
  }

  async finishGoogle(req, res, url) {
    if (this.config.mode !== "google")
      throw Object.assign(new Error("Google authentication is disabled"), {
        statusCode: 404,
      });
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const cookieState = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
    if (!state || !code || !cookieState || state !== cookieState)
      throw Object.assign(new Error("OAuth state is invalid"), {
        statusCode: 401,
      });
    const attemptPath = resolve(this.oauthRoot, `${digest(state)}.yml`);
    let attempt;
    try {
      attempt = YAML.parse(await readFile(attemptPath, "utf8"));
    } catch {
      throw Object.assign(new Error("OAuth attempt was not found"), {
        statusCode: 401,
      });
    }
    await rm(attemptPath, { force: true });
    if (Date.now() - Date.parse(attempt.created_at) > OAUTH_TTL_MS)
      throw Object.assign(new Error("OAuth attempt expired"), {
        statusCode: 401,
      });
    const claims = await this.google.exchangeAndVerify(
      code,
      attempt.verifier,
      attempt.nonce,
    );
    const { user } = await this.collaboration.activateGoogleUser(claims);
    return this.issueSession(res, user, "google", [
      cookie(OAUTH_COOKIE, "", {
        secure: this.config.secureCookies,
        clear: true,
      }),
    ]);
  }

  async logout(req, res) {
    const rawToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (rawToken)
      await rm(
        resolve(
          this.sessionRoot,
          `${secretDigest(rawToken, this.config.sessionSecret)}.yml`,
        ),
        { force: true },
      );
    res.writeHead(204, {
      "Set-Cookie": cookie(SESSION_COOKIE, "", {
        secure: this.config.secureCookies,
        clear: true,
      }),
      "Cache-Control": "no-store",
    });
    res.end();
  }
}

export function authConfigFromEnv(
  host = "127.0.0.1",
  port = 4310,
  environment = process.env,
) {
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(host);
  const configuredMode = environment.SPRINTMARK_AUTH_MODE;
  const mode = configuredMode || (environment.CLIENT_ID ? "google" : "local");
  if (mode === "local" && !loopback)
    throw new Error("local authentication mode is allowed only on loopback");
  if (!new Set(["local", "google"]).has(mode))
    throw new Error("SPRINTMARK_AUTH_MODE must be local or google");
  const baseUrl =
    environment.BASE_URL ||
    `http://${host === "::1" ? "localhost" : host}:${port}`;
  if (
    mode === "google" &&
    (!environment.CLIENT_ID || !environment.CLIENT_SECRET)
  )
    throw new Error("CLIENT_ID and CLIENT_SECRET are required for Google mode");
  if (mode === "google" && !environment.SESSION_SECRET)
    throw new Error("SESSION_SECRET is required for Google mode");
  if (
    mode === "google" &&
    environment.SESSION_SECRET &&
    environment.SESSION_SECRET.length < 32
  )
    throw new Error("SESSION_SECRET must be at least 32 characters");
  const baseUrlObject = new URL(baseUrl);
  const loopbackBaseUrl = ["127.0.0.1", "localhost", "::1"].includes(
    baseUrlObject.hostname,
  );
  if (
    mode === "google" &&
    baseUrlObject.protocol !== "https:" &&
    !(baseUrlObject.protocol === "http:" && loopbackBaseUrl)
  )
    throw new Error(
      "Google authentication requires HTTPS except on a loopback BASE_URL",
    );
  return {
    mode,
    clientId: environment.CLIENT_ID || null,
    clientSecret: environment.CLIENT_SECRET || null,
    sessionSecret:
      environment.SESSION_SECRET || "local-development-session-secret",
    baseUrl: baseUrl.replace(/\/$/, ""),
    secureCookies: baseUrlObject.protocol === "https:",
    bootstrapAdminEmails: environment.BOOTSTRAP_ADMIN_EMAILS || "",
    localName: environment.SPRINTMARK_LOCAL_USER_NAME || "Local user",
    localEmail:
      environment.SPRINTMARK_LOCAL_USER_EMAIL || "local@sprintmark.invalid",
  };
}

import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { authConfigFromEnv } from "./auth.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const AUTH_ENV_KEYS = [
  "SPRINTMARK_AUTH_MODE",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "BASE_URL",
  "SESSION_SECRET",
  "BOOTSTRAP_ADMIN_EMAILS",
  "SPRINTMARK_LOCAL_USER_NAME",
  "SPRINTMARK_LOCAL_USER_EMAIL",
  "SPRINTMARK_DATA_DIR",
  "SPRINTMARK_TIMEZONE",
  "SPRINTMARK_DEFAULT_LOCALE",
  "SPRINTMARK_HOST",
  "SPRINTMARK_PORT",
];

function clean(value) {
  const result = String(value || "").trim();
  if (/\r|\n/.test(result))
    throw new Error("Configuration values cannot contain newlines");
  return result;
}

export function isLoopbackHost(value) {
  return ["127.0.0.1", "localhost", "::1"].includes(
    String(value || "").toLowerCase(),
  );
}

export function isLoopbackAddress(value) {
  const normalized = String(value || "").toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

export function hasExplicitAuthConfiguration(environment = process.env) {
  return Boolean(
    clean(environment.SPRINTMARK_AUTH_MODE) ||
    clean(environment.CLIENT_ID) ||
    clean(environment.CLIENT_SECRET),
  );
}

export function normalizeEmails(value) {
  const emails = [
    ...new Set(
      clean(value)
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!emails.length || emails.some((email) => !EMAIL.test(email)))
    throw new Error(
      "At least one valid bootstrap administrator email is required",
    );
  return emails.join(",");
}

export function buildAuthEnvironment({
  mode = "google",
  clientId = "",
  clientSecret = "",
  baseUrl = "http://127.0.0.1:4310",
  sessionSecret = randomBytes(48).toString("base64url"),
  adminEmails = "",
  localName = "Local user",
  localEmail = "local@sprintmark.invalid",
  dataDir = "./data",
  timezone = "Europe/Istanbul",
  locale = "en",
  host = "127.0.0.1",
  port = "4310",
} = {}) {
  const normalizedMode = clean(mode).toLowerCase();
  if (!new Set(["google", "local"]).has(normalizedMode))
    throw new Error("Auth mode must be google or local");
  const normalizedLocalEmail = clean(localEmail).toLowerCase();
  if (normalizedMode === "local" && !EMAIL.test(normalizedLocalEmail))
    throw new Error("A valid local profile email is required");
  const environment = {
    SPRINTMARK_AUTH_MODE: normalizedMode,
    CLIENT_ID: normalizedMode === "google" ? clean(clientId) : "",
    CLIENT_SECRET: normalizedMode === "google" ? clean(clientSecret) : "",
    BASE_URL: clean(baseUrl).replace(/\/$/, ""),
    SESSION_SECRET: clean(sessionSecret),
    BOOTSTRAP_ADMIN_EMAILS:
      normalizedMode === "google" ? normalizeEmails(adminEmails) : "",
    SPRINTMARK_LOCAL_USER_NAME:
      normalizedMode === "local" ? clean(localName) || "Local user" : "",
    SPRINTMARK_LOCAL_USER_EMAIL:
      normalizedMode === "local" ? normalizedLocalEmail : "",
    SPRINTMARK_DATA_DIR: clean(dataDir) || "./data",
    SPRINTMARK_TIMEZONE: clean(timezone) || "Europe/Istanbul",
    SPRINTMARK_DEFAULT_LOCALE: clean(locale) || "en",
    SPRINTMARK_HOST: clean(host) || "127.0.0.1",
    SPRINTMARK_PORT: clean(port) || "4310",
  };
  const base = new URL(environment.BASE_URL);
  authConfigFromEnv(
    environment.SPRINTMARK_HOST,
    Number(environment.SPRINTMARK_PORT),
    environment,
  );
  if (
    normalizedMode === "google" &&
    !environment.CLIENT_ID.endsWith(".apps.googleusercontent.com")
  )
    throw new Error("CLIENT_ID must be a Google Web application client ID");
  return {
    environment,
    origin: base.origin,
    redirectUri: `${environment.BASE_URL}/auth/google/callback`,
  };
}

export function serializeEnvironment(environment) {
  return `${AUTH_ENV_KEYS.map((key) => `${key}=${JSON.stringify(environment[key] || "")}`).join("\n")}\n`;
}

function mergeEnvironment(existing, environment) {
  const keys = new Set(AUTH_ENV_KEYS);
  const preserved = String(existing || "")
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
      return !match || !keys.has(match[1]);
    });
  while (preserved.at(-1) === "") preserved.pop();
  const prefix = preserved.length ? `${preserved.join("\n")}\n` : "";
  return `${prefix}${serializeEnvironment(environment)}`;
}

export async function writeAuthEnvironment(path, environment) {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, mergeEnvironment(existing, environment), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

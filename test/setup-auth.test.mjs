import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { authConfigFromEnv } from "../src/auth.mjs";
import {
  buildAuthEnvironment,
  normalizeEmails,
  serializeEnvironment,
} from "../scripts/setup-auth.mjs";

const clientId = "123456789-example.apps.googleusercontent.com";
const clientSecret = "google-client-secret";
const sessionSecret = "s".repeat(48);

test("Google setup accepts HTTP only for an exact loopback base URL", () => {
  const local = buildAuthEnvironment({
    clientId,
    clientSecret,
    sessionSecret,
    adminEmails: "Owner@Example.com, owner@example.com",
  });
  assert.equal(local.redirectUri, "http://127.0.0.1:4310/auth/google/callback");
  assert.equal(local.environment.BOOTSTRAP_ADMIN_EMAILS, "owner@example.com");
  assert.equal(
    authConfigFromEnv("127.0.0.1", 4310, local.environment).secureCookies,
    false,
  );

  assert.throws(
    () =>
      buildAuthEnvironment({
        clientId,
        clientSecret,
        sessionSecret,
        adminEmails: "owner@example.com",
        baseUrl: "http://sprintmark.example.com",
      }),
    /requires HTTPS except on a loopback/,
  );
});

test("auth setup produces a complete quoted env file without leaking newlines", () => {
  const built = buildAuthEnvironment({
    clientId,
    clientSecret,
    sessionSecret,
    adminEmails: "owner@example.com,member@example.com",
    baseUrl: "https://sprintmark.example.com/",
  });
  const serialized = serializeEnvironment(built.environment);
  assert.match(serialized, /^SPRINTMARK_AUTH_MODE="google"/);
  assert.match(serialized, /SESSION_SECRET="s{48}"/);
  assert.match(serialized, /BASE_URL="https:\/\/sprintmark\.example\.com"/);
  assert.throws(() => normalizeEmails("owner@example.com\nINJECTED=value"));
});

test("npm start loads ignored environment files and exposes the setup wizard", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve("package.json"), "utf8"),
  );
  assert.match(packageJson.scripts.start, /--env-file-if-exists=\.env/);
  assert.match(packageJson.scripts.start, /--env-file-if-exists=\.env\.local/);
  assert.equal(
    packageJson.scripts["setup:auth"],
    "node scripts/setup-auth.mjs",
  );
});

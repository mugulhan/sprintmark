import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { authConfigFromEnv } from "../src/auth.mjs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORDER = [
  "SPRINTMARK_AUTH_MODE",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "BASE_URL",
  "SESSION_SECRET",
  "BOOTSTRAP_ADMIN_EMAILS",
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
  dataDir = "./data",
  timezone = "Europe/Istanbul",
  locale = "en",
  host = "127.0.0.1",
  port = "4310",
} = {}) {
  const normalizedMode = clean(mode).toLowerCase();
  if (!new Set(["google", "local"]).has(normalizedMode))
    throw new Error("Auth mode must be google or local");
  const environment = {
    SPRINTMARK_AUTH_MODE: normalizedMode,
    CLIENT_ID: normalizedMode === "google" ? clean(clientId) : "",
    CLIENT_SECRET: normalizedMode === "google" ? clean(clientSecret) : "",
    BASE_URL: clean(baseUrl).replace(/\/$/, ""),
    SESSION_SECRET: clean(sessionSecret),
    BOOTSTRAP_ADMIN_EMAILS:
      normalizedMode === "google" ? normalizeEmails(adminEmails) : "",
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
  return `${ORDER.map((key) => `${key}=${JSON.stringify(environment[key] || "")}`).join("\n")}\n`;
}

function parseOptions(argv) {
  return Object.fromEntries(
    argv
      .filter((value) => value.startsWith("--"))
      .map((value) => {
        const [key, ...rest] = value.slice(2).split("=");
        return [key, rest.length ? rest.join("=") : true];
      }),
  );
}

class MutedOutput extends Writable {
  muted = false;

  _write(chunk, encoding, callback) {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
}

async function run() {
  const options = parseOptions(process.argv.slice(2));
  const nonInteractive = Boolean(options["non-interactive"]);
  const output = resolve(String(options.output || ".env.local"));
  const terminalOutput = new MutedOutput();
  const prompts = createInterface({
    input: process.stdin,
    output: terminalOutput,
    terminal: true,
  });
  const ask = async (label, fallback = "") => {
    if (nonInteractive) return fallback;
    const suffix = fallback ? ` [${fallback}]` : "";
    return clean((await prompts.question(`${label}${suffix}: `)) || fallback);
  };
  const askSecret = async (label, fallback = "") => {
    if (nonInteractive) return fallback;
    const pending = prompts.question(`${label}: `);
    terminalOutput.muted = true;
    const answer = await pending;
    terminalOutput.muted = false;
    process.stdout.write("\n");
    return clean(answer || fallback);
  };

  try {
    const mode = clean(
      options.mode ||
        process.env.SPRINTMARK_AUTH_MODE ||
        (await ask("Authentication mode", "google")),
    ).toLowerCase();
    const baseUrl = clean(
      options["base-url"] ||
        process.env.BASE_URL ||
        (await ask("Application base URL", "http://127.0.0.1:4310")),
    );
    const clientId =
      mode === "google"
        ? clean(
            options["client-id"] ||
              (await ask("Google Web client ID", process.env.CLIENT_ID || "")),
          )
        : "";
    const clientSecret =
      mode === "google"
        ? clean(
            options["client-secret"] ||
              process.env.CLIENT_SECRET ||
              (await askSecret("Google client secret")),
          )
        : "";
    const adminEmails =
      mode === "google"
        ? clean(
            options.admin ||
              (await ask(
                "Bootstrap administrator emails (comma-separated)",
                process.env.BOOTSTRAP_ADMIN_EMAILS || "",
              )),
          )
        : "";
    const built = buildAuthEnvironment({
      mode,
      clientId,
      clientSecret,
      baseUrl,
      adminEmails,
      sessionSecret: clean(
        options["session-secret"] ||
          process.env.SESSION_SECRET ||
          randomBytes(48).toString("base64url"),
      ),
    });
    let force = Boolean(options.force);
    if (!force && !nonInteractive) {
      const overwrite = await ask(`Overwrite ${output} if it exists?`, "no");
      force = /^y(?:es)?$/i.test(overwrite);
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, serializeEnvironment(built.environment), {
      encoding: "utf8",
      mode: 0o600,
      flag: force ? "w" : "wx",
    });
    process.stdout.write(
      `\nAuthentication configuration written to ${output}\n`,
    );
    if (mode === "google") {
      process.stdout.write(
        `Google authorized redirect URI: ${built.redirectUri}\n`,
      );
      process.stdout.write(
        `Google authorized JavaScript origin (if requested): ${built.origin}\n`,
      );
    }
    process.stdout.write("Start Sprintmark with: npm start\n");
  } finally {
    prompts.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  run().catch((error) => {
    process.stderr.write(`Auth setup failed: ${error.message}\n`);
    process.exitCode = 1;
  });

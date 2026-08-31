import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthEnvironment,
  normalizeEmails,
  serializeEnvironment,
  writeAuthEnvironment,
} from "../src/setup-config.mjs";

export { buildAuthEnvironment, normalizeEmails, serializeEnvironment };

function clean(value) {
  const result = String(value || "").trim();
  if (/\r|\n/.test(result))
    throw new Error("Configuration values cannot contain newlines");
  return result;
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
    if (!force) {
      const { access } = await import("node:fs/promises");
      await access(output)
        .then(() => {
          throw new Error(`${output} already exists; use --force to update it`);
        })
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
    await writeAuthEnvironment(output, built.environment);
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

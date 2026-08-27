import { createReadStream } from "node:fs";
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
const VERSION = "0.8.0";
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

function publicRecord(record) {
  const safe = { ...record };
  delete safe._path;
  return safe;
}

function publicProject(project) {
  const safe = { ...project };
  delete safe._path;
  return safe;
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

export function createWorkTrackerServer({ workspace = defaultWorkspace } = {}) {
  const store = new WorkItemStore(workspace);
  const draftStore = new DraftStore(workspace);
  const projectStore = new ProjectStore(workspace);
  const sprintStore = new SprintStore(workspace);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const path = decodeURIComponent(url.pathname);
      if (path === "/healthz")
        return send(res, 200, { status: "ok", version: VERSION });
      if (path === "/api/v1/meta")
        return send(res, 200, {
          version: VERSION,
          timezone:
            process.env.SPRINTMARK_TIMEZONE ||
            Intl.DateTimeFormat().resolvedOptions().timeZone,
          default_locale: process.env.SPRINTMARK_DEFAULT_LOCALE || "en",
          ...(await gitMeta(workspace)),
        });
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
        const projects = await projectStore.all();
        return send(res, 200, {
          items: projects.map(publicProject),
          count: projects.length,
        });
      }
      if (path === "/api/v1/projects" && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        return send(
          res,
          201,
          publicProject(await projectStore.create(await jsonBody(req))),
        );
      }
      const projectKeyApi = path.match(/^\/api\/v1\/projects\/(PRJ-\d{3})$/i);
      if (projectKeyApi && req.method === "GET") {
        const project = await projectStore.byKey(projectKeyApi[1]);
        if (!project) return send(res, 404, { error: "not_found" });
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
        const project = await projectStore.patch(
          projectUidApi[1],
          await jsonBody(req),
          req.headers["if-match"],
        );
        return send(res, 200, publicProject(project), {
          ETag: project._etag,
        });
      }
      const projectDocumentsApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})\/documents$/i,
      );
      if (projectDocumentsApi && req.method === "GET") {
        const items = await projectStore.documents(projectDocumentsApi[1]);
        return send(res, 200, { items, count: items.length });
      }
      if (projectDocumentsApi && req.method === "POST") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const { file } = await attachmentBody(req);
        if (!file?.data?.length)
          return send(res, 400, { error: "file_required" });
        const result = await projectStore.addDocument(
          projectDocumentsApi[1],
          file,
          req.headers["if-match"],
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
        const input = await jsonBody(req);
        const project = await projectStore.addDocumentReference(
          projectDocumentReferenceApi[1],
          input.path,
          req.headers["if-match"],
        );
        return send(res, 201, publicProject(project), { ETag: project._etag });
      }
      const projectDocumentDeleteApi = path.match(
        /^\/api\/v1\/projects\/([0-9a-f-]{36})\/documents\/(\d+)$/i,
      );
      if (projectDocumentDeleteApi && req.method === "DELETE") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const project = await projectStore.removeDocument(
          projectDocumentDeleteApi[1],
          projectDocumentDeleteApi[2],
          req.headers["if-match"],
        );
        return send(res, 200, publicProject(project), { ETag: project._etag });
      }
      if (path === "/api/v1/sprints" && req.method === "GET") {
        let sprints = await sprintStore.all();
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
        if (url.searchParams.get("kind"))
          records = records.filter(
            (r) => r.kind === url.searchParams.get("kind"),
          );
        if (url.searchParams.get("team"))
          records = records.filter(
            (r) => r.team === url.searchParams.get("team"),
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
          items: records.map(publicRecord),
          count: records.length,
        });
      }
      const keyApi = path.match(
        /^\/api\/v1\/work-items\/([A-Z][A-Z0-9]{1,7}-(?:\d{4}[A-Z]?|BL-\d{3}))$/i,
      );
      if (keyApi && req.method === "GET") {
        const record = await store.byKey(keyApi[1]);
        if (!record) return send(res, 404, { error: "not_found" });
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
            { attachments: promotion?.attachments || [] },
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
        const items = await store.fileReferences(fileReferencesApi[1]);
        return send(res, 200, { items, count: items.length });
      }
      const uidApi = path.match(/^\/api\/v1\/work-items\/([0-9a-f-]{36})$/i);
      if (uidApi && req.method === "PATCH") {
        if (!writeAllowed(req))
          return send(res, 403, { error: "origin_not_allowed" });
        const input = await jsonBody(req);
        if (input.project_key && !(await projectStore.byKey(input.project_key)))
          return send(res, 400, { error: "project_not_found" });
        let promotion = null;
        try {
          if (input.draft_id)
            promotion = await draftStore.preparePromotion(
              input.draft_id,
              uidApi[1],
              input.body,
            );
          delete input.draft_id;
          const record = await store.patch(
            uidApi[1],
            { ...input, body: promotion?.body ?? input.body },
            req.headers["if-match"],
            { attachments: promotion?.attachments || [] },
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
        const { fields, file } = await attachmentBody(req);
        if (!file?.data?.length)
          return send(res, 400, { error: "file_required" });
        const result = await store.addAttachment(
          attachmentApi[1],
          file,
          fields.placement,
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
        const record = await store.removeAttachment(
          attachmentDeleteApi[1],
          decodeURIComponent(attachmentDeleteApi[2]),
          req.headers["if-match"],
        );
        return send(res, 200, publicRecord(record), { ETag: record._etag });
      }
      const attachment = path.match(
        /^\/attachments\/([0-9a-f-]{36})\/([^/]+)$/i,
      );
      if (attachment) {
        const file = await store.attachmentPath(attachment[1], attachment[2]);
        const record = file ? await store.byUid(attachment[1]) : null;
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
      const toastUiFiles = new Map([
        ["/vendor/toastui-editor.css", "toastui-editor.css"],
      ]);
      if (path === "/vendor/toastui-editor.js")
        return streamFile(res, toastUiBundle);
      if (toastUiFiles.has(path))
        return streamFile(res, resolve(toastUiRoot, toastUiFiles.get(path)));
      if (path === "/vendor/dompurify.js")
        return streamFile(res, resolve(domPurifyRoot, "purify.js"));
      if (path === "/" || path === "/index.html")
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

import { createServer } from "node:http";
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
  createWorkTrackerServer({ workspace }).listen(port, host, () =>
    console.log(`Sprintmark v${VERSION}: http://${host}:${port}`),
  );
}

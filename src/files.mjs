import { realpath, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

export const IMAGE_LIMIT = 8 * 1024 * 1024;
export const FILE_LIMIT = 25 * 1024 * 1024;

const fileTypes = new Map([
  [".png", { type: "image/png", inline: true }],
  [".jpg", { type: "image/jpeg", inline: true }],
  [".jpeg", { type: "image/jpeg", inline: true }],
  [".webp", { type: "image/webp", inline: true }],
  [".gif", { type: "image/gif", inline: true }],
  [".pdf", { type: "application/pdf", inline: true }],
  [".csv", { type: "text/csv; charset=utf-8", inline: true }],
  [".json", { type: "application/json; charset=utf-8", inline: true }],
  [".txt", { type: "text/plain; charset=utf-8", inline: true }],
  [".md", { type: "text/markdown; charset=utf-8", inline: true }],
  [
    ".xlsx",
    {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      inline: false,
    },
  ],
  [
    ".docx",
    {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      inline: false,
    },
  ],
]);

const acceptedMimeTypes = new Map([
  [".png", new Set(["image/png"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".webp", new Set(["image/webp"])],
  [".gif", new Set(["image/gif"])],
  [".pdf", new Set(["application/pdf"])],
  [".csv", new Set(["text/csv", "application/csv"])],
  [".json", new Set(["application/json", "text/json"])],
  [".txt", new Set(["text/plain"])],
  [".md", new Set(["text/markdown", "text/plain"])],
  [
    ".xlsx",
    new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
  ],
  [
    ".docx",
    new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
  ],
]);

function startsWith(data, signature) {
  return (
    Buffer.isBuffer(data) &&
    data.length >= signature.length &&
    data.subarray(0, signature.length).equals(signature)
  );
}

function isZip(data) {
  return ["504b0304", "504b0506", "504b0708"].some((signature) =>
    startsWith(data, Buffer.from(signature, "hex")),
  );
}

function utf8Text(data) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

export function sniffImageType(data) {
  if (!Buffer.isBuffer(data)) return null;
  if (startsWith(data, Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))
  )
    return "image/gif";
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

export function validateImage(file) {
  const extension = extname(file.name || "").toLowerCase();
  const allowed = acceptedMimeTypes.get(extension);
  if (!file.data?.length || file.data.length > IMAGE_LIMIT)
    throw Object.assign(new Error("image must be between 1 byte and 8 MB"), {
      statusCode: 413,
    });
  const detected = sniffImageType(file.data);
  if (!allowed?.has(file.type) || detected !== file.type)
    throw Object.assign(new Error("unsupported or mismatched image type"), {
      statusCode: 415,
    });
  return {
    extension: extension === ".jpeg" ? ".jpg" : extension,
    type: detected,
  };
}

export function validateAttachment(file, placement = "evidence") {
  if (placement === "body") return validateImage(file);
  if (!file.data?.length || file.data.length > FILE_LIMIT)
    throw Object.assign(new Error("file must be between 1 byte and 25 MB"), {
      statusCode: 413,
    });
  const extension = extname(file.name || "").toLowerCase();
  const spec = fileTypes.get(extension);
  const allowed = acceptedMimeTypes.get(extension);
  if (!spec || !allowed?.has(file.type))
    throw Object.assign(new Error("unsupported or mismatched file type"), {
      statusCode: 415,
    });

  let valid = true;
  if (spec.type.startsWith("image/"))
    valid = sniffImageType(file.data) === spec.type;
  else if (extension === ".pdf")
    valid = startsWith(file.data, Buffer.from("%PDF-", "ascii"));
  else if (extension === ".xlsx" || extension === ".docx")
    valid = isZip(file.data);
  else {
    const text = utf8Text(file.data);
    valid = text !== null && !text.includes("\0");
    if (valid && extension === ".json") {
      try {
        JSON.parse(text.replace(/^\uFEFF/, ""));
      } catch {
        valid = false;
      }
    }
  }
  if (!valid)
    throw Object.assign(new Error("unsupported or mismatched file content"), {
      statusCode: 415,
    });
  return {
    extension: extension === ".jpeg" ? ".jpg" : extension,
    type: spec.type.split(";")[0],
  };
}

export function fileTypeForName(name) {
  return (
    fileTypes.get(extname(name || "").toLowerCase()) || {
      type: "application/octet-stream",
      inline: false,
    }
  );
}

function normalizeRelativeReference(value) {
  const normalized = String(value || "")
    .trim()
    .replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.includes("\0")
  )
    return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

export function normalizeWorkspaceReference(value) {
  const normalized = normalizeRelativeReference(value);
  if (!normalized) return null;
  if (!(
    normalized.startsWith("data/") || normalized.startsWith("docs/evidence/")
  ))
    return null;
  return normalized;
}

export function normalizeProjectDocumentReference(value) {
  const normalized = normalizeRelativeReference(value);
  if (!normalized) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => part.startsWith("."))) return null;
  if (!fileTypes.has(extname(normalized).toLowerCase())) return null;
  return normalized;
}

export function extractWorkspaceReferences(record) {
  const candidates = (record.attachments || []).filter(
    (entry) => typeof entry === "string",
  );
  for (const match of String(record.body || "").matchAll(/`([^`\r\n]+)`/g))
    candidates.push(match[1]);
  return [
    ...new Set(candidates.map(normalizeWorkspaceReference).filter(Boolean)),
  ];
}

async function referenceInfo(workspace, value, normalizer) {
  const reference = normalizer(value);
  if (!reference) return null;
  const workspaceRoot = resolve(workspace);
  const candidate = resolve(workspaceRoot, ...reference.split("/"));
  const relativeCandidate = relative(workspaceRoot, candidate);
  if (
    !relativeCandidate ||
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${sep}`)
  )
    return null;

  const type = fileTypeForName(reference);
  try {
    const [realWorkspace, realCandidate, info] = await Promise.all([
      realpath(workspaceRoot),
      realpath(candidate),
      stat(candidate),
    ]);
    const realRelative = relative(realWorkspace, realCandidate);
    if (
      !info.isFile() ||
      !realRelative ||
      realRelative === ".." ||
      realRelative.startsWith(`..${sep}`)
    )
      return null;
    return {
      path: reference,
      name: basename(candidate),
      type: type.type,
      inline: type.inline,
      size: info.size,
      exists: true,
      file: realCandidate,
    };
  } catch (error) {
    if (error.code !== "ENOENT") return null;
    return {
      path: reference,
      name: basename(candidate),
      type: type.type,
      inline: type.inline,
      size: null,
      exists: false,
      file: null,
    };
  }
}

export async function workspaceReferenceInfo(workspace, value) {
  return referenceInfo(workspace, value, normalizeWorkspaceReference);
}

export async function projectDocumentReferenceInfo(workspace, value) {
  return referenceInfo(workspace, value, normalizeProjectDocumentReference);
}

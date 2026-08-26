import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { newUid, slugify, UUID_PATTERN } from "./identity.mjs";
import { validateImage } from "./store.mjs";

const TTL_MS = 24 * 60 * 60 * 1000;

export class DraftStore {
  constructor(workspace, { now = () => new Date() } = {}) {
    this.workspace = workspace;
    this.now = now;
    this.root = resolve(workspace, "data", "work-tracker", "drafts");
  }

  async create() {
    await this.cleanupExpired();
    const id = newUid();
    const createdAt = this.now();
    const draft = {
      id,
      created_at: createdAt.toISOString(),
      expires_at: new Date(createdAt.getTime() + TTL_MS).toISOString(),
      attachments: [],
    };
    await this.write(draft);
    return draft;
  }

  directory(id) {
    if (!UUID_PATTERN.test(id || "")) return null;
    const directory = resolve(this.root, id);
    return directory.startsWith(`${this.root}${sep}`) ? directory : null;
  }

  async read(id) {
    const directory = this.directory(id);
    if (!directory) return null;
    try {
      const draft = JSON.parse(
        await readFile(resolve(directory, "manifest.json"), "utf8"),
      );
      if (new Date(draft.expires_at).getTime() <= this.now().getTime()) {
        await this.delete(id);
        return null;
      }
      return draft;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async write(draft) {
    const directory = this.directory(draft.id);
    if (!directory) throw new Error("invalid draft id");
    await mkdir(directory, { recursive: true });
    const target = resolve(directory, "manifest.json");
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async addAttachment(id, file, placement = "evidence", alt = "") {
    const draft = await this.read(id);
    if (!draft)
      throw Object.assign(new Error("draft not found or expired"), {
        statusCode: 404,
      });
    if (draft.attachments.length >= 20)
      throw Object.assign(new Error("attachment limit reached"), {
        statusCode: 409,
      });
    const allowed = validateImage(file);
    const directory = this.directory(id);
    const cleanBase = slugify(
      basename(file.name || "clipboard-image", extname(file.name || "")),
    );
    const name = `${Date.now()}-${newUid().slice(0, 8)}-${cleanBase}${allowed.get(file.type)}`;
    const path = resolve(directory, name);
    if (!path.startsWith(`${directory}${sep}`))
      throw Object.assign(new Error("unsafe attachment path"), {
        statusCode: 400,
      });
    await writeFile(path, file.data);
    const attachment = {
      name,
      original_name: file.name || name,
      type: file.type,
      size: file.data.length,
      created_at: this.now().toISOString(),
      url: `/draft-attachments/${id}/${name}`,
      placement: placement === "body" ? "body" : "evidence",
      alt: String(alt || "").trim(),
    };
    draft.attachments.push(attachment);
    try {
      await this.write(draft);
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    return attachment;
  }

  async preparePromotion(id, uid, body = "") {
    const draft = await this.read(id);
    if (!draft)
      throw Object.assign(new Error("draft not found or expired"), {
        statusCode: 404,
      });
    const source = this.directory(id);
    const target = resolve(
      this.workspace,
      "data",
      "work-tracker",
      "attachments",
      uid,
    );
    await mkdir(target, { recursive: true });
    const copied = [];
    const attachments = [];
    let rewrittenBody = String(body || "");
    try {
      for (const attachment of draft.attachments) {
        const sourcePath = resolve(source, attachment.name);
        const targetPath = resolve(target, attachment.name);
        if (
          !sourcePath.startsWith(`${source}${sep}`) ||
          !targetPath.startsWith(`${target}${sep}`)
        )
          throw new Error("unsafe attachment path");
        await copyFile(sourcePath, targetPath);
        copied.push(targetPath);
        const finalUrl = `/attachments/${uid}/${attachment.name}`;
        rewrittenBody = rewrittenBody.replaceAll(attachment.url, finalUrl);
        attachments.push({ ...attachment, url: finalUrl });
      }
    } catch (error) {
      await Promise.all(copied.map((path) => rm(path, { force: true })));
      throw error;
    }
    return { draftId: id, attachments, body: rewrittenBody, copied };
  }

  async rollback(promotion) {
    await Promise.all(
      (promotion?.copied || []).map((path) => rm(path, { force: true })),
    );
  }

  async finalize(promotion) {
    if (promotion?.draftId) await this.delete(promotion.draftId);
  }

  async delete(id) {
    const directory = this.directory(id);
    if (!directory) return false;
    await rm(directory, { recursive: true, force: true });
    return true;
  }

  async attachmentPath(id, name) {
    const draft = await this.read(id);
    if (!draft || basename(name) !== name) return null;
    const directory = this.directory(id);
    const path = resolve(directory, name);
    if (!path.startsWith(`${directory}${sep}`)) return null;
    if (!draft.attachments.some((attachment) => attachment.name === name))
      return null;
    try {
      await stat(path);
      return path;
    } catch {
      return null;
    }
  }

  async cleanupExpired() {
    let names = [];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return;
    }
    await Promise.all(
      names.map(async (name) => {
        const directory = this.directory(name);
        if (!directory) return;
        try {
          const draft = JSON.parse(
            await readFile(resolve(directory, "manifest.json"), "utf8"),
          );
          if (new Date(draft.expires_at).getTime() <= this.now().getTime())
            await this.delete(name);
        } catch {
          await this.delete(name);
        }
      }),
    );
  }
}

import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DraftStore } from "../src/drafts.mjs";

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("draft attachments validate signatures, promote URLs and expire", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-draft-"));
  let now = new Date("2026-08-26T10:00:00.000Z");
  const store = new DraftStore(workspace, { now: () => now });
  const draft = await store.create();
  const attachment = await store.addAttachment(
    draft.id,
    { name: "clipboard.png", type: "image/png", data: png },
    "body",
    "Diagram",
  );
  const uid = "11111111-1111-4111-8111-111111111111";
  const promotion = await store.preparePromotion(
    draft.id,
    uid,
    `![Diagram](${attachment.url})`,
  );
  assert.match(promotion.body, new RegExp(`/attachments/${uid}/`));
  assert.equal(promotion.attachments[0].placement, "body");
  await stat(promotion.copied[0]);
  await store.rollback(promotion);

  now = new Date("2026-08-27T10:00:01.000Z");
  assert.equal(await store.read(draft.id), null);
});

test("draft attachments reject MIME and signature mismatches", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sprintmark-draft-"));
  const store = new DraftStore(workspace);
  const draft = await store.create();
  await assert.rejects(
    () =>
      store.addAttachment(draft.id, {
        name: "fake.png",
        type: "image/png",
        data: Buffer.from("not a png"),
      }),
    (error) => error.statusCode === 415,
  );
});

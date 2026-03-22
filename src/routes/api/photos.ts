// NOTE: If a DELETE /api/listings/:id endpoint is added in the future,
// it must also delete the listing's photo objects from MinIO.

import { type AuthEnv, bearerAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadObject, deleteObject, getPublicUrl } from "@/lib/minio";
import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import z from "zod";

export const photos = new Hono<AuthEnv>();

photos.use(bearerAuth);

function extFromMime(mimeType: string, originalName: string): string {
  const fromMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  if (fromMime[mimeType]) return fromMime[mimeType];
  const dotIndex = originalName.lastIndexOf(".");
  if (dotIndex !== -1) return originalName.slice(dotIndex);
  return ".bin";
}

photos.post("/:id/photos", async (c) => {
  const pubkey = c.get("pubkey");
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.text("Invalid id", 400);

  const listing = await prisma.listing.findFirst({
    where: { id, sellerPubkey: pubkey },
  });
  if (!listing) return c.text("Listing not found", 404);

  const existingCount = await prisma.listingPhoto.count({
    where: { listingId: id },
  });

  const body = await c.req.parseBody({ all: true });
  const raw = body["photos"];

  if (!raw) return c.text("No photos provided", 400);

  const files = Array.isArray(raw) ? raw : [raw];
  const imageFiles = files.filter((f): f is File => f instanceof File);

  if (imageFiles.length === 0) return c.text("No photos provided", 400);

  if (existingCount + imageFiles.length > 10) {
    return c.text("Maximum 10 photos per listing", 400);
  }

  for (const file of imageFiles) {
    if (file.size > 4 * 1024 * 1024) {
      return c.text(`File exceeds 4MB limit: ${file.name}`, 400);
    }
    if (!file.type.startsWith("image/")) {
      return c.text(`Only image files are allowed: ${file.name}`, 400);
    }
  }

  const uploadedKeys: string[] = [];

  try {
    const created = await prisma.$transaction(async (tx) => {
      const results = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i]!;
        const ext = extFromMime(file.type, file.name);
        const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
        const objectKey = `listings/${id}/${filename}`;

        await uploadObject(objectKey, Buffer.from(await file.arrayBuffer()), file.type);
        uploadedKeys.push(objectKey);

        const photo = await tx.listingPhoto.create({
          data: {
            listingId: id,
            filename: objectKey,
            mimeType: file.type,
            size: file.size,
            position: existingCount + i,
          },
        });
        results.push(photo);
      }
      return results;
    });

    return c.json(
      created.map((p) => ({ ...p, url: getPublicUrl(p.filename) })),
      201,
    );
  } catch (_err) {
    for (const key of uploadedKeys) {
      await deleteObject(key).catch(() => {});
    }
    return c.text("Failed to upload photos", 500);
  }
});

photos.delete("/:id/photos/:photoId", async (c) => {
  const pubkey = c.get("pubkey");
  const id = Number(c.req.param("id"));
  const photoId = Number(c.req.param("photoId"));
  if (isNaN(id) || isNaN(photoId)) return c.text("Invalid id", 400);

  const photo = await prisma.listingPhoto.findFirst({
    where: { id: photoId, listingId: id, listing: { sellerPubkey: pubkey } },
  });
  if (!photo) return c.text("Photo not found", 404);

  await prisma.listingPhoto.delete({ where: { id: photoId } });

  await deleteObject(photo.filename).catch(() => {});

  return c.json({ deleted: true });
});

photos.patch(
  "/:id/photos/order",
  sValidator("json", z.object({ photoIds: z.array(z.number().int().positive()) })),
  async (c) => {
    const pubkey = c.get("pubkey");
    const id = Number(c.req.param("id"));
    if (isNaN(id)) return c.text("Invalid id", 400);

    const { photoIds } = c.req.valid("json");

    const existing = await prisma.listingPhoto.findMany({
      where: { listingId: id, listing: { sellerPubkey: pubkey } },
    });
    if (existing.length === 0) return c.text("Listing not found or no photos", 404);

    const existingIds = new Set(existing.map((p) => p.id));
    const incomingIds = new Set(photoIds);

    if (
      photoIds.length !== existing.length ||
      !photoIds.every((pid) => existingIds.has(pid)) ||
      ![...existingIds].every((eid) => incomingIds.has(eid))
    ) {
      return c.text("photoIds must contain exactly the same IDs as existing photos", 400);
    }

    const updated = await prisma.$transaction(
      photoIds.map((photoId, index) =>
        prisma.listingPhoto.update({
          where: { id: photoId },
          data: { position: index },
        }),
      ),
    );

    return c.json(updated.sort((a, b) => a.position - b.position));
  },
);

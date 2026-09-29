import { defineSessionRoute } from "@/lib/http/route";
import { uploadAvatarSchema } from "@/modules/identity/identity.schema";
import { getOwnAvatar, removeOwnAvatar, setOwnAvatar } from "@/modules/identity/identity.service";

/**
 * The signed-in user's own profile picture. GET serves the image bytes
 * (type from the stored, signature-checked value; never sniffed or run as
 * a document); PUT replaces it (JSON body, base64, max 256 KB); DELETE
 * returns to initials. Nobody can read or change another user's picture.
 */
export const GET = defineSessionRoute({
  handler: async ({ ctx }) => {
    const avatar = await getOwnAvatar(ctx.userId);
    return new Response(avatar.data, {
      headers: {
        "content-type": avatar.contentType,
        "content-length": String(avatar.byteSize),
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  },
});

export const PUT = defineSessionRoute({
  body: uploadAvatarSchema,
  handler: async ({ ctx, body }) => setOwnAvatar(ctx, body),
});

export const DELETE = defineSessionRoute({
  handler: async ({ ctx }) => removeOwnAvatar(ctx),
});

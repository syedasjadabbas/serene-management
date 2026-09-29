"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { type ChangeEvent, useId, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";
import { Button, buttonClass } from "@/components/ui/Button";
import { FormDialog } from "@/components/ui/FormDialog";
import { TextField } from "@/components/ui/TextField";
import { cn } from "@/components/ui/cn";
import {
  useRemoveAvatarMutation,
  useUpdateProfileMutation,
  useUploadAvatarMutation,
} from "@/lib/api/endpoints/session.api";
import { toClientApiError } from "@/lib/api/errors";
import type { MeView } from "@/modules/access/access.types";

const SIZE = 256;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

type Photo =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "new"; dataUrl: string; data: string; contentType: "image/webp" | "image/jpeg" };

/**
 * Crops the chosen image to a centred square and resizes it to 256 px in the
 * browser, so only a small WebP (JPEG where WebP encoding is unavailable)
 * is uploaded. The server re-checks type, signature and size.
 */
async function prepareAvatar(file: File): Promise<Extract<Photo, { kind: "new" }>> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (JPEG, PNG or WebP).");
  if (file.size > MAX_INPUT_BYTES) throw new Error("The image is larger than 15 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image could not be read. Try a JPEG or PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot process images.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, SIZE, SIZE);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();
  let contentType: "image/webp" | "image/jpeg" = "image/webp";
  let dataUrl = canvas.toDataURL(contentType, 0.86);
  if (!dataUrl.startsWith("data:image/webp")) {
    contentType = "image/jpeg";
    dataUrl = canvas.toDataURL(contentType, 0.86);
  }
  return { kind: "new", dataUrl, data: dataUrl.slice(dataUrl.indexOf(",") + 1), contentType };
}

/**
 * The signed-in user edits their own profile: picture and display name.
 * Email and roles stay with administrators. The picture is stored on the
 * server, so it appears again after signing out and on other devices.
 */
export function ProfileDialog({ me, onClose }: { me: MeView; onClose: () => void }) {
  const [updateProfile, profileState] = useUpdateProfileMutation();
  const [uploadAvatar, uploadState] = useUploadAvatarMutation();
  const [removeAvatar, removeState] = useRemoveAvatarMutation();
  const [name, setName] = useState(me.user.displayName);
  const [photo, setPhoto] = useState<Photo>({ kind: "keep" });
  const [fileError, setFileError] = useState<string | null>(null);
  const inputId = useId();

  const apiError =
    toClientApiError(profileState.error) ??
    toClientApiError(uploadState.error) ??
    toClientApiError(removeState.error);
  const pending = profileState.isLoading || uploadState.isLoading || removeState.isLoading;
  const trimmed = name.trim();
  const nameChanged = trimmed !== me.user.displayName;
  const changed = nameChanged || photo.kind !== "keep";
  const preview =
    photo.kind === "new" ? photo.dataUrl : photo.kind === "remove" ? null : me.user.avatarUrl;
  const hasPicture = Boolean(preview);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    try {
      setPhoto(await prepareAvatar(file));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "This image could not be used.");
    }
  }

  async function save() {
    if (nameChanged) {
      const result = await updateProfile({ displayName: trimmed });
      if ("error" in result) return;
    }
    if (photo.kind === "new") {
      const result = await uploadAvatar({ contentType: photo.contentType, data: photo.data });
      if ("error" in result) return;
    } else if (photo.kind === "remove") {
      const result = await removeAvatar();
      if ("error" in result) return;
    }
    onClose();
  }

  return (
    <FormDialog
      title="Edit profile"
      description="Your picture and name as other staff see them. Email and roles are managed by an administrator."
      onClose={onClose}
      onSubmit={() => void save()}
      submitLabel="Save profile"
      disabled={!changed || trimmed.length === 0}
      pending={pending}
      error={apiError}
    >
      <div className="flex items-center gap-4">
        <Avatar name={trimmed || me.user.displayName} src={preview} size="xl" tone="solid" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              id={inputId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => void choose(event)}
              className="peer sr-only"
            />
            <label
              htmlFor={inputId}
              className={cn(
                buttonClass("secondary", "sm"),
                "cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
              )}
            >
              <ImageUp aria-hidden="true" className="size-3.5" />
              {hasPicture ? "Change photo" : "Upload photo"}
            </label>
            {hasPicture ? (
              <Button variant="ghost" size="sm" onClick={() => setPhoto({ kind: "remove" })}>
                <Trash2 aria-hidden="true" className="size-3.5" />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">JPEG, PNG or WebP. Cropped to a square.</p>
        </div>
      </div>
      {fileError ? <Alert tone="danger">{fileError}</Alert> : null}
      <TextField
        label="Display name"
        value={name}
        maxLength={120}
        autoComplete="name"
        onChange={(event) => setName(event.target.value)}
        errors={apiError?.fieldErrors.displayName}
      />
      <TextField
        label="Email"
        value={me.user.email}
        disabled
        hint="Ask an administrator to change it."
      />
    </FormDialog>
  );
}

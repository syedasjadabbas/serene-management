/** Types used by the session endpoints (re-exported from the shared contracts). */
export type {
  ChangePasswordInput,
  CompletePasswordResetInput,
  LoginInput,
  UpdateProfileInput,
  UploadAvatarInput,
} from "@serene/shared/modules/identity/identity.schema";
export type { LoginResult, SessionView } from "@serene/shared/modules/identity/identity.types";
export type { MeView } from "@serene/shared/modules/access/access.types";

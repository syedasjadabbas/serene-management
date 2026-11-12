import type {
  ChangePasswordInput,
  CompletePasswordResetInput,
  LoginInput,
  UpdateProfileInput,
  UploadAvatarInput,
} from "@serene/shared/modules/identity/identity.schema";
import type { LoginResult, SessionView } from "@serene/shared/modules/identity/identity.types";
import type { MeView } from "@serene/shared/modules/access/access.types";
import type { ApiSuccess } from "@serene/shared/types/api";
import { useAuthStore } from "@/global/stores/auth.store";
import { baseApi } from "../baseApi";

/** `POST /auth/login` data: the access token (memory only) plus the user. */
export type LoginResponse = LoginResult & { accessToken: string; expiresIn: number };

function adoptToken(data: { accessToken?: unknown; expiresIn?: unknown } | undefined) {
  if (typeof data?.accessToken === "string") {
    useAuthStore.getState().setSession(data.accessToken, Number(data.expiresIn ?? 0));
  }
}

/**
 * Session endpoints. Shared: login and logout are used by the auth pages and
 * the workspace shell; `me` backs permission checks in every route.
 */
export const sessionApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    me: build.query<MeView, void>({
      query: () => "/me",
      transformResponse: (response: ApiSuccess<MeView>) => response.data,
      providesTags: ["Me"],
    }),
    login: build.mutation<LoginResponse, LoginInput>({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
      transformResponse: (response: ApiSuccess<LoginResponse>) => response.data,
      async onQueryStarted(_arg, { queryFulfilled }) {
        try {
          adoptToken((await queryFulfilled).data);
        } catch {
          // Failed sign-in: the form shows the error.
        }
      },
    }),
    logout: build.mutation<void, void>({
      query: () => ({ url: "/auth/logout", method: "POST" }),
    }),
    /** The signed-in user's active sessions (browsers and devices). */
    sessions: build.query<SessionView[], void>({
      query: () => "/auth/sessions",
      transformResponse: (response: ApiSuccess<SessionView[]>) => response.data,
      providesTags: ["Session"],
    }),
    /** Signs one of the user's own sessions out; `current` means this browser. */
    revokeSession: build.mutation<{ revoked: true; current: boolean }, string>({
      query: (sessionId) => ({ url: `/auth/sessions/${sessionId}`, method: "DELETE" }),
      transformResponse: (response: ApiSuccess<{ revoked: true; current: boolean }>) =>
        response.data,
      invalidatesTags: ["Session"],
    }),
    /** Every other session is signed out; this browser gets a fresh session. */
    changePassword: build.mutation<{ changed: true }, ChangePasswordInput>({
      query: (body) => ({ url: "/auth/password", method: "POST", body }),
      transformResponse: (response: ApiSuccess<{ changed: true }>) => response.data,
      async onQueryStarted(_arg, { queryFulfilled }) {
        try {
          // The server may answer with this browser's fresh session; otherwise the
          // next request refreshes it with the rotated cookie.
          adoptToken((await queryFulfilled).data as { accessToken?: unknown });
        } catch {
          // Rejected: the dialog shows the error.
        }
      },
      invalidatesTags: ["Session"],
    }),
    /** The signed-in user's own display name. */
    updateProfile: build.mutation<{ displayName: string }, UpdateProfileInput>({
      query: (body) => ({ url: "/me", method: "PATCH", body }),
      transformResponse: (response: ApiSuccess<{ displayName: string }>) => response.data,
      invalidatesTags: ["Me"],
    }),
    /** Own profile picture (base64, already cropped and resized by the browser). */
    uploadAvatar: build.mutation<{ avatarUrl: string }, UploadAvatarInput>({
      query: (body) => ({ url: "/me/avatar", method: "PUT", body }),
      transformResponse: (response: ApiSuccess<{ avatarUrl: string }>) => response.data,
      invalidatesTags: ["Me"],
    }),
    removeAvatar: build.mutation<{ removed: boolean }, void>({
      query: () => ({ url: "/me/avatar", method: "DELETE" }),
      transformResponse: (response: ApiSuccess<{ removed: boolean }>) => response.data,
      invalidatesTags: ["Me"],
    }),
    completePasswordReset: build.mutation<{ reset: true }, CompletePasswordResetInput>({
      query: (body) => ({ url: "/auth/password/reset", method: "POST", body }),
      transformResponse: (response: ApiSuccess<{ reset: true }>) => response.data,
    }),
  }),
});

export const {
  useMeQuery,
  useSessionsQuery,
  useRevokeSessionMutation,
  useLoginMutation,
  useLogoutMutation,
  useChangePasswordMutation,
  useUpdateProfileMutation,
  useUploadAvatarMutation,
  useRemoveAvatarMutation,
  useCompletePasswordResetMutation,
} = sessionApi;

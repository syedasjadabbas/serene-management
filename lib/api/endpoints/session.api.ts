import type {
  ChangePasswordInput,
  CompletePasswordResetInput,
  LoginInput,
  UpdateProfileInput,
  UploadAvatarInput,
} from "@/modules/identity/identity.schema";
import type { LoginResult, SessionView } from "@/modules/identity/identity.types";
import type { MeView } from "@/modules/access/access.types";
import type { ApiSuccess } from "@/types/api";
import { baseApi } from "../baseApi";

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
    login: build.mutation<LoginResult, LoginInput>({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
      transformResponse: (response: ApiSuccess<LoginResult>) => response.data,
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

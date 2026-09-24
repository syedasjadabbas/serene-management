import type { LoginInput } from "@/modules/identity/identity.schema";
import type { LoginResult } from "@/modules/identity/identity.types";
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
  }),
});

export const { useMeQuery, useLoginMutation, useLogoutMutation } = sessionApi;

import { API } from "@/global/constants/api";
import type {
  AccountContactInput,
  AccountDetail,
  AccountListItem,
  ApiSuccess,
  CreateAccountInput,
  CursorPageMeta,
  UpdateAccountInput,
} from "../types";
import { baseApi } from "../baseApi";

/** Company / travel-agent profiles and their guest relationships (Phase 7). */
export const accountsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    accounts: build.query<
      { items: AccountListItem[]; meta: CursorPageMeta },
      { q?: string; type?: string; status?: string; cursor?: string; limit?: number }
    >({
      query: (params) => {
        const search = new URLSearchParams();
        for (const [k, v] of Object.entries(params))
          if (v !== undefined && v !== "") search.set(k, String(v));
        return `${API.accounts.accounts()}?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<AccountListItem[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: [{ type: "Account", id: "LIST" }],
    }),
    account: build.query<AccountDetail, string>({
      query: (accountId) => API.accounts.account(accountId),
      transformResponse: (response: ApiSuccess<AccountDetail>) => response.data,
      providesTags: (_r, _e, accountId) => [{ type: "Account", id: accountId }],
    }),
    createAccount: build.mutation<AccountDetail, Partial<CreateAccountInput>>({
      query: (body) => ({ url: API.accounts.accounts(), method: "POST", body }),
      transformResponse: (response: ApiSuccess<AccountDetail>) => response.data,
      invalidatesTags: [{ type: "Account", id: "LIST" }],
    }),
    updateAccount: build.mutation<
      AccountDetail,
      { accountId: string; body: Partial<UpdateAccountInput> }
    >({
      query: ({ accountId, body }) => ({
        url: API.accounts.account(accountId),
        method: "PATCH",
        body,
      }),
      transformResponse: (response: ApiSuccess<AccountDetail>) => response.data,
      invalidatesTags: (_r, _e, { accountId }) => [
        { type: "Account", id: accountId },
        { type: "Account", id: "LIST" },
      ],
    }),
    setAccountContact: build.mutation<
      AccountDetail,
      { accountId: string; guestId: string; body: Partial<AccountContactInput> }
    >({
      query: ({ accountId, guestId, body }) => ({
        url: API.accounts.accountContact(accountId, guestId),
        method: "PUT",
        body,
      }),
      transformResponse: (response: ApiSuccess<AccountDetail>) => response.data,
      invalidatesTags: (_r, _e, { accountId, guestId }) => [
        { type: "Account", id: accountId },
        { type: "Account", id: "LIST" },
        { type: "Guest", id: guestId },
      ],
    }),
    removeAccountContact: build.mutation<AccountDetail, { accountId: string; guestId: string }>({
      query: ({ accountId, guestId }) => ({
        url: API.accounts.accountContact(accountId, guestId),
        method: "DELETE",
      }),
      transformResponse: (response: ApiSuccess<AccountDetail>) => response.data,
      invalidatesTags: (_r, _e, { accountId, guestId }) => [
        { type: "Account", id: accountId },
        { type: "Account", id: "LIST" },
        { type: "Guest", id: guestId },
      ],
    }),
  }),
});

export const {
  useAccountsQuery,
  useAccountQuery,
  useCreateAccountMutation,
  useUpdateAccountMutation,
  useSetAccountContactMutation,
  useRemoveAccountContactMutation,
} = accountsApi;

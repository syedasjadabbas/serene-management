import { API } from "@/global/constants/api";
import type {
  AdjustInput,
  ApiSuccess,
  BillingOptions,
  ChargeInput,
  ChargePreview,
  CursorPageMeta,
  FolioAccountView,
  FolioListRow,
  LedgerPage,
  PaymentInput,
  PaymentResult,
  PostingResult,
  RefundInput,
  ReverseInput,
  RoomChargesInput,
  RoomChargesResult,
  VoidPaymentInput,
} from "../types";
import { baseApi } from "../baseApi";
import { optionsTag } from "./optionsTags";

/**
 * Folios, postings and payments (Phase 5). Financial commands carry an
 * `Idempotency-Key` chosen by the form when it opens: a retried or
 * double-submitted command replays the first result instead of posting twice.
 * Totals, taxes and balances always come from the server.
 */

export interface HistoryEntry {
  id: string;
  at: string;
  action: string;
  userDisplayName: string | null;
  risk: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

type Idempotent<T> = {
  propertyId: string;
  /** The folio account the command runs from: cache scope only, never sent (B11). */
  reservationRoomId: string;
  idempotencyKey: string;
  body: T;
};

const idempotent = (url: string, key: string, body: unknown) => ({
  url,
  method: "POST",
  body,
  headers: { "Idempotency-Key": key },
});

/**
 * What a financial command can change (B11): this reservation room's folio
 * account and history, the ledger of the window(s) it touched, the
 * property's folio and front-desk lists (balances), and the stay's folio
 * summary — nothing of other stays or other properties.
 */
export function afterFinancial(
  result: unknown,
  _error: unknown,
  arg: { propertyId: string; reservationRoomId: string; folioId?: string },
) {
  const touched =
    typeof result === "object" && result !== null && "folioId" in result
      ? String((result as { folioId: unknown }).folioId)
      : undefined;
  const folios = [...new Set([arg.folioId, touched].filter((id): id is string => !!id))];
  return [
    { type: "Folio" as const, id: arg.reservationRoomId },
    { type: "Folio" as const, id: `HISTORY-${arg.reservationRoomId}` },
    { type: "Folio" as const, id: `LIST-${arg.propertyId}` },
    ...folios.map((id) => ({ type: "Folio" as const, id: `LEDGER-${id}` })),
    { type: "Stay" as const, id: `RR-${arg.reservationRoomId}` },
    { type: "Stay" as const, id: `FD-${arg.propertyId}` },
  ];
}

export const billingApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    billingOptions: build.query<BillingOptions, string>({
      query: (propertyId) => API.billing.billingOptions(propertyId),
      transformResponse: (response: ApiSuccess<BillingOptions>) => response.data,
      providesTags: (_r, _e, propertyId) => [optionsTag(propertyId)],
      keepUnusedDataFor: 300,
    }),
    folios: build.query<
      { items: FolioListRow[]; meta: CursorPageMeta },
      { propertyId: string; view: string; q?: string; cursor?: string }
    >({
      query: ({ propertyId, ...params }) => {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
        return `${API.billing.folios(propertyId)}?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<FolioListRow[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: (_r, _e, { propertyId }) => [{ type: "Folio", id: `LIST-${propertyId}` }],
    }),
    folioAccount: build.query<FolioAccountView, { propertyId: string; reservationRoomId: string }>({
      query: ({ propertyId, reservationRoomId }) =>
        API.billing.reservationRoomFolio(propertyId, reservationRoomId),
      transformResponse: (response: ApiSuccess<FolioAccountView>) => response.data,
      providesTags: (_r, _e, { reservationRoomId }) => [{ type: "Folio", id: reservationRoomId }],
    }),
    folioLedger: build.query<
      LedgerPage,
      { propertyId: string; folioId: string; cursor?: string | null }
    >({
      query: ({ propertyId, folioId, cursor }) =>
        `${API.billing.folioItems(propertyId, folioId)}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      transformResponse: (response: ApiSuccess<LedgerPage>) => response.data,
      providesTags: (_r, _e, { folioId }) => [{ type: "Folio", id: `LEDGER-${folioId}` }],
    }),
    folioHistory: build.query<HistoryEntry[], { propertyId: string; reservationRoomId: string }>({
      query: ({ propertyId, reservationRoomId }) =>
        API.billing.reservationRoomFolioHistory(propertyId, reservationRoomId),
      transformResponse: (response: ApiSuccess<HistoryEntry[]>) => response.data,
      providesTags: (_r, _e, { reservationRoomId }) => [
        { type: "Folio", id: `HISTORY-${reservationRoomId}` },
      ],
    }),

    openWindow: build.mutation<FolioAccountView, { propertyId: string; reservationRoomId: string }>(
      {
        query: ({ propertyId, reservationRoomId }) => ({
          url: API.billing.reservationRoomFolio(propertyId, reservationRoomId),
          method: "POST",
          body: {},
        }),
        transformResponse: (response: ApiSuccess<FolioAccountView>) => response.data,
        invalidatesTags: afterFinancial,
      },
    ),
    previewCharge: build.mutation<
      ChargePreview,
      { propertyId: string; folioId: string; body: ChargeInput }
    >({
      query: ({ propertyId, folioId, body }) => ({
        url: API.billing.folioChargesPreview(propertyId, folioId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ChargePreview>) => response.data,
    }),
    postCharge: build.mutation<PostingResult, Idempotent<ChargeInput> & { folioId: string }>({
      query: ({ propertyId, folioId, idempotencyKey, body }) =>
        idempotent(API.billing.folioCharges(propertyId, folioId), idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PostingResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    postRoomCharges: build.mutation<
      RoomChargesResult,
      Idempotent<RoomChargesInput> & { reservationRoomId: string }
    >({
      query: ({ propertyId, reservationRoomId, idempotencyKey, body }) =>
        idempotent(
          API.billing.reservationRoomRoomCharges(propertyId, reservationRoomId),
          idempotencyKey,
          body,
        ),
      transformResponse: (response: ApiSuccess<RoomChargesResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    postPayment: build.mutation<PaymentResult, Idempotent<PaymentInput> & { folioId: string }>({
      query: ({ propertyId, folioId, idempotencyKey, body }) =>
        idempotent(API.billing.folioPayments(propertyId, folioId), idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PaymentResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    reverseItem: build.mutation<PostingResult, Idempotent<ReverseInput> & { itemId: string }>({
      query: ({ propertyId, itemId, idempotencyKey, body }) =>
        idempotent(API.billing.folioItemReverse(propertyId, itemId), idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PostingResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    adjustItem: build.mutation<PostingResult, Idempotent<AdjustInput> & { itemId: string }>({
      query: ({ propertyId, itemId, idempotencyKey, body }) =>
        idempotent(API.billing.folioItemAdjust(propertyId, itemId), idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PostingResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    voidPayment: build.mutation<
      PaymentResult,
      Idempotent<VoidPaymentInput> & { paymentId: string }
    >({
      query: ({ propertyId, paymentId, idempotencyKey, body }) =>
        idempotent(API.billing.paymentVoid(propertyId, paymentId), idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PaymentResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    refundPayment: build.mutation<PaymentResult, Idempotent<RefundInput> & { paymentId: string }>({
      query: ({ propertyId, paymentId, idempotencyKey, body }) =>
        idempotent(API.billing.paymentRefund(propertyId, paymentId), idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PaymentResult>) => response.data,
      invalidatesTags: afterFinancial,
    }),
    settleFolio: build.mutation<
      FolioAccountView,
      { propertyId: string; reservationRoomId: string; folioId: string; version: number }
    >({
      query: ({ propertyId, folioId, version }) => ({
        url: API.billing.folioSettle(propertyId, folioId),
        method: "POST",
        body: { version },
      }),
      transformResponse: (response: ApiSuccess<FolioAccountView>) => response.data,
      invalidatesTags: afterFinancial,
    }),
  }),
});

export const {
  useBillingOptionsQuery,
  useFoliosQuery,
  useFolioAccountQuery,
  useFolioLedgerQuery,
  useFolioHistoryQuery,
  useOpenWindowMutation,
  usePreviewChargeMutation,
  usePostChargeMutation,
  usePostRoomChargesMutation,
  usePostPaymentMutation,
  useReverseItemMutation,
  useAdjustItemMutation,
  useVoidPaymentMutation,
  useRefundPaymentMutation,
  useSettleFolioMutation,
} = billingApi;

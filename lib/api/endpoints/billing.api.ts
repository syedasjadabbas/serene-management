import type {
  AdjustInput,
  ChargeInput,
  PaymentInput,
  RefundInput,
  ReverseInput,
  RoomChargesInput,
  VoidPaymentInput,
} from "@/modules/billing/billing.schema";
import type {
  BillingOptions,
  ChargePreview,
  FolioAccountView,
  FolioListRow,
  LedgerPage,
  PaymentResult,
  PostingResult,
  RoomChargesResult,
} from "@/modules/billing/billing.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";

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

type Idempotent<T> = { propertyId: string; idempotencyKey: string; body: T };

const idempotent = (url: string, key: string, body: unknown) => ({
  url,
  method: "POST",
  body,
  headers: { "Idempotency-Key": key },
});

/** Any financial change can alter balances, ledgers, lists and the stay's folio summary. */
const FINANCIAL = ["Folio", "Payment", "Stay"] as const;

export const billingApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    billingOptions: build.query<BillingOptions, string>({
      query: (propertyId) => `/properties/${propertyId}/billing/options`,
      transformResponse: (response: ApiSuccess<BillingOptions>) => response.data,
      keepUnusedDataFor: 300,
    }),
    folios: build.query<
      { items: FolioListRow[]; meta: CursorPageMeta },
      { propertyId: string; view: string; q?: string; cursor?: string }
    >({
      query: ({ propertyId, ...params }) => {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
        return `/properties/${propertyId}/folios?${search.toString()}`;
      },
      transformResponse: (response: ApiSuccess<FolioListRow[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: (_r, _e, { propertyId }) => [{ type: "Folio", id: `LIST-${propertyId}` }],
    }),
    folioAccount: build.query<FolioAccountView, { propertyId: string; reservationRoomId: string }>({
      query: ({ propertyId, reservationRoomId }) =>
        `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/folio`,
      transformResponse: (response: ApiSuccess<FolioAccountView>) => response.data,
      providesTags: (_r, _e, { reservationRoomId }) => [{ type: "Folio", id: reservationRoomId }],
    }),
    folioLedger: build.query<
      LedgerPage,
      { propertyId: string; folioId: string; cursor?: string | null }
    >({
      query: ({ propertyId, folioId, cursor }) =>
        `/properties/${propertyId}/folios/${folioId}/items?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      transformResponse: (response: ApiSuccess<LedgerPage>) => response.data,
      providesTags: (_r, _e, { folioId }) => [{ type: "Folio", id: `LEDGER-${folioId}` }],
    }),
    folioHistory: build.query<HistoryEntry[], { propertyId: string; reservationRoomId: string }>({
      query: ({ propertyId, reservationRoomId }) =>
        `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/folio/history`,
      transformResponse: (response: ApiSuccess<HistoryEntry[]>) => response.data,
      providesTags: (_r, _e, { reservationRoomId }) => [
        { type: "Folio", id: `HISTORY-${reservationRoomId}` },
      ],
    }),

    openWindow: build.mutation<FolioAccountView, { propertyId: string; reservationRoomId: string }>(
      {
        query: ({ propertyId, reservationRoomId }) => ({
          url: `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/folio`,
          method: "POST",
          body: {},
        }),
        transformResponse: (response: ApiSuccess<FolioAccountView>) => response.data,
        invalidatesTags: [...FINANCIAL],
      },
    ),
    previewCharge: build.mutation<
      ChargePreview,
      { propertyId: string; folioId: string; body: ChargeInput }
    >({
      query: ({ propertyId, folioId, body }) => ({
        url: `/properties/${propertyId}/folios/${folioId}/charges/preview`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<ChargePreview>) => response.data,
    }),
    postCharge: build.mutation<PostingResult, Idempotent<ChargeInput> & { folioId: string }>({
      query: ({ propertyId, folioId, idempotencyKey, body }) =>
        idempotent(`/properties/${propertyId}/folios/${folioId}/charges`, idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PostingResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    postRoomCharges: build.mutation<
      RoomChargesResult,
      Idempotent<RoomChargesInput> & { reservationRoomId: string }
    >({
      query: ({ propertyId, reservationRoomId, idempotencyKey, body }) =>
        idempotent(
          `/properties/${propertyId}/reservation-rooms/${reservationRoomId}/room-charges`,
          idempotencyKey,
          body,
        ),
      transformResponse: (response: ApiSuccess<RoomChargesResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    postPayment: build.mutation<PaymentResult, Idempotent<PaymentInput> & { folioId: string }>({
      query: ({ propertyId, folioId, idempotencyKey, body }) =>
        idempotent(`/properties/${propertyId}/folios/${folioId}/payments`, idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PaymentResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    reverseItem: build.mutation<PostingResult, Idempotent<ReverseInput> & { itemId: string }>({
      query: ({ propertyId, itemId, idempotencyKey, body }) =>
        idempotent(`/properties/${propertyId}/folio-items/${itemId}/reverse`, idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PostingResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    adjustItem: build.mutation<PostingResult, Idempotent<AdjustInput> & { itemId: string }>({
      query: ({ propertyId, itemId, idempotencyKey, body }) =>
        idempotent(`/properties/${propertyId}/folio-items/${itemId}/adjust`, idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PostingResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    voidPayment: build.mutation<
      PaymentResult,
      Idempotent<VoidPaymentInput> & { paymentId: string }
    >({
      query: ({ propertyId, paymentId, idempotencyKey, body }) =>
        idempotent(`/properties/${propertyId}/payments/${paymentId}/void`, idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PaymentResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    refundPayment: build.mutation<PaymentResult, Idempotent<RefundInput> & { paymentId: string }>({
      query: ({ propertyId, paymentId, idempotencyKey, body }) =>
        idempotent(`/properties/${propertyId}/payments/${paymentId}/refund`, idempotencyKey, body),
      transformResponse: (response: ApiSuccess<PaymentResult>) => response.data,
      invalidatesTags: [...FINANCIAL],
    }),
    settleFolio: build.mutation<
      FolioAccountView,
      { propertyId: string; folioId: string; version: number }
    >({
      query: ({ propertyId, folioId, version }) => ({
        url: `/properties/${propertyId}/folios/${folioId}/settle`,
        method: "POST",
        body: { version },
      }),
      transformResponse: (response: ApiSuccess<FolioAccountView>) => response.data,
      invalidatesTags: [...FINANCIAL],
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

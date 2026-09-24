import type {
  AssignRequestInput,
  BlockRequestRoomInput,
  CancelRequestInput,
  CreateRequestInput,
  NoteInput,
  RequestCommandInput,
  ResolveRequestInput,
} from "@/modules/maintenance/maintenance.schema";
import type {
  MaintenanceDetail,
  MaintenanceListItem,
  MaintenanceOptions,
} from "@/modules/maintenance/maintenance.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";
import { operationsTags } from "./operations-tags";

/** Maintenance requests (Phase 4). */

type Command<T> = { propertyId: string; requestId: string; body: T };

const toQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

const listTag = (propertyId: string) => ({
  type: "MaintenanceRequest" as const,
  id: `LIST-${propertyId}`,
});

function afterCommand(
  result: MaintenanceDetail | undefined,
  _e: unknown,
  arg: { propertyId: string },
) {
  return [
    ...operationsTags(arg.propertyId),
    ...(result ? [{ type: "MaintenanceRequest" as const, id: result.id }] : []),
  ];
}

type MaintenanceSummary = {
  open: number;
  unassigned: number;
  inProgress: number;
  resolved: number;
  mine: number;
  blockingRooms: number;
};

export const maintenanceApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    maintenanceSummary: build.query<MaintenanceSummary, string>({
      query: (propertyId) => `/properties/${propertyId}/maintenance/summary`,
      transformResponse: (response: ApiSuccess<MaintenanceSummary>) => response.data,
      providesTags: (_r, _e, propertyId) => [listTag(propertyId)],
    }),
    maintenanceOptions: build.query<MaintenanceOptions, string>({
      query: (propertyId) => `/properties/${propertyId}/maintenance/options`,
      transformResponse: (response: ApiSuccess<MaintenanceOptions>) => response.data,
      keepUnusedDataFor: 300,
    }),
    maintenanceRequests: build.query<
      { items: MaintenanceListItem[]; meta: CursorPageMeta },
      { propertyId: string } & Record<string, string | undefined>
    >({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/maintenance?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<MaintenanceListItem[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
    }),
    maintenanceRequest: build.query<MaintenanceDetail, { propertyId: string; requestId: string }>({
      query: ({ propertyId, requestId }) => `/properties/${propertyId}/maintenance/${requestId}`,
      transformResponse: (response: ApiSuccess<MaintenanceDetail>) => response.data,
      providesTags: (_r, _e, { requestId }) => [{ type: "MaintenanceRequest", id: requestId }],
    }),
    createMaintenanceRequest: build.mutation<
      MaintenanceDetail,
      { propertyId: string; body: Partial<CreateRequestInput> }
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/maintenance`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<MaintenanceDetail>) => response.data,
      invalidatesTags: afterCommand,
    }),
    maintenanceCommand: build.mutation<
      MaintenanceDetail,
      Command<
        | AssignRequestInput
        | RequestCommandInput
        | ResolveRequestInput
        | CancelRequestInput
        | BlockRequestRoomInput
        | NoteInput
      > & {
        action:
          | "assign"
          | "start"
          | "hold"
          | "resume"
          | "resolve"
          | "close"
          | "reopen"
          | "cancel"
          | "block-room"
          | "notes";
      }
    >({
      query: ({ propertyId, requestId, action, body }) => ({
        url: `/properties/${propertyId}/maintenance/${requestId}/${action}`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<MaintenanceDetail>) => response.data,
      invalidatesTags: afterCommand,
    }),
  }),
});

export const {
  useMaintenanceSummaryQuery,
  useMaintenanceOptionsQuery,
  useMaintenanceRequestsQuery,
  useMaintenanceRequestQuery,
  useCreateMaintenanceRequestMutation,
  useMaintenanceCommandMutation,
} = maintenanceApi;

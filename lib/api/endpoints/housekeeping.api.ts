import type {
  AssignTaskInput,
  CloseTaskInput,
  CreateTaskInput,
  TaskCommandInput,
} from "@/modules/housekeeping/housekeeping.schema";
import type {
  AssigneeView,
  HousekeepingSummary,
  TaskTypeView,
  TaskView,
} from "@/modules/housekeeping/housekeeping.types";
import type { ApiSuccess, CursorPageMeta } from "@/types/api";
import { baseApi } from "../baseApi";
import { operationsTags } from "./operations-tags";

/** Housekeeping tasks (Phase 4). Shared by the housekeeping workspace and room dialogs. */

type TaskCommand<T> = { propertyId: string; taskId: string; body: T };

const toQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

const listTag = (propertyId: string) => ({
  type: "HousekeepingTask" as const,
  id: `LIST-${propertyId}`,
});

function afterTaskCommand(_r: unknown, _e: unknown, arg: { propertyId: string }) {
  return operationsTags(arg.propertyId);
}

export const housekeepingApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    housekeepingSummary: build.query<HousekeepingSummary, string>({
      query: (propertyId) => `/properties/${propertyId}/housekeeping/summary`,
      transformResponse: (response: ApiSuccess<HousekeepingSummary>) => response.data,
      providesTags: (_r, _e, propertyId) => [listTag(propertyId)],
    }),
    housekeepingOptions: build.query<
      { taskTypes: TaskTypeView[]; assignees: AssigneeView[] },
      string
    >({
      query: (propertyId) => `/properties/${propertyId}/housekeeping/options`,
      transformResponse: (
        response: ApiSuccess<{ taskTypes: TaskTypeView[]; assignees: AssigneeView[] }>,
      ) => response.data,
      keepUnusedDataFor: 300,
    }),
    housekeepingTasks: build.query<
      { items: TaskView[]; meta: CursorPageMeta },
      { propertyId: string } & Record<string, string | undefined>
    >({
      query: ({ propertyId, ...params }) =>
        `/properties/${propertyId}/housekeeping/tasks?${toQuery(params)}`,
      transformResponse: (response: ApiSuccess<TaskView[], CursorPageMeta>) => ({
        items: response.data,
        meta: response.meta ?? { nextCursor: null, limit: 0 },
      }),
      providesTags: (_r, _e, { propertyId }) => [listTag(propertyId)],
    }),
    createHousekeepingTask: build.mutation<
      TaskView,
      { propertyId: string; body: Partial<CreateTaskInput> }
    >({
      query: ({ propertyId, body }) => ({
        url: `/properties/${propertyId}/housekeeping/tasks`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<TaskView>) => response.data,
      invalidatesTags: afterTaskCommand,
    }),
    assignHousekeepingTask: build.mutation<TaskView, TaskCommand<AssignTaskInput>>({
      query: ({ propertyId, taskId, body }) => ({
        url: `/properties/${propertyId}/housekeeping/tasks/${taskId}/assign`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<TaskView>) => response.data,
      invalidatesTags: afterTaskCommand,
    }),
    workHousekeepingTask: build.mutation<
      TaskView,
      TaskCommand<TaskCommandInput> & { action: "start" | "pause" | "complete" }
    >({
      query: ({ propertyId, taskId, action, body }) => ({
        url: `/properties/${propertyId}/housekeeping/tasks/${taskId}/${action}`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<TaskView>) => response.data,
      invalidatesTags: afterTaskCommand,
    }),
    closeHousekeepingTask: build.mutation<
      TaskView,
      TaskCommand<CloseTaskInput> & { action: "skip" | "cancel" }
    >({
      query: ({ propertyId, taskId, action, body }) => ({
        url: `/properties/${propertyId}/housekeeping/tasks/${taskId}/${action}`,
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<TaskView>) => response.data,
      invalidatesTags: afterTaskCommand,
    }),
  }),
});

export const {
  useHousekeepingSummaryQuery,
  useHousekeepingOptionsQuery,
  useHousekeepingTasksQuery,
  useCreateHousekeepingTaskMutation,
  useAssignHousekeepingTaskMutation,
  useWorkHousekeepingTaskMutation,
  useCloseHousekeepingTaskMutation,
} = housekeepingApi;

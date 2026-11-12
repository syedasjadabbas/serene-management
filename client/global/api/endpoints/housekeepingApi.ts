import { API } from "@/global/constants/api";
import type {
  ApiSuccess,
  AssignTaskInput,
  AssigneeView,
  CloseTaskInput,
  CreateTaskInput,
  CursorPageMeta,
  HousekeepingSummary,
  TaskCommandInput,
  TaskTypeView,
  TaskView,
} from "../types";
import { baseApi } from "../baseApi";
import { operationsTags } from "./operationsTags";
import { assigneeOptionsTag, optionsTag } from "./optionsTags";

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
  return operationsTags(arg.propertyId, { availability: false });
}

export const housekeepingApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    housekeepingSummary: build.query<HousekeepingSummary, string>({
      query: (propertyId) => API.housekeeping.housekeepingSummary(propertyId),
      transformResponse: (response: ApiSuccess<HousekeepingSummary>) => response.data,
      providesTags: (_r, _e, propertyId) => [listTag(propertyId)],
    }),
    housekeepingOptions: build.query<
      { taskTypes: TaskTypeView[]; assignees: AssigneeView[] },
      string
    >({
      query: (propertyId) => API.housekeeping.housekeepingOptions(propertyId),
      transformResponse: (
        response: ApiSuccess<{ taskTypes: TaskTypeView[]; assignees: AssigneeView[] }>,
      ) => response.data,
      providesTags: (_r, _e, propertyId) => [optionsTag(propertyId), assigneeOptionsTag()],
      keepUnusedDataFor: 300,
    }),
    housekeepingTasks: build.query<
      { items: TaskView[]; meta: CursorPageMeta },
      { propertyId: string } & Record<string, string | undefined>
    >({
      query: ({ propertyId, ...params }) =>
        `${API.housekeeping.housekeepingTasks(propertyId)}?${toQuery(params)}`,
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
        url: API.housekeeping.housekeepingTasks(propertyId),
        method: "POST",
        body,
      }),
      transformResponse: (response: ApiSuccess<TaskView>) => response.data,
      invalidatesTags: afterTaskCommand,
    }),
    assignHousekeepingTask: build.mutation<TaskView, TaskCommand<AssignTaskInput>>({
      query: ({ propertyId, taskId, body }) => ({
        url: API.housekeeping.housekeepingTaskAssign(propertyId, taskId),
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
        url: API.housekeeping.housekeepingTaskAction(propertyId, taskId, action),
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
        url: API.housekeeping.housekeepingTaskAction(propertyId, taskId, action),
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

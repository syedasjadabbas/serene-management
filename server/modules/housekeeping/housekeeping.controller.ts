import { handleProperty, withMeta } from "@/lib/controller";
import {
  assignTask,
  closeTask,
  createTask,
  getHousekeepingSummary,
  getTask,
  listAssignees,
  listTaskTypes,
  listTasks,
  workTask,
} from "./housekeeping.service";

/** Task types and the users who can be given housekeeping work. */
export const options = handleProperty(async (req) => ({
  taskTypes: await listTaskTypes(req.ctx),
  assignees: await listAssignees(req.ctx),
}));

export const summary = handleProperty((req) => getHousekeepingSummary(req.ctx));

export const listTasksHandler = handleProperty(async (req, res) => {
  const { items, meta } = await listTasks(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

export const createTaskHandler = handleProperty((req) => createTask(req.ctx, req.body), {
  status: 201,
});

export const getTaskHandler = handleProperty((req) => getTask(req.ctx, req.params.taskId));
export const assign = handleProperty((req) => assignTask(req.ctx, req.params.taskId, req.body));
export const cancel = handleProperty((req) =>
  closeTask(req.ctx, req.params.taskId, "cancel", req.body),
);
export const skip = handleProperty((req) =>
  closeTask(req.ctx, req.params.taskId, "skip", req.body),
);
export const start = handleProperty((req) =>
  workTask(req.ctx, req.params.taskId, "start", req.body),
);
export const pause = handleProperty((req) =>
  workTask(req.ctx, req.params.taskId, "pause", req.body),
);
export const complete = handleProperty((req) =>
  workTask(req.ctx, req.params.taskId, "complete", req.body),
);

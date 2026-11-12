import { handleProperty } from "@/lib/controller";
import { sendWebResponse } from "@/lib/web-response";
import { exportReport, getDashboard, listReports, runReport } from "./reports.service";

export const dashboard = handleProperty((req) => getDashboard(req.ctx));
export const list = handleProperty((req) => listReports(req.ctx));
export const run = handleProperty((req, res) =>
  runReport(req.ctx, req.params.reportKey, res.locals.query),
);

/** CSV download: the service's Response is written to `res` as is. */
export const exportCsv = handleProperty(async (req, res) => {
  await sendWebResponse(res, await exportReport(req.ctx, req.params.reportKey, res.locals.query));
});

// ============================================================
// PeoplePulse — Root tRPC Router
// Combines all module routers
// ============================================================

import { router } from "./trpc";
import { employeeRouter } from "./routers/employee";
import { payrollRouter } from "./routers/payroll";
import { leaveRouter } from "./routers/leave";
import { complianceRouter } from "./routers/compliance";
import { disciplinaryRouter } from "./routers/disciplinary";
import { superAdminRouter } from "./routers/superAdmin";

export const appRouter = router({
  employee: employeeRouter,
  payroll: payrollRouter,
  leave: leaveRouter,
  compliance: complianceRouter,
  disciplinary: disciplinaryRouter,
  superAdmin: superAdminRouter,
});

export type AppRouter = typeof appRouter;

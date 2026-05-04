// ============================================================
// PeoplePulse — Root tRPC Router
// Combines all module routers
// ============================================================

import { router } from "../trpc";
import { payrollRouter } from "./payroll";
import { employeeRouter } from "./employee";
import { leaveRouter } from "./leave";
import { complianceRouter } from "./compliance";
import { disciplinaryRouter } from "./disciplinary";
import { superAdminRouter } from "./superAdmin";

export const appRouter = router({
  payroll: payrollRouter,
  employee: employeeRouter,
  leave: leaveRouter,
  compliance: complianceRouter,
  disciplinary: disciplinaryRouter,
  superAdmin: superAdminRouter,
});

export type AppRouter = typeof appRouter;
// Type exports — use these in frontend for tRPC client
// e.g. const trpc = useTRPCClient<AppRouter>();
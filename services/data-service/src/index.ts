import express from "express";
import cors from "cors";
import { transactionRouter } from "./modules/transactions/transactions.controller";
import { analyticsRouter } from "./modules/analytics/analytics.controller";
import { tripsRouter } from "./modules/trips/trips.controller";
import { apiAuthRouter } from "./modules/auth/auth.controller";
import { hermesWorkflowRouter } from "./modules/imports/hermes-workflow.controller";
import { hermesContextRouter } from "./modules/imports/hermes-context.controller";
import { parserFactoryRouter } from "./modules/imports/parser-factory.controller";
import { parserRuntimeRouter } from "./modules/imports/parser-runtime.controller";
import { HermesWorkflowService } from "./modules/imports/hermes-workflow.service";
import { accountsRouter } from "./modules/accounts/accounts.controller";

const app = express();
const PORT = process.env.PORT || 4001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "data-service" });
});

// Routes
app.use("/api/transactions", transactionRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/auth", apiAuthRouter);
app.use("/api/agent", hermesWorkflowRouter);
app.use("/api/agent/context", hermesContextRouter);
app.use("/api/agent/parser-factory", parserFactoryRouter);
app.use("/api/parser-runtime", parserRuntimeRouter);
app.use("/api/agent/accounts", accountsRouter);

// Error handling
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error("Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  },
);

app.listen(PORT, () => {
  console.log(`Data service listening on port ${PORT}`);
});

const cleanupTimer = setInterval(() => {
  void HermesWorkflowService.cleanupExpiredData().catch((error) =>
    console.error("Failed to clean expired Hermes workflow data:", error),
  );
}, 60 * 60 * 1000);
cleanupTimer.unref();
void HermesWorkflowService.cleanupExpiredData().catch((error) =>
  console.error("Failed initial Hermes workflow cleanup:", error),
);

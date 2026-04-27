import { Router, Request, Response } from "express";
import { TransactionService } from "./transactions.service";
import { z } from "zod";

export const transactionRouter = Router();

// Validation schemas
const TransactionLinkageSchema = z.object({
  type: z.enum(["internal", "reimbursement", "reimbursed"]),
  reimbursesAllocations: z
    .array(
      z.object({
        transactionId: z.string().optional(),
        pendingBatchIndex: z.number().optional(),
        amount: z.number(),
      }),
    )
    .optional(),
  reimbursedByAllocations: z
    .array(
      z.object({
        transactionId: z.string(),
        amount: z.number(),
      }),
    )
    .optional(),
  leftoverAmount: z.number().optional(),
  leftoverCategoryId: z.string().nullable().optional(),
  autoDetected: z.boolean().optional(),
  detectionReason: z.string().optional(),
}).nullish();

const ImportTransactionSchema = z.object({
  date: z.string().transform((str: string) => new Date(str)),
  description: z.string(),
  label: z.string().optional(),
  categoryId: z.string().nullish(),
  amountIn: z.number().nullish(),
  amountOut: z.number().nullish(),
  balance: z.number().nullish(),
  currency: z.string().nullish(),
  accountIdentifier: z.string().nullish(),
  source: z.string().nullish(),
  metadata: z.any().optional(),
  linkage: TransactionLinkageSchema,
});

const ImportRuleSchema = z.object({
  name: z.string().min(1),
  parserId: z.string().nullable().optional(),
  matchType: z.enum(["always", "description_contains"]).optional(),
  matchValue: z.string().nullable().optional(),
  caseSensitive: z.boolean().optional(),
  enabled: z.boolean().optional(),
  setLabel: z.string().nullable().optional(),
  setCategoryName: z.string().nullable().optional(),
  markInternal: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const ClassificationPatternUpdateSchema = z.object({
  status: z.enum(["auto_apply", "suggest", "disabled", "unresolved"]).optional(),
  label: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  markInternal: z.boolean().optional(),
});

const CheckImportSchema = z.object({
  userId: z.string(),
  transactions: z.array(ImportTransactionSchema),
});

const CommitImportSchema = z.object({
  userId: z.string(),
  transactions: z.array(ImportTransactionSchema),
  selectedIndices: z.array(z.number()),
  batchInfo: z
    .object({
      filename: z.string(),
      fileType: z.string(),
      parserId: z.string(),
    })
    .optional(),
});

const GetTransactionsSchema = z.object({
  userId: z.string(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  categoryIds: z.string().optional(),
  search: z.string().optional(),
  accountIdentifier: z.string().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});

const parseFilters = (input: any) => {
  if (!input) return {};

  const rawCategoryIds = input.categoryIds;
  const categoryIds = Array.isArray(rawCategoryIds)
    ? rawCategoryIds
    : typeof rawCategoryIds === "string"
      ? rawCategoryIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : undefined;

  return {
    dateFrom: input.dateFrom ? new Date(input.dateFrom) : undefined,
    dateTo: input.dateTo ? new Date(input.dateTo) : undefined,
    categoryIds: categoryIds && categoryIds.length > 0 ? categoryIds : undefined,
    search: input.search ? String(input.search) : undefined,
    transactionType: input.transactionType as
      | "income"
      | "expense"
      | undefined,
    accountIdentifier: input.accountIdentifier
      ? String(input.accountIdentifier).trim()
      : input.accountNumber
        ? String(input.accountNumber).trim()
        : undefined,
    minAmount:
      input.minAmount !== undefined && input.minAmount !== ""
        ? Number(input.minAmount)
        : undefined,
    maxAmount:
      input.maxAmount !== undefined && input.maxAmount !== ""
        ? Number(input.maxAmount)
        : undefined,
    dateOrder: input.dateOrder as "asc" | "desc" | undefined,
  };
};

const parseUpdates = (updates: any) => {
  if (!updates || typeof updates !== "object") return {};
  const next: Record<string, any> = { ...updates };
  if (next.date && String(next.date).length > 0) {
    next.date = new Date(next.date);
  } else {
    delete next.date;
  }
  if (typeof next.currency === "string") {
    next.currency = next.currency.trim().toUpperCase();
    if (!next.currency) {
      delete next.currency;
    }
  } else if (next.currency === null) {
    delete next.currency;
  }
  return next;
};

const escapeCsv = (value: string) => {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const toCsv = (rows: Array<Record<string, string>>) => {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map((row) =>
    headers.map((key) => escapeCsv(row[key] ?? "")).join(","),
  );
  return [headerLine, ...dataLines].join("\n");
};

const formatCsvDate = (value: Date) => {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const year = value.getFullYear();
  return `${month}/${day}/${year}`;
};

/**
 * POST /api/transactions/check-import
 * Check for duplicates without committing
 */
transactionRouter.post("/check-import", async (req: Request, res: Response) => {
  try {
    const { userId, transactions } = CheckImportSchema.parse(req.body);

    const result = await TransactionService.checkImport(userId, transactions);

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/transactions/commit-import
 * Commit selected transactions to database
 */
transactionRouter.post(
  "/commit-import",
  async (req: Request, res: Response) => {
    try {
      const { userId, transactions, selectedIndices, batchInfo } =
        CommitImportSchema.parse(req.body);

      const result = await TransactionService.commitImport(
        userId,
        transactions,
        selectedIndices,
        batchInfo,
      );

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions/classification-patterns
 * Get learned classification patterns for dashboard and import matching
 */
transactionRouter.get(
  "/classification-patterns",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const patterns = await TransactionService.getClassificationPatterns(userId, {
        status: req.query.status as any,
        patternType: req.query.patternType as any,
      });
      res.json({ patterns });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * POST /api/transactions/classification-patterns/rebuild
 * Rebuild learned classification patterns from committed transactions
 */
transactionRouter.post(
  "/classification-patterns/rebuild",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.body?.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const result = await TransactionService.rebuildClassificationPatterns(userId);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions/classification-patterns/applied-summary
 * Get aggregate history of fixed and learned rule applications
 */
transactionRouter.get(
  "/classification-patterns/applied-summary",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const summary = await TransactionService.getAppliedClassificationSummary(userId);
      res.json({ summary });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * PATCH /api/transactions/classification-patterns/:id
 * Update learned classification pattern dashboard controls
 */
transactionRouter.patch(
  "/classification-patterns/:id",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.body?.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const payload = ClassificationPatternUpdateSchema.parse(req.body?.pattern || req.body);
      const pattern = await TransactionService.updateClassificationPattern(
        userId,
        req.params.id,
        payload,
      );
      res.json({ pattern });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * DELETE /api/transactions/classification-patterns/:id
 * Delete a learned classification pattern
 */
transactionRouter.delete(
  "/classification-patterns/:id",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const result = await TransactionService.deleteClassificationPattern(
        userId,
        req.params.id,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * POST /api/transactions/import-rules/bootstrap
 * Seed default import rules for a user (idempotent)
 */
transactionRouter.post(
  "/import-rules/bootstrap",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.body?.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      await TransactionService.bootstrapDefaultImportRules(userId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions/import-rules/paylah-internal-preference
 * Get PayLah internal auto-marking preference and prompt state
 */
transactionRouter.get(
  "/import-rules/paylah-internal-preference",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      const state = await TransactionService.getPaylahInternalPreferenceState(
        userId,
      );
      res.json(state);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * POST /api/transactions/import-rules/paylah-internal-preference
 * Save PayLah internal auto-marking preference
 */
transactionRouter.post(
  "/import-rules/paylah-internal-preference",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.body?.userId || "");
      const enabled = Boolean(req.body?.enabled);
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      const result = await TransactionService.setPaylahInternalPreference(
        userId,
        enabled,
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions/import-rules
 * Get import rules
 */
transactionRouter.get("/import-rules", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "");
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const rules = await TransactionService.getImportRules(userId);
    res.json({ rules });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/transactions/import-rules
 * Create import rule
 */
transactionRouter.post("/import-rules", async (req: Request, res: Response) => {
  try {
    const userId = String(req.body?.userId || "");
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    const payload = ImportRuleSchema.parse(req.body?.rule || req.body);
    const rule = await TransactionService.createImportRule(userId, payload);
    res.json({ rule });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PATCH /api/transactions/import-rules/:id
 * Update import rule
 */
transactionRouter.patch(
  "/import-rules/:id",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.body?.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      const payload = ImportRuleSchema.partial().parse(req.body?.rule || req.body);
      const rule = await TransactionService.updateImportRule(
        userId,
        req.params.id,
        payload,
      );
      res.json({ rule });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * DELETE /api/transactions/import-rules/:id
 * Delete import rule
 */
transactionRouter.delete(
  "/import-rules/:id",
  async (req: Request, res: Response) => {
    try {
      const userId = String(req.query.userId || "");
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      await TransactionService.deleteImportRule(userId, req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions
 * Get transactions with filters
 */
transactionRouter.get("/", async (req: Request, res: Response) => {
  try {
    const filters = {
      userId: req.query.userId as string,
      dateFrom: req.query.dateFrom
        ? new Date(req.query.dateFrom as string)
        : undefined,
      dateTo: req.query.dateTo
        ? new Date(req.query.dateTo as string)
        : undefined,
      categoryIds: req.query.categoryIds
        ? String(req.query.categoryIds)
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined,
      accountIdentifier: req.query.accountIdentifier
        ? String(req.query.accountIdentifier).trim()
        : req.query.accountNumber
          ? String(req.query.accountNumber).trim()
          : undefined,
      search: req.query.search as string | undefined,
      transactionType: req.query.transactionType as
        | "income"
        | "expense"
        | undefined,
      dateOrder: req.query.dateOrder as "asc" | "desc" | undefined,
      minAmount: req.query.minAmount
        ? parseFloat(req.query.minAmount as string)
        : undefined,
      maxAmount: req.query.maxAmount
        ? parseFloat(req.query.maxAmount as string)
        : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset
        ? parseInt(req.query.offset as string)
        : undefined,
    };

    const result = await TransactionService.getTransactions(
      filters.userId,
      filters,
    );

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/transactions/years
 * Get distinct transaction years for a user
 */
transactionRouter.get("/years", async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const years = await TransactionService.getTransactionYears(userId);
    res.json({ years });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/transactions/bulk-delete
 * Delete multiple transactions
 */
transactionRouter.post("/bulk-delete", async (req: Request, res: Response) => {
  try {
    const { userId, ids } = req.body;

    if (!userId || !ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ error: "userId and ids array are required" });
    }

    await TransactionService.deleteTransactions(ids, userId);

    res.json({ success: true, deletedCount: ids.length });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PATCH /api/transactions/bulk
 * Update multiple transactions by IDs
 */
transactionRouter.patch("/bulk", async (req: Request, res: Response) => {
  try {
    const { userId, ids, updates } = req.body;

    if (!userId || !ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ error: "userId and ids array are required" });
    }

    const result = await TransactionService.bulkUpdateByIds(
      userId,
      ids,
      parseUpdates(updates),
    );

    res.json({ success: true, updatedCount: result.count });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PATCH /api/transactions/bulk-by-filter
 * Update multiple transactions by filters
 */
transactionRouter.patch(
  "/bulk-by-filter",
  async (req: Request, res: Response) => {
    try {
      const { userId, filters, excludeIds, updates } = req.body;

      if (!userId || !filters) {
        return res.status(400).json({ error: "userId and filters required" });
      }

      const parsedFilters = parseFilters(filters);
      const result = await TransactionService.bulkUpdateByFilter(
        userId,
        parsedFilters,
        excludeIds,
        parseUpdates(updates),
      );

      res.json({ success: true, updatedCount: result.count });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * DELETE /api/transactions/bulk
 * Delete multiple transactions by IDs
 */
transactionRouter.delete("/bulk", async (req: Request, res: Response) => {
  try {
    const { userId, ids } = req.body;

    if (!userId || !ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ error: "userId and ids array are required" });
    }

    const result = await TransactionService.deleteTransactions(ids, userId);

    res.json({ success: true, deletedCount: result.count });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/transactions/bulk-by-filter
 * Delete multiple transactions by filters
 */
transactionRouter.delete(
  "/bulk-by-filter",
  async (req: Request, res: Response) => {
    try {
      const { userId, filters, excludeIds } = req.body;

      if (!userId || !filters) {
        return res.status(400).json({ error: "userId and filters required" });
      }

      const parsedFilters = parseFilters(filters);
      const result = await TransactionService.bulkDeleteByFilter(
        userId,
        parsedFilters,
        excludeIds,
      );

      res.json({ success: true, deletedCount: result.count });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * POST /api/transactions/export
 * Export transactions as CSV
 */
transactionRouter.post("/export", async (req: Request, res: Response) => {
  try {
    const { userId, ids, filters, excludeIds } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const transactions =
      ids && Array.isArray(ids) && ids.length > 0
        ? await TransactionService.exportByIds(userId, ids)
        : await TransactionService.exportByFilter(
            userId,
            parseFilters(filters),
            excludeIds,
          );

    const rows = transactions.map((transaction: any) => ({
      Date: formatCsvDate(transaction.date),
      Description: transaction.description ?? "",
      Label: transaction.label ?? "",
      Category: transaction.category?.name ?? "",
      Credit: transaction.amountIn !== null ? String(transaction.amountIn) : "",
      Debit: transaction.amountOut !== null ? String(transaction.amountOut) : "",
      Balance: transaction.balance !== null ? String(transaction.balance) : "",
      Currency: transaction.currency ?? "",
      "Account Identifier": transaction.accountIdentifier ?? "",
      Source: transaction.source ?? "",
    }));

    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=transactions.csv",
    );
    res.send(csv);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/transactions/search-reimbursement
 * Search transactions for reimbursement linking
 * NOTE: This must be before /:id routes to avoid route conflicts
 */
transactionRouter.get(
  "/search-reimbursement",
  async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string;
      const query = req.query.query ? String(req.query.query) : undefined;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string)
        : 20;
      const offset = req.query.offset
        ? parseInt(req.query.offset as string)
        : 0;
      const transactionType = req.query.transactionType
        ? String(req.query.transactionType)
        : undefined;
      const categoryId = req.query.categoryId
        ? String(req.query.categoryId)
        : undefined;
      const dateFrom = req.query.dateFrom
        ? new Date(String(req.query.dateFrom))
        : undefined;
      const dateTo = req.query.dateTo
        ? new Date(String(req.query.dateTo))
        : undefined;
      const amountEquals = req.query.amountEquals
        ? Number(req.query.amountEquals)
        : undefined;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const results = await TransactionService.searchForReimbursement(
        userId,
        query,
        limit,
        offset,
        {
          transactionType:
            transactionType === "in" || transactionType === "out"
              ? transactionType
              : undefined,
          categoryId,
          dateFrom:
            dateFrom && !Number.isNaN(dateFrom.getTime()) ? dateFrom : undefined,
          dateTo: dateTo && !Number.isNaN(dateTo.getTime()) ? dateTo : undefined,
          amountEquals:
            typeof amountEquals === "number" && Number.isFinite(amountEquals)
              ? amountEquals
              : undefined,
        },
      );

      res.json(results);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions/:id
 * Get single transaction
 */
transactionRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const transaction = await TransactionService.getTransaction(id, userId);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    res.json(transaction);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/transactions/:id
 * Update transaction
 */
transactionRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.body.userId as string;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const transaction = await TransactionService.updateTransaction(
      id,
      userId,
      req.body,
    );

    res.json(transaction);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/transactions/:id
 * Delete single transaction
 */
transactionRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    await TransactionService.deleteTransaction(id, userId);

    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/transactions/:id/mark-internal
 * Mark transaction as internal
 */
transactionRouter.post(
  "/:id/mark-internal",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, autoDetected, detectionReason } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const result = await TransactionService.markAsInternal(
        id,
        userId,
        autoDetected || false,
        detectionReason,
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * POST /api/transactions/:id/link-reimbursement
 * Create reimbursement link
 */
transactionRouter.post(
  "/:id/link-reimbursement",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { userId, reimbursedAllocations, leftoverCategoryId } = req.body;

      if (
        !userId ||
        !Array.isArray(reimbursedAllocations)
      ) {
        return res
          .status(400)
          .json({
            error: "userId and reimbursedAllocations are required",
          });
      }

      const normalizedAllocations = reimbursedAllocations
        .map((item: any) => ({
          transactionId: String(item.transactionId || ""),
          amount: Number(item.amount || 0),
        }))
        .filter((item: any) => item.transactionId && item.amount > 0);

      const result = await TransactionService.createReimbursementLink(
        id,
        normalizedAllocations,
        userId,
        leftoverCategoryId ?? null,
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * DELETE /api/transactions/:id/linkage
 * Clear linkage from transaction
 */
transactionRouter.delete(
  "/:id/linkage",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.query.userId as string;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const result = await TransactionService.clearLinkage(id, userId);

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * POST /api/transactions/repair-linkages
 * Repair invalid linkage states (e.g. self-reimbursed transactions)
 */
transactionRouter.post(
  "/repair-linkages",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const result = await TransactionService.repairInvalidLinkages(userId);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },
);

/**
 * GET /api/transactions/:id/linked
 * Get linked transactions for display
 */
transactionRouter.get("/:id/linked", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const linked = await TransactionService.getLinkedTransactions(id, userId);

    res.json(linked);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "../chat/test-harness";
import { withDatabase } from "../../lib/database-context";
import { TransactionService } from "./transactions.service";

const CARD = "4265-****-****-4591";

test("re-applying import rules to a draft is stable and keeps user edits", () =>
  withChatDb(async (db) => {
    const user = await db.user.create({ data: { username: "rule-reapply" } });
    await db.accountIdentifier.create({
      data: { userId: user.id, accountIdentifier: CARD, color: "#111111" },
    });
    const [transport, internal, dining] = await Promise.all(
      ["Transportation", "Internal", "Dining"].map((name) =>
        db.category.create({ data: { userId: user.id, name } }),
      ),
    );
    await withDatabase(db, async () => {
      await TransactionService.createImportRule(user.id, {
        name: "BUS/MRT transactions are Transportation",
        matchType: "description_contains",
        matchValue: "BUS/MRT",
        setCategoryName: "Transportation",
        sortOrder: 50,
      });
      const apply = (rows: any[]) =>
        TransactionService.applyImportRules(user.id, undefined, rows) as Promise<any[]>;
      const learnedNote = {
        classificationPatternId: "pattern-1",
        suggestionReason: "Learned description exact",
      };

      // Parse order: rule set the category, the learned pattern only left a note.
      const [ruled] = await apply([
        {
          date: "2026-09-08",
          description: "BUS/MRT 1",
          amountOut: 2,
          accountIdentifier: CARD,
          suggestedCategoryId: internal.id,
          suggestionApplied: false,
          metadata: learnedNote,
        },
      ]);
      assert.equal(ruled.categoryId, transport.id);
      assert.deepEqual(await apply([ruled]), [ruled]);

      // A category the user picked in review survives the rule.
      const edited = { ...ruled, categoryId: dining.id };
      assert.deepEqual(await apply([edited]), [edited]);

      // A category learning actually applied still gives way to the rule, once.
      const learned = {
        date: "2026-09-08",
        description: "BUS/MRT 2",
        amountOut: 2,
        categoryId: internal.id,
        suggestedCategoryId: internal.id,
        suggestionApplied: true,
        metadata: learnedNote,
      };
      const [overridden] = await apply([learned]);
      assert.equal(overridden.categoryId, transport.id);
      assert.deepEqual(await apply([overridden]), [overridden]);

      // Adding a card rule later marks existing draft rows internal, then stays put.
      await TransactionService.createImportRule(user.id, {
        name: "UOB card BUS/MRT is Internal",
        accountIdentifier: CARD,
        matchType: "description_contains",
        matchValue: "BUS/MRT",
        markInternal: true,
        sortOrder: 45,
      });
      const [internalRow] = await apply([ruled]);
      assert.equal(internalRow.linkage?.type, "internal");
      assert.equal(internalRow.metadata.fixedRuleName, "UOB card BUS/MRT is Internal");
      assert.deepEqual(await apply([internalRow]), [internalRow]);
    });
  }));

import { test } from "node:test";
import assert from "node:assert/strict";
import { withChatDb } from "./test-harness";
import { ApprovalService } from "./approvals.service";
import { StaleAction, TransactionActions } from "./tools/transactions";
async function seed(db: any) {
  const user = await db.user.create({ data: { username: "approver" } });
  const conv = await db.chatConversation.create({ data: { userId: user.id } });
  const run = await db.chatRun.create({
    data: {
      userId: user.id,
      conversationId: conv.id,
      idempotencyKey: "one",
      provider: "openrouter",
      model: "test",
    },
  });
  const target = await db.transaction.create({
    data: {
      userId: user.id,
      date: new Date("2026-08-01"),
      description: "Lunch",
      amountOut: 20,
    },
  });
  return {
    user,
    run,
    target,
    context: { userId: user.id, runId: run.id, conversationId: conv.id },
  };
}
test("ledger preview is side-effect free and simultaneous approvals apply once", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const actions = new TransactionActions(db);
    const service = new ApprovalService(db, actions);
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [{ id: target.id, patch: { label: "Lunch with friends" } }],
    });
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: target.id } }))
        .label,
      null,
    );
    await assert.rejects(service.decideAction("other", proposal.id, "approve"));
    const outcomes = await Promise.all([
      service.decideAction(user.id, proposal.id, "approve"),
      service.decideAction(user.id, proposal.id, "approve"),
    ]);
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.equal(outcomes[0].status, "applied");
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: target.id } }))
        .label,
      "Lunch with friends",
    );
    assert.equal(
      await db.agentAuditEvent.count({
        where: { targetId: proposal.id, toolName: "chat_action_applied" },
      }),
      1,
    );
  }));
test("changed transaction invalidates approval and cannot overwrite the new state", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [{ id: target.id, patch: { label: "Proposed" } }],
    });
    await db.transaction.update({
      where: { id: target.id },
      data: { label: "Human edit" },
    });
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "stale",
    );
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: target.id } }))
        .label,
      "Human edit",
    );
  }));
test("linked reimbursement writes roll back together if a bulk edit fails", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const incoming = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-08-02"),
        description: "Refund",
        amountIn: 10,
      },
    });
    const service = new ApprovalService(db, new TransactionActions(db));
    await assert.rejects(
      service.proposeAction(context, {
        kind: "edit_transactions",
        edits: [
          {
            id: incoming.id,
            patch: {
              linkage: {
                type: "reimbursement",
                reimbursesAllocations: [
                  { transactionId: target.id, amount: 10 },
                ],
              },
            },
          },
          { id: target.id, patch: { categoryId: "foreign-category" } },
        ],
      }),
    );
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: incoming.id } }))
        .linkage,
      null,
    );
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: target.id } }))
        .linkage,
      null,
    );
    assert.equal(await db.chatActionProposal.count(), 0);
  }));
test("reimbursement preview includes backlink and a changed target invalidates it", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const incoming = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-08-02"),
        description: "Refund",
        amountIn: 10,
      },
    });
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [
        {
          id: incoming.id,
          patch: {
            linkage: {
              type: "reimbursement",
              reimbursesAllocations: [{ transactionId: target.id, amount: 10 }],
            },
          },
        },
      ],
    });
    assert.equal((proposal.preview as any).changes.length, 2);
    // The preview carries display data for the linked transaction, not just its ID.
    const refs = (proposal.preview as any).references;
    assert.equal(refs.transactions[target.id].id, target.id);
    assert.equal(refs.transactions[target.id].description, target.description);
    await db.transaction.update({
      where: { id: target.id },
      data: { amountOut: 5 },
    });
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "stale",
    );
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: incoming.id } }))
        .linkage,
      null,
    );
  }));
test("a confirmed direction edit clears the old amount", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [{ id: target.id, patch: { amountIn: "20.00", amountOut: null } }],
    });
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "applied",
    );
    const updated = await db.transaction.findUniqueOrThrow({
      where: { id: target.id },
    });
    assert.equal(updated.amountOut, null);
    assert.equal(updated.amountIn?.toFixed(2), "20.00");
  }));
test("edit previews show category colours and account colours", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const category = await db.category.create({
      data: { userId: user.id, name: "Internal", color: "#123456" },
    });
    await db.accountIdentifier.create({
      data: { userId: user.id, accountIdentifier: "CARD-1", color: "#abcdef" },
    });
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [{ id: target.id, patch: { categoryId: category.id } }],
    });
    const [change] = (proposal.preview as any).changes;
    assert.deepEqual(change.after.category, {
      id: category.id,
      name: "Internal",
      color: "#123456",
    });
    assert.equal(
      (proposal.preview as any).references.accounts["CARD-1"],
      "#abcdef",
    );
  }));
test("refreshing a stale proposal creates a new exact preview without applying it", () =>
  withChatDb(async (db) => {
    const { context, target, user } = await seed(db);
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [{ id: target.id, patch: { label: "Proposed" } }],
    });
    await db.transaction.update({
      where: { id: target.id },
      data: { label: "Human edit" },
    });
    await service.decideAction(user.id, proposal.id, "approve");
    const fresh = await service.refreshAction(user.id, proposal.id);
    assert.notEqual(fresh.id, proposal.id);
    assert.equal((fresh.preview as any).changes[0].before.label, "Human edit");
    assert.equal(
      (await db.transaction.findUniqueOrThrow({ where: { id: target.id } }))
        .label,
      "Human edit",
    );
    assert.equal(
      (await service.decideAction(user.id, fresh.id, "approve")).status,
      "applied",
    );
  }));
test("changing a staged reimbursement target invalidates a saved transaction preview", () =>
  withChatDb(async (db) => {
    const { context, user } = await seed(db);
    const incoming = await db.transaction.create({
      data: {
        userId: user.id,
        date: new Date("2026-08-02"),
        description: "Refund",
        amountIn: 10,
      },
    });
    const payload = {
      date: "2026-08-01",
      description: "Staged lunch",
      amountOut: 20,
    };
    const draft = await db.importDraft.create({
      data: {
        userId: user.id,
        mode: "main",
        sourceFilename: "a.csv",
        sourceSha256: "sha",
        status: "review",
        expiresAt: new Date("2099-01-01"),
        rows: {
          create: {
            rowIndex: 0,
            currentPayload: payload,
            parsedPayload: payload,
          },
        },
      },
      include: { rows: true },
    });
    const service = new ApprovalService(db, new TransactionActions(db));
    const proposal = await service.proposeAction(context, {
      kind: "edit_transactions",
      edits: [
        {
          id: incoming.id,
          patch: {
            linkage: {
              type: "reimbursement",
              reimbursesAllocations: [
                {
                  stagedDraftId: draft.id,
                  stagedRowId: draft.rows[0].id,
                  amount: 10,
                },
              ],
            },
          },
        },
      ],
    });
    await db.importDraftRow.update({
      where: { id: draft.rows[0].id },
      data: {
        version: { increment: 1 },
        currentPayload: { ...payload, amountOut: 5 },
      },
    });
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "stale",
    );
  }));
test("the final approval queues one durable continuation across repeated decisions", () =>
  withChatDb(async (db) => {
    const { context, target, user, run } = await seed(db);
    await db.chatConnection.create({
      data: {
        userId: user.id,
        provider: "openrouter",
        status: "connected",
        selected: true,
      },
    });
    await db.chatRun.update({
      where: { id: run.id },
      data: { status: "awaiting_confirmation" },
    });
    const service = new ApprovalService(db, new TransactionActions(db)),
      proposal = await service.proposeAction(context, {
        kind: "edit_transactions",
        edits: [{ id: target.id, patch: { label: "Confirmed" } }],
      });
    await service.decideAction(user.id, proposal.id, "approve");
    await service.decideAction(user.id, proposal.id, "approve");
    assert.equal(await db.chatRun.count({ where: { status: "queued" } }), 1);
    assert.equal(await db.chatRun.count(), 2);
  }));
async function stagedExpense(db: any, userId: string) {
  const payload = {
    date: "2026-09-27",
    description: "SINGLIFE",
    amountOut: 1486.16,
    currency: "SGD",
  };
  const draft = await db.importDraft.create({
    data: {
      userId,
      mode: "main",
      sourceFilename: "uob-oct.pdf",
      sourceSha256: "sha",
      status: "review",
      expiresAt: new Date("2099-01-01"),
      rows: {
        create: { rowIndex: 0, currentPayload: payload, parsedPayload: payload },
      },
    },
    include: { rows: true },
  });
  return { draft, row: draft.rows[0] };
}
/** A saved PayNow that is already a reimbursement, so linking it changes no field. */
async function savedReimbursement(db: any, context: any, userId: string) {
  const incoming = await db.transaction.create({
    data: {
      userId,
      date: new Date("2026-09-27"),
      description: "PAYNOW CAR INSURANCE",
      amountIn: 1500,
      currency: "SGD",
    },
  });
  const service = new ApprovalService(db, new TransactionActions(db));
  const setup = await service.proposeAction(context, {
    kind: "edit_transactions",
    edits: [{ id: incoming.id, patch: { linkage: { type: "reimbursement" } } }],
  });
  assert.equal(
    (await service.decideAction(userId, setup.id, "approve")).status,
    "applied",
  );
  return { incoming, service };
}
const linkTo = (incomingId: string, draftId: string, rowId: string) => ({
  kind: "edit_transactions",
  edits: [
    {
      id: incomingId,
      patch: {
        linkage: {
          type: "reimbursement",
          reimbursesAllocations: [
            { stagedDraftId: draftId, stagedRowId: rowId, amount: 1486.16 },
          ],
        },
      },
    },
  ],
});
test("a link to a staged row shows in the preview when no field changes", () =>
  withChatDb(async (db) => {
    const { context, user } = await seed(db);
    const { incoming, service } = await savedReimbursement(db, context, user.id);
    const { draft, row } = await stagedExpense(db, user.id);
    const proposal = await service.proposeAction(
      context,
      linkTo(incoming.id, draft.id, row.id),
    );
    const preview = proposal.preview as any;
    assert.deepEqual(preview.changes, []);
    assert.equal(preview.linkChanges.length, 1);
    const [link] = preview.linkChanges;
    assert.equal(link.change, "added");
    assert.equal(link.amount, "1486.16");
    assert.equal(link.leftover, "13.84");
    assert.equal(link.reimbursement.kind, "transaction");
    assert.equal(link.reimbursement.id, incoming.id);
    assert.equal(link.expense.kind, "staged");
    assert.equal(link.expense.description, "SINGLIFE");
    assert.equal(link.expense.draft.filename, "uob-oct.pdf");
    assert.equal(preview.references.stagedRows[row.id].description, "SINGLIFE");
    // Nothing was written while previewing.
    assert.equal(await db.reimbursementLink.count(), 0);
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "applied",
    );
    const saved = await db.reimbursementLink.findFirstOrThrow();
    assert.equal(saved.expenseDraftRowId, row.id);
    // The same edit again would change nothing, so it never becomes a card.
    await assert.rejects(
      service.proposeAction(context, linkTo(incoming.id, draft.id, row.id)),
      /Nothing would change/,
    );
  }));
test("an edit that changes nothing is refused without a proposal", () =>
  withChatDb(async (db) => {
    const { context, target } = await seed(db);
    const service = new ApprovalService(db, new TransactionActions(db));
    await assert.rejects(
      service.proposeAction(context, {
        kind: "edit_transactions",
        edits: [{ id: target.id, patch: { description: "Lunch" } }],
      }),
      /Nothing would change/,
    );
    assert.equal(await db.chatActionProposal.count(), 0);
  }));
test("links count toward staleness even when no transaction field changes", () =>
  withChatDb(async (db) => {
    const { context, user, target } = await seed(db);
    const { incoming, service } = await savedReimbursement(db, context, user.id);
    const { draft, row } = await stagedExpense(db, user.id);
    const actions = new TransactionActions(db);
    const label = {
      kind: "edit_transactions",
      edits: [{ id: incoming.id, patch: { label: "Car insurance" } }],
    };
    const first = await actions.prepare(user.id, label);
    // A link written elsewhere touches only the links table.
    const elsewhere = await db.reimbursementLink.create({
      data: {
        userId: user.id,
        amount: 5,
        reimbursementTransactionId: incoming.id,
        expenseTransactionId: target.id,
      },
    });
    const second = await actions.prepare(user.id, label);
    assert.notEqual(first.stateHash, second.stateHash);
    const proposal = await service.proposeAction(
      context,
      linkTo(incoming.id, draft.id, row.id),
    );
    await db.reimbursementLink.update({
      where: { id: elsewhere.id },
      data: { amount: 6 },
    });
    await assert.rejects(
      db.$transaction((tx) =>
        actions.execute(
          tx,
          user.id,
          proposal.arguments,
          proposal.stateHash,
        ),
      ),
      StaleAction,
    );
    assert.equal(
      (await service.decideAction(user.id, proposal.id, "approve")).status,
      "stale",
    );
    assert.equal(
      await db.reimbursementLink.count({ where: { expenseDraftRowId: row.id } }),
      0,
    );
  }));

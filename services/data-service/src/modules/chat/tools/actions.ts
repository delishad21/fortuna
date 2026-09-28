import { Prisma, PrismaClient } from "@prisma/client";
import { ActionHandler, TransactionActions } from "./transactions";
import { ImportActions } from "./imports";
import { ParserActions } from "./parsers";
import { SettingsActions } from "./settings";
import { ChatError } from "../contracts";
export class ChatActions implements ActionHandler {
  constructor(private db: PrismaClient) {}
  private handler(input: unknown): ActionHandler {
    const kind = (input as { kind?: string })?.kind;
    if (kind === "edit_transactions") return new TransactionActions(this.db);
    if (kind === "commit_drafts") return new ImportActions(this.db);
    if (
      [
        "retain_fixture",
        "approve_parser",
        "activate_parser",
        "rollback_parser",
      ].includes(kind || "")
    )
      return new ParserActions(this.db);
    if (
      ["create_account", "create_category", "update_import_rule"].includes(
        kind || "",
      )
    )
      return new SettingsActions(this.db);
    throw new ChatError(400, "This action is not available");
  }
  prepare(userId: string, input: unknown) {
    return this.handler(input).prepare(userId, input);
  }
  execute(
    tx: Prisma.TransactionClient,
    userId: string,
    input: unknown,
    hash: string,
    duplicateOverride: boolean,
  ) {
    return this.handler(input).execute(
      tx,
      userId,
      input,
      hash,
      duplicateOverride,
    );
  }
}

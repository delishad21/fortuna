import type { ChatRequest, TransactionReview } from "../../../shared/chat";

type Edit = { rowId: string; version: number; patch: Record<string, any> };

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The review as the user sees it: what the server last returned with unsaved edits on top.
 * Edits are saved one at a time in the order they were made, each based on its row's latest
 * version, so editing goes on while saves run.
 */
export class ReviewSaves {
  private saved: TransactionReview | null = null;
  private shown: TransactionReview | null = null;
  private waiting: Edit[] = [];
  private sending: Edit | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Counts edits and responses, so a read that overlaps one is ignored. */
  private changes = 0;
  /** A failed save; it stays until the user reloads. */
  error = "";

  constructor(
    private request: ChatRequest,
    private id: string,
    private onChange: () => void,
  ) {}

  get review() {
    return this.shown;
  }
  get pending() {
    return this.waiting.length + (this.sending ? 1 : 0);
  }
  /** Resolves when every edit made so far has been saved or refused. */
  idle() {
    return this.queue;
  }

  private publish() {
    this.changes++;
    const edits = this.sending ? [this.sending, ...this.waiting] : this.waiting;
    this.shown =
      this.saved && edits.length
        ? {
            ...this.saved,
            rows: this.saved.rows.map((row) => {
              const own = edits.filter((e) => e.rowId === row.id);
              return own.length
                ? {
                    ...row,
                    value: Object.assign(
                      {},
                      row.value,
                      ...own.map((e) => e.patch),
                    ),
                  }
                : row;
            }),
          }
        : this.saved;
    this.onChange();
  }

  /** Takes the server's review. `savedRow` is the row our own save just changed. */
  private adopt(next: TransactionReview, savedRow?: string) {
    for (const edit of this.waiting) {
      const before = this.saved?.rows.find((r) => r.id === edit.rowId);
      const after = next.rows.find((r) => r.id === edit.rowId);
      if (!before || !after) continue;
      // Another device changed the very field being saved: keep the old version, so the
      // save is refused instead of overwriting a value the user never saw.
      if (
        edit.rowId === savedRow ||
        Object.keys(edit.patch).every((field) =>
          same(before.value[field], after.value[field]),
        )
      )
        edit.version = after.version;
    }
    this.saved = next;
  }

  /** Replaces the review, e.g. after it was sent or cancelled. */
  accept(next: TransactionReview) {
    this.adopt(next);
    this.publish();
  }

  /** Reads the saved review, unless an edit is unsaved or is made meanwhile. */
  async load(allowed: () => boolean = () => true) {
    if (this.pending || !allowed()) return;
    const at = this.changes;
    const next = await this.request<TransactionReview>(`/reviews/${this.id}`);
    if (this.pending || at !== this.changes || !allowed()) return;
    this.accept(next);
  }

  /** The user's answer to a failed save: start again from what the server has. */
  async reload() {
    await this.queue;
    const next = await this.request<TransactionReview>(`/reviews/${this.id}`);
    this.error = "";
    this.accept(next);
  }

  update(index: number, field: string, value: any) {
    if (this.shown?.status !== "pending") return;
    const row = this.shown.rows[index];
    if (!row) return;
    const last = this.waiting[this.waiting.length - 1];
    if (last?.rowId === row.id) {
      last.patch = { ...last.patch, [field]: value ?? null };
    } else {
      this.waiting.push({
        rowId: row.id,
        version: row.version,
        patch: { [field]: value ?? null },
      });
      this.queue = this.queue.then(() => this.saveNext());
    }
    this.publish();
  }

  private async saveNext() {
    const edit = this.waiting.shift();
    // Edits dropped after a conflict leave their turn empty.
    if (!edit) return;
    this.sending = edit;
    try {
      const next = await this.request<TransactionReview>(
        `/reviews/${this.id}`,
        {
          method: "PUT",
          body: { rowId: edit.rowId, version: edit.version, patch: edit.patch },
        },
      );
      this.adopt({ ...this.saved!, ...next }, edit.rowId);
    } catch (e) {
      this.error = (e as Error).message;
      // Later edits to this row were made on top of the refused one.
      this.waiting = this.waiting.filter((w) => w.rowId !== edit.rowId);
      const next = await this.request<TransactionReview>(
        `/reviews/${this.id}`,
      ).catch(() => null);
      this.waiting = this.waiting.filter((w) => w.rowId !== edit.rowId);
      if (next) this.adopt(next);
    } finally {
      this.sending = null;
      this.publish();
    }
  }
}

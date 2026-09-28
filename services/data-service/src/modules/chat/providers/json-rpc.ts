import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
export class JsonRpcClient extends EventEmitter {
  private nextId = 0;
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  onToolCall?: (params: any) => Promise<unknown>;
  constructor(
    private input: Writable,
    output: Readable,
  ) {
    super();
    output.on("data", (chunk) =>
      this.receive(
        this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      ),
    );
    output.on("end", () => this.close());
    output.on("error", () => this.close());
    input.on("error", () => this.close());
  }
  private send(value: unknown) {
    if (!this.closed) this.input.write(JSON.stringify(value) + "\n");
  }
  notify(method: string, params: unknown = {}) {
    this.send({ method, params });
  }
  call<T = any>(method: string, params: unknown, timeout = 60000): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Codex connection closed"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex request timed out"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  private receive(chunk: string) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) {
      this.close(new Error("Codex frame too large"));
      return;
    }
    for (let end; (end = this.buffer.indexOf("\n")) >= 0; ) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let value: any;
      try {
        value = JSON.parse(line);
      } catch {
        this.close(new Error("Invalid Codex protocol frame"));
        return;
      }
      if (value.method && value.id !== undefined) {
        if (value.method !== "item/tool/call" || !this.onToolCall) {
          this.send({
            id: value.id,
            error: { code: -32601, message: "Capability is not available" },
          });
          continue;
        }
        Promise.resolve()
          .then(() => this.onToolCall!(value.params))
          .then(
            (result) => this.send({ id: value.id, result }),
            () =>
              this.send({
                id: value.id,
                error: { code: -32000, message: "Fortuna tool request failed" },
              }),
          );
      } else if (value.method) {
        this.emit("notification", value.method, value.params);
      } else {
        const pending = this.pending.get(value.id);
        if (!pending) continue;
        this.pending.delete(value.id);
        clearTimeout(pending.timer);
        value.error
          ? pending.reject(
              new Error("Codex request failed: " + String(value.error.code)),
            )
          : pending.resolve(value.result);
      }
    }
  }
  close(error = new Error("Codex connection closed")) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit("closed", error);
  }
}

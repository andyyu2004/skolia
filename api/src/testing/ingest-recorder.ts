import { WorkerEntrypoint } from "cloudflare:workers";

const received: unknown[] = [];

export default class IngestRecorder extends WorkerEntrypoint {
  override async queue(batch: MessageBatch): Promise<void> {
    for (const message of batch.messages) received.push(message.body);
    batch.ackAll();
  }

  received(): unknown[] {
    return received;
  }

  clear(): void {
    received.length = 0;
  }
}

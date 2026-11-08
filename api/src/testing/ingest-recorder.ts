import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

const received: unknown[] = [];

/** No container runs in the tests; they give the API their own jobs (testing/app.ts setup) */
export class Ingester extends DurableObject {
  jobs(): null {
    return null;
  }
}

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

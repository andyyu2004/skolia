// The ingest queue in Redis: ingest takes jobs from the right (BLMOVE), so push left.
// Must match analysis/src/skolia_analysis/ingest/jobs.py (QUEUE).
import { createClient } from "redis";
import type { IngestJob } from "@skolia/shared/schema";
import type { JobQueue } from "../ports.ts";

export const QUEUE = "skolia:ingest";

/** The one command the queue needs (the full client type doesn't survive
 * exactOptionalPropertyTypes when passed around). */
interface Client {
  lPush(key: string, element: string): Promise<number>;
}

export class RedisQueue implements JobQueue {
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static async connect(url: string): Promise<RedisQueue> {
    const client = createClient({ url });
    client.on("error", (error: unknown) => console.error("redis:", error));
    await client.connect();
    return new RedisQueue(client);
  }

  async send(job: IngestJob): Promise<void> {
    await this.client.lPush(QUEUE, JSON.stringify(job));
  }
}

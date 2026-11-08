// skolia-ingest on Cloudflare (api/wrangler.ingest.jsonc): consumes the ingest queue
// and hands each job to its language's analysis container (analysis/flake.nix, one
// image per language, served by analysis/src/skolia_analysis/ingest/http.py), which
// writes status and blobs to R2.
//
// A message is acked once the container has accepted the job, not when the analysis
// is done: a queue consumer may run for at most 15 minutes, and a long text can take
// longer. A job lost with its container is caught by the API, which queues a document
// again once it has been queued or analysing for too long (STUCK_AFTER_MS in app.ts).
//
// The containers use the durable_object scheduling policy, so each Ingester picks the
// image it starts. Jobs go to the Ingester named after their language's image: when a
// deploy changes an image, new jobs start a container with the new one while the old
// container finishes its jobs and stops.
import { DurableObject } from "cloudflare:workers";
import { isLang, type Lang } from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";
import type { IngestJobs } from "../ports.ts";

interface Env {
  INGESTER: DurableObjectNamespace<Ingester>;
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  /** The Host header for S3_ENDPOINT; wrangler dev only (api/.env) */
  S3_HOST?: string;
  /** How long the container stays up once idle, e.g. "30s" to test */
  SLEEP_AFTER?: string;
}

const PORT = 8080;
const RETRY_DELAY_SECONDS = 60;
const START_TIMEOUT_MS = 2 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5 * 1000;
// 1 vCPU, 6 GiB: Polish ingest peaked at 4.3 GiB on a 2,800-word text, English at 4.7 GiB
// (in Docker); the two languages in one container peaked at 6.7 GiB. French peaked at 3.5
// GiB on a 20,000-character text (analysis/EVALUATION.md)
const INSTANCE = "standard-2";
// How long past its last idle check a container keeps running if no further check
// comes, e.g. when an alarm fails
const INACTIVITY_MARGIN_MS = 5 * 60 * 1000;
// How long an idle container gets to exit on SIGTERM before it's killed; under
// blockConcurrencyWhile's 30 s
const STOP_TIMEOUT_MS = 10 * 1000;
const SIGTERM = 15;

/** What became of a job handed to the container */
type Outcome = "accepted" | "malformed" | "failed";

const UNIT_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000 } as const;

function milliseconds(duration: string): number {
  const match = /^(\d+)([smh])$/.exec(duration);
  if (match === null) throw new Error(`not a duration like 30s, 5m or 1h: ${duration}`);
  return Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}

/**
 * One per language that only routes, and one per image that runs its container:
 * route() on the Ingester named after a language passes the jobs to the one named after
 * that language's image in this Worker version.
 *
 * An analysis makes no requests, so the container's inactivity timeout can't tell a
 * busy container from an idle one. An alarm asks it instead, SLEEP_AFTER after its last
 * job and then every SLEEP_AFTER while it's busy, and stops it once it's idle.
 */
export class Ingester extends DurableObject<Env> {
  private readonly sleepAfterMs = milliseconds(this.env.SLEEP_AFTER ?? "5m");
  /** Settles when the container this object started exits */
  private exited: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A restarted Durable Object, e.g. after a deploy, has no timeout
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(this.inactivityTimeoutMs()));
    }
  }

  async route(lang: Lang, jobs: IngestJob[]): Promise<Outcome[]> {
    return await this.env.INGESTER.getByName(this.image(lang)).run(this.image(lang), jobs);
  }

  /** The language's container's jobs (GET /jobs), on the Ingester named after the
   * language. Null when no container is running; it isn't started to find out. */
  async jobs(lang: Lang): Promise<IngestJobs | null> {
    return await this.env.INGESTER.getByName(this.image(lang)).state();
  }

  async state(): Promise<IngestJobs | null> {
    const container = this.ctx.container;
    if (!container?.running) return null;
    try {
      const response = await container
        .getTcpPort(PORT)
        .fetch("http://ingest/jobs", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      return (await response.json()) as IngestJobs;
    } catch {
      // Not listening yet
      return null;
    }
  }

  private image(lang: Lang): string {
    const image = this.container().images[lang];
    if (image === undefined) throw new Error(`no ingest image for ${lang}`);
    return image;
  }

  async run(image: string, jobs: IngestJob[]): Promise<Outcome[]> {
    const container = this.container();
    if (!container.running) {
      // Synchronous from the check on, so a concurrent call can't start it twice
      container.start({
        image,
        instance: INSTANCE,
        // R2
        enableInternet: true,
        env: {
          SKOLIA_S3_ENDPOINT: this.env.S3_ENDPOINT,
          SKOLIA_S3_BUCKET: this.env.S3_BUCKET,
          AWS_ACCESS_KEY_ID: this.env.S3_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: this.env.S3_SECRET_ACCESS_KEY,
          AWS_DEFAULT_REGION: "auto",
          // An undefined value would reach the container as the string "undefined"
          ...(this.env.S3_HOST === undefined ? {} : { SKOLIA_S3_HOST: this.env.S3_HOST }),
        },
      });
      console.log("starting ingest:", image);
      this.exited = container.monitor().then(
        () => console.log("ingest exited:", image),
        (error: unknown) => console.error("ingest failed:", image, error),
      );
      this.ctx.waitUntil(this.exited);
      await container.setInactivityTimeout(this.inactivityTimeoutMs());
    }
    await this.ready(container);
    await this.ctx.storage.setAlarm(Date.now() + this.sleepAfterMs);
    const outcomes: Outcome[] = [];
    for (const job of jobs) outcomes.push(await this.post(container, job));
    return outcomes;
  }

  override async alarm(): Promise<void> {
    const container = this.ctx.container;
    if (!container?.running) return;
    // So that no job is handed over between the check and the container's exit: a job
    // that arrives meanwhile waits, then starts a new container
    await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.busy(container)) {
        console.log("ingest is busy; keeping it awake");
        await this.ctx.storage.setAlarm(Date.now() + this.sleepAfterMs);
        return;
      }
      console.log("ingest is idle; stopping it");
      // A restarted Durable Object hasn't watched the container yet
      const exited = this.exited ?? container.monitor().catch(() => undefined);
      // SIGTERM rather than destroy(), whose SIGKILL makes the exit look like a crash
      container.signal(SIGTERM);
      const timeout = scheduler.wait(STOP_TIMEOUT_MS).then(() => "timeout" as const);
      if ((await Promise.race([exited, timeout])) === "timeout") {
        console.error(`ingest didn't stop within ${STOP_TIMEOUT_MS} ms; killing it`);
        await container.destroy();
      }
    });
  }

  private container(): Container {
    const container = this.ctx.container;
    if (container === undefined) throw new Error("Ingester has no container");
    return container;
  }

  private inactivityTimeoutMs(): number {
    return this.sleepAfterMs + INACTIVITY_MARGIN_MS;
  }

  /** start() returns before the container listens */
  private async ready(container: Container): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      try {
        const response = await container
          .getTcpPort(PORT)
          .fetch("http://ingest/busy", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        // Not listening yet
      }
      if (!container.running) throw new Error("ingest stopped while starting");
      if (Date.now() > deadline) throw new Error(`ingest didn't listen within ${START_TIMEOUT_MS} ms`);
      await scheduler.wait(1000);
    }
  }

  private async post(container: Container, job: IngestJob): Promise<Outcome> {
    try {
      const response = await container.getTcpPort(PORT).fetch("http://ingest/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
      });
      // Always read the body: the container counts a request as in flight until its
      // body is consumed, and would never be idle
      const body = await response.text();
      if (response.status === 202) return "accepted";
      if (response.status === 400) {
        console.error("ingest refused job:", job, body);
        return "malformed";
      }
      console.error("ingest answered", response.status, "for", job, body);
      return "failed";
    } catch (error: unknown) {
      console.error("handing job to ingest failed:", job, error);
      return "failed";
    }
  }

  private async busy(container: Container): Promise<boolean> {
    try {
      const response = await container
        .getTcpPort(PORT)
        .fetch("http://ingest/busy", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const body: unknown = await response.json();
      return typeof body === "object" && body !== null && "busy" in body && body.busy === true;
    } catch (error: unknown) {
      console.error("asking ingest whether it's busy failed:", error);
      return false;
    }
  }
}

export default {
  async queue(batch, env) {
    const byLang = new Map<Lang, Message<IngestJob>[]>();
    for (const message of batch.messages) {
      const lang = message.body.lang;
      if (!isLang(lang)) {
        // The API only queues languages it knows: retrying won't help
        console.error("no ingest for language:", message.body);
        message.ack();
        continue;
      }
      byLang.set(lang, [...(byLang.get(lang) ?? []), message]);
    }
    await Promise.all([...byLang].map(([lang, messages]) => handOver(env, lang, messages)));
  },
} satisfies ExportedHandler<Env, IngestJob>;

/** One container per image: its jobs wait in its memory and run one at a time. */
async function handOver(env: Env, lang: Lang, messages: Message<IngestJob>[]): Promise<void> {
  let outcomes: Outcome[];
  try {
    outcomes = await env.INGESTER.getByName(lang).route(
      lang,
      messages.map((message) => message.body),
    );
  } catch (error: unknown) {
    console.error("starting ingest failed:", error);
    for (const message of messages) message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }
  messages.forEach((message, i) => {
    switch (outcomes[i]) {
      case "accepted":
      case "malformed":
        // Malformed: retrying won't help
        message.ack();
        break;
      case "failed":
      case undefined:
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
        break;
    }
  });
}

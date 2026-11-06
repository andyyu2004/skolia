// skolia-ingest on Cloudflare (api/wrangler.ingest.jsonc): consumes the ingest queue
// and hands each job to its language's analysis container (analysis/Dockerfile, one
// image per language, served by analysis/src/skolia_analysis/ingest/http.py), which
// writes status and blobs to R2.
//
// A message is acked once the container has accepted the job, not when the analysis
// is done: a queue consumer may run for at most 15 minutes, and a long text can take
// longer. A job lost with its container is caught by the API, which queues a document
// again once it has been queued or analysing for too long (STUCK_AFTER_MS in app.ts).
import { Container, getContainer } from "@cloudflare/containers";
import { isLang, type Lang } from "@skolia/shared/api";
import type { IngestJob } from "@skolia/shared/schema";

interface Env {
  INGEST_PL: DurableObjectNamespace<IngestPl>;
  INGEST_EN: DurableObjectNamespace<IngestEn>;
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  /** The Host header for S3_ENDPOINT; wrangler dev only (api/.env) */
  S3_HOST?: string;
  /** How long the container stays up after its last request, e.g. "30s" to test */
  SLEEP_AFTER?: string;
}

const PORT = 8080;
const RETRY_DELAY_SECONDS = 60;
const START_TIMEOUT_MS = 2 * 60 * 1000;

class IngestContainer extends Container<Env> {
  override defaultPort = PORT;
  override sleepAfter = this.env.SLEEP_AFTER ?? "5m";
  override envVars = {
    SKOLIA_S3_ENDPOINT: this.env.S3_ENDPOINT,
    SKOLIA_S3_BUCKET: this.env.S3_BUCKET,
    AWS_ACCESS_KEY_ID: this.env.S3_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: this.env.S3_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: "auto",
    // An undefined value would reach the container as the string "undefined"
    ...(this.env.S3_HOST === undefined ? {} : { SKOLIA_S3_HOST: this.env.S3_HOST }),
  };

  /** Only requests count as activity, and an analysis makes none, so ask before
   * stopping. Not stopping here restarts the timer. */
  override async onActivityExpired(): Promise<void> {
    if (!this.ctx.container?.running) return;
    if (await this.busy()) {
      console.log("ingest is busy; keeping it awake");
      return;
    }
    console.log("ingest is idle; stopping it");
    await this.stop();
  }

  private async busy(): Promise<boolean> {
    try {
      const response = await this.containerFetch("http://ingest/busy");
      const body: unknown = await response.json();
      return typeof body === "object" && body !== null && "busy" in body && body.busy === true;
    } catch (error: unknown) {
      console.error("asking ingest whether it's busy failed:", error);
      return false;
    }
  }
}

export class IngestPl extends IngestContainer {}

export class IngestEn extends IngestContainer {}

function namespace(env: Env, lang: Lang): DurableObjectNamespace<IngestContainer> {
  switch (lang) {
    case "en":
      return env.INGEST_EN;
    case "pl":
      return env.INGEST_PL;
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
    await Promise.all([...byLang].map(([lang, messages]) => handOver(namespace(env, lang), messages)));
  },
} satisfies ExportedHandler<Env, IngestJob>;

/** One container per language: its jobs wait in its memory and run one at a time. */
async function handOver(containers: DurableObjectNamespace<IngestContainer>, messages: Message<IngestJob>[]): Promise<void> {
  const ingest = getContainer(containers);
  try {
    // fetch() would start it too, but gives it only 20 s to listen
    await ingest.startAndWaitForPorts({ ports: PORT, cancellationOptions: { portReadyTimeoutMS: START_TIMEOUT_MS } });
  } catch (error: unknown) {
    console.error("starting ingest failed:", error);
    for (const message of messages) message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    return;
  }
  for (const message of messages) {
    try {
      const response = await ingest.fetch(
        new Request("http://ingest/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message.body),
        }),
      );
      // Always read the body: the container counts a request as in flight until its
      // body is consumed, and would never go to sleep
      const body = await response.text();
      if (response.status === 202) {
        message.ack();
      } else if (response.status === 400) {
        // Malformed: retrying won't help
        console.error("ingest refused job:", message.body, body);
        message.ack();
      } else {
        console.error("ingest answered", response.status, "for", message.body, body);
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      }
    } catch (error: unknown) {
      console.error("handing job to ingest failed:", message.body, error);
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}

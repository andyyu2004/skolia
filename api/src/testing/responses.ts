// Checking the typed client's (hono/client) responses, for the tests and the end-to-end tests (e2e.ts).
import type { ClientResponse } from "hono/client";

type Sent = ClientResponse<unknown, number, string>;

/** The JSON a response with this status has. */
export type BodyOf<R, S extends number> = R extends ClientResponse<infer T, S, "json"> ? T : never;

/** Fails, naming what was asked, unless the response has the status. */
export async function expectStatus<R extends Sent>(what: string, response: Promise<R>, status: number): Promise<R> {
  const sent = await response;
  if (sent.status !== status) throw new Error(`${what}: ${sent.status}, expected ${status}: ${await sent.text()}`);
  return sent;
}

/** The response's JSON, once it has the status (200 unless given). */
export async function body<R extends Sent, S extends number = 200>(what: string, response: Promise<R>, status?: S): Promise<BodyOf<R, S>> {
  const sent = await expectStatus(what, response, status ?? 200);
  return (await sent.json()) as BodyOf<R, S>;
}

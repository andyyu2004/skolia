import { DurableObject } from "cloudflare:workers";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import { LEMMAS, MIGRATIONS, SET_LEMMA, toKnownLemma } from "../user-data.ts";

export class User extends DurableObject<object> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.storage.transactionSync(() => migrate(this.sql));
  }

  lemmas(): KnownLemma[] {
    return this.sql.exec(LEMMAS).toArray().map(toKnownLemma);
  }

  setLemma(lemmaId: LemmaId, status: LemmaStatus, updated: string): void {
    this.sql.exec(SET_LEMMA, lemmaId, status, updated);
  }
}

function migrate(sql: SqlStorage): void {
  sql.exec("CREATE TABLE IF NOT EXISTS migration (id INTEGER PRIMARY KEY)");
  const { applied } = sql.exec<{ applied: number }>("SELECT count(*) AS applied FROM migration").one();
  MIGRATIONS.slice(applied).forEach((migration, i) => {
    sql.exec(migration);
    sql.exec("INSERT INTO migration (id) VALUES (?)", applied + i);
  });
}

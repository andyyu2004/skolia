import { DurableObject } from "cloudflare:workers";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import { MIGRATIONS } from "../user/migrations/index.ts";
import { LEMMAS, SET_LEMMA, toKnownLemma } from "../user/queries.ts";

export class User extends DurableObject<object> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate(MIGRATIONS.length);
  }

  migrate(version: number): void {
    if (!Number.isInteger(version) || version < 0 || version > MIGRATIONS.length) {
      throw new RangeError(`no migration ${version}: there are ${MIGRATIONS.length}`);
    }
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS migration (version INTEGER PRIMARY KEY)");
      const { current } = this.sql.exec<{ current: number }>("SELECT coalesce(max(version), 0) AS current FROM migration").one();
      for (let v = current + 1; v <= version; v++) {
        this.sql.exec(MIGRATIONS[v - 1]!.up);
        this.sql.exec("INSERT INTO migration (version) VALUES (?)", v);
      }
      for (let v = current; v > version; v--) {
        this.sql.exec(MIGRATIONS[v - 1]!.down);
        this.sql.exec("DELETE FROM migration WHERE version = ?", v);
      }
    });
  }

  lemmas(): KnownLemma[] {
    return this.sql.exec(LEMMAS).toArray().map(toKnownLemma);
  }

  setLemma(lemmaId: LemmaId, status: LemmaStatus, updated: string): void {
    this.sql.exec(SET_LEMMA, lemmaId, status, updated);
  }
}

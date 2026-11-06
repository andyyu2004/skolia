import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import type { KnownLemma, LemmaId, LemmaStatus } from "@skolia/shared/api";
import migrations from "../user/migrations.gen.ts";
import { knownLemma } from "../user/schema.ts";

const schema = { knownLemma };

export class User extends DurableObject<object> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;

  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    void ctx.blockConcurrencyWhile(() => migrate(this.db, migrations));
  }

  lemmas(): KnownLemma[] {
    return this.db.select().from(knownLemma).all();
  }

  setLemma(lemmaId: LemmaId, status: LemmaStatus, updated: string): void {
    this.db
      .insert(knownLemma)
      .values({ lemmaId, status, updated })
      .onConflictDoUpdate({ target: knownLemma.lemmaId, set: { status, updated } })
      .run();
  }
}

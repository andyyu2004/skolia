import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { LEMMA_STATUSES, type LemmaId } from "@skolia/shared/api";

export const knownLemma = sqliteTable("known_lemma", {
  lemmaId: text("lemma_id").$type<LemmaId>().primaryKey(),
  status: text("status", { enum: LEMMA_STATUSES }).notNull(),
  updated: text("updated").notNull(),
});

export const withoutRowid = [knownLemma];

// ts-fsrs, pinned in package.json: docs/adr/0001-flashcards.md says what was checked.
import { DefaultScheduler, type DefaultSchedulerCard } from "ts-fsrs";
import type { Rating } from "@skolia/shared/api";

export type FsrsCard = DefaultSchedulerCard;

let scheduler: Promise<DefaultScheduler> | undefined;

/** One per isolate: making it loads the model's weights. */
export function fsrs(): Promise<DefaultScheduler> {
  return (scheduler ??= DefaultScheduler());
}

/** A new card under our id, which also seeds its fuzz. */
export function newCard(s: DefaultScheduler, id: string, now: Date): FsrsCard {
  return s.newCard({ now, cardId: id });
}

export function review(s: DefaultScheduler, card: FsrsCard, rating: Rating, at: Date): FsrsCard {
  return s.review({ card, grade: rating, now: at }).card;
}

/** As stored: JSON turns its Dates into toISOString()'s strings. */
export function toJson(card: FsrsCard): string {
  return JSON.stringify(card);
}

/** ts-fsrs refuses strings where it wants Dates. */
export function fromJson(json: string): FsrsCard {
  const raw = JSON.parse(json) as Omit<FsrsCard, "dueAt" | "lastReviewAt"> & { dueAt: string; lastReviewAt: string | null };
  return { ...raw, dueAt: new Date(raw.dueAt), lastReviewAt: raw.lastReviewAt === null ? null : new Date(raw.lastReviewAt) };
}

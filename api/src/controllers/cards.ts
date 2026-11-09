// Words, flashcards, reviews and settings, which live in each user's Durable Object, and
// the lexicon entries the cards show.
import {
  MAX_LOOKUP,
  timestamp,
  type CardCounts,
  type Due,
  type FeatureSets,
  type Lang,
  type LemmaId,
  type LexiconEntry,
  type Lookup,
  type Reviewed,
  type ReviewRequest,
  type ScheduledCard,
  type Settings,
  type Timestamp,
  type User,
  type Word,
  type WordStatus,
} from "@skolia/shared/api";
import type { Deps, Lexicon } from "../ports.ts";
import { NO_CONTENT, fail, ok, type Failed, type NoContent, type Ok } from "./result.ts";

/** Most cards one due list has: a session's worth. */
const MAX_DUE = 200;
/** How far ahead of the server's clock a review's time may be. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function words(deps: Deps, user: User): Promise<Ok<Word[]>> {
  return ok(await deps.users.words(user.id));
}

export async function setWord(deps: Deps, user: User, lemmaId: LemmaId, status: WordStatus): Promise<NoContent> {
  await deps.users.setWord(user.id, lemmaId, status, timestamp(deps.now()));
  return NO_CONTENT;
}

/** dayStart: when the user's day started, any ISO time; today's new cards count from it. */
export async function counts(deps: Deps, user: User, dayStart: string): Promise<Ok<CardCounts[]>> {
  return ok(await deps.users.counts(user.id, timestamp(deps.now()), stored(dayStart)));
}

export async function due(deps: Deps, user: User, lang: Lang, dayStart: string): Promise<Ok<Due>> {
  const { cards, newLeft } = await deps.users.due(user.id, lang, timestamp(deps.now()), stored(dayStart), MAX_DUE);
  return ok({ ...(await withEntries(deps.lexicon, lang, cards)), newLeft });
}

export async function review(deps: Deps, user: User, request: ReviewRequest): Promise<Ok<Reviewed> | Failed<400 | 404 | 409>> {
  if (Date.parse(request.at) > deps.now().getTime() + MAX_CLOCK_SKEW_MS) return fail(400, "review is in the future");
  const outcome = await deps.users.review(user.id, request, timestamp(deps.now()));
  switch (outcome.kind) {
    case "reviewed":
      return ok({ cardId: outcome.cardId, dueAt: outcome.dueAt });
    case "no-card":
      return fail(404, "no such card");
    case "out-of-order":
      return fail(409, "review is older than the card or its last review");
    case "id-reused":
      return fail(409, "review id is another card's");
  }
}

export async function settings(deps: Deps, user: User): Promise<Ok<Settings>> {
  return ok(await deps.users.settings(user.id));
}

export async function setSettings(deps: Deps, user: User, settings: Settings): Promise<NoContent> {
  await deps.users.setSettings(user.id, settings);
  return NO_CONTENT;
}

export async function lookUp(deps: Deps, ids: LemmaId[]): Promise<Ok<Lookup>> {
  return ok(await deps.lexicon.entries(ids));
}

function stored(time: string): Timestamp {
  return timestamp(new Date(time));
}

/** The cards with their lexicon entries, and the feature sets the entries' paradigms use,
 * looked up MAX_LOOKUP lemmas at a time. */
async function withEntries(lexicon: Lexicon, lang: Lang, cards: ScheduledCard[]): Promise<Pick<Due, "cards" | "featureSets">> {
  const entries = new Map<LemmaId, LexiconEntry>();
  const featureSets: FeatureSets = {};
  const ids = [...new Set(cards.map((card) => card.lemmaId))];
  for (let i = 0; i < ids.length; i += MAX_LOOKUP) {
    const found = await lexicon.entries(ids.slice(i, i + MAX_LOOKUP));
    for (const entry of found.entries) entries.set(entry.lemmaId, entry);
    Object.assign(featureSets, found.featureSets[lang]);
  }
  return { cards: cards.map((card) => ({ ...card, entry: entries.get(card.lemmaId) ?? null })), featureSets };
}

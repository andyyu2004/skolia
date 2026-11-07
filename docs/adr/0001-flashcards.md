# 1. Flashcards

2026-11-08. Accepted.

## Context

Readers need to review the words they meet. The plan in ARCHITECTURE.md was FSRS in JS, cards keyed on the lemma, and user data pointing at the text. The per-user Durable Object (`api/src/worker/user.ts`) has a `known_lemma` table with `new | learning | known | ignored` and the `/api/me/lemmas` routes. The reader doesn't use them yet.

## Decision

### Scheduler: ts-fsrs 6.0.0

[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), MIT licensed. Its one dependency, `@open-spaced-repetition/srs-kit`, is BSD-3-Clause. Pin the exact version: 6.0.0 was published 2026-10-28 and renamed fields from v5.

Checked by running it under Node 24.18.1:

- `const s = await DefaultScheduler(options)`, then `s.newCard({ now })` and `s.review({ card, grade, now })`. `review` returns `{ card, revlog }` and doesn't mutate the card it's given. `s.preview(...)` gives the outcome of each grade.
- The default model is FSRS-7, with learning steps of 1m and 10m and relearning steps of 10m.
- `Rating` is `Manual 0, Again 1, Hard 2, Good 3, Easy 4`.
- A card's fields are `cardId, stability, stabilityFast, difficulty, state, scheduleStatus, dueAt, lastReviewAt, reps, lapses, scheduledDays, learningStep`.
- `Reschedule` (imported from `ts-fsrs/reschedule`, not the package root) rebuilt a card from `[{ rating, reviewTime }]`. The result was identical, field for field, to the card from the live `review()` calls.
- Fuzz is off by default (`enableFuzz = false` in its `dist/index.mjs`). We turn it on, so words added together don't all come due on the same day. It's seeded by `cardId`, so replay reproduces fuzzed intervals when our card id is used as `cardId`.
- `dueAt` and `lastReviewAt` must be `Date` objects. A card passed back after a JSON round-trip throws `SRSSchemaError: Expected valid Date fields`.
- On a new card:
  - Good went straight to a 6-day interval.
  - Again on the next review brought it back after 10 minutes.
  - Easy at every review gave intervals of 54, 234, 871, 3088 and 10723 days, then hit the 36500-day cap.
- The package declares `engines: node >=24`, but its `dist` has no `node:` imports. Bundling it for the browser and for workerd hasn't been tried yet.

### Words, cards and reviews

A word replaces `known_lemma`. Each word has two cards, like Anki's note and its cards.

```
word(lemma_id, status, updated)               -- active | known | ignored
card(id, lemma_id, kind, ...ts-fsrs card fields)
review(id, card_id, rating, review_time)      -- append-only
```

- `lemma_id` is the entry's id after the bundle's fallback lookup (`bundle.lookup`), so it matches a lexicon row exactly. *Old* in "Old Town" is filed under `en:old:ADJ`.
- Only the lemma for now. Practising its forms and cases is a later extension.
- There are two kinds of card:
  - `recognition`: the lemma on the front, the English glosses on the back.
  - `production`: the glosses on the front, with hints that pin down one answer (aspect, sense tags), and the lemma on the back.
- Adding a word from the reader creates the word and both cards. If they already exist, it does nothing. The two cards are scheduled independently, with no special handling of siblings.
- `known` or `ignored` takes a word's cards out of reviews without deleting them or their history, and `active` brings them back. Marking a word known needs no cards. Known words aren't rated Easy, because Easy brings them back after 54 and 234 days, and those ratings would end up in the review log.
- Reviews have four buttons, Again, Hard, Good and Easy, which are ts-fsrs's ratings 1 to 4.
- The `review` table is the source of truth. The ts-fsrs fields on `card` are a cache that `Reschedule` can rebuild. It is also what a per-user FSRS weight fit (`@open-spaced-repetition/binding`) would be trained on later.
- The client makes each review's `id` (a UUID), and the server ignores an id it already has for that card, so a retried request isn't counted twice. The same id sent for another card gets a 409.
- A review's time comes from the client, for offline review later. It may not be before the card was made or its last review (409), or more than 5 minutes ahead of the server (400).
- The reader shows a word as:
  - `known` or `ignored` if the user marked it;
  - otherwise known once its recognition card is mature (an interval of at least 21 days, Anki's definition);
  - learning if it has cards;
  - new if there's no word row.
- Cards don't copy the dictionary entry. They're looked up in the lexicon (below).

### Lexicon in D1

The lexicon SQLite is built by Nix (`analysis/flake.nix`, `lexicon`) and only exists inside the ingest images, so the API Worker can't read it. It goes into a separate D1 database, `skolia-lexicon`:

- The columns are `lemma_id, version, lang, lemma, upos, senses, relations`, without paradigms (`api/lexicon-migrations`). Each environment has its own, previews included. Every deploy runs `just load-lexicon` (`deploy.yml`, job `load-lexicon`), from the Nix build the images' job put in Cachix; a preview loads only the English entries for wordfreq's 3,000 most common words (`--sample`): 6,028 entries, about 12,000 rows written with the primary key's index, against D1's 50 million a month included.
- Sizes of the local lexicons (`data/lexicon/`):

  | | entries | senses + relations | paradigms |
  |---|---|---|---|
  | pl | 98,917 | 19.8 MB | 0.2 MB |
  | en | 745,660 | 196.6 MB | 140.9 MB |

- `just load-lexicon <env>` loads it from the same Nix output the image uses (`analysis#lexicon-{lang}`), through `infra/load-lexicon.py`. It's keyed by the lexicon version in the SQLite's `meta` table:
  - An unchanged version is skipped.
  - A new version's rows go in beside the old ones, then `loaded` points at it, and the old rows are deleted 50,000 at a time. A load that stops part way leaves the old version serving. Every run deletes any old rows left over, even when the version hasn't changed.
  - Loading Polish into wrangler's local D1 took about 5 s for 30 MB of SQL, and gave all 98,917 entries.
- `POST /api/lexicon/entries { ids }` returns the entries for up to 100 ids. The due list carries its cards' entries, so a review session needs one request. Caching them in IndexedDB for offline review is for later.

### Routes

```
GET  /api/me/words                    statuses and maturity, for the reader's colouring
PUT  /api/me/words/:lemmaId           { status }; active creates the cards
GET  /api/me/cards/due?dayStart=      due cards, then new ones, with the words' entries
POST /api/me/reviews                  { id, cardId, rating, at }
GET  /api/me/settings                 { newPerDay }
PUT  /api/me/settings                 { newPerDay }
POST /api/lexicon/entries             { ids }
```

These replace `/api/me/lemmas`. `dayStart` is the start of the reader's local day, so the day's new cards are counted in the user's time zone. A card counts against the day the server first recorded an answer for it (`card.first_reviewed`), so a review's client time can't move it to another day. The Durable Object runs `review()`, appends to `review` and updates `card` in one transaction. Review is online at first. The log and the client-made ids leave room for an offline queue that syncs later.

### Other decisions

- How many new cards a day is a setting stored in the user's Durable Object. It defaults to 20, Anki's default.
- The ts-fsrs state is stored as JSON on each card, with its due time, schedule status and interval as generated columns for the queries. It's a cache of the review log, and keeping it as JSON means a ts-fsrs upgrade doesn't need a migration.
- ts-fsrs adds about 65 KB minified to the Worker (17 KiB gzipped). About 16 KB of that is the FSRS-3 to FSRS-5 models, which `DefaultScheduler` bundles though it uses FSRS-7.
- `known_lemma` was a test table, so it's dropped, not migrated.
- D1's limit is 10 GB per database, well above the lexicons' ~220 MB.

## Open

- How long a remote load takes. Only a local load of Polish has been tried. D1's limits page allows 100 bound parameters per query (the lookup takes at most 100 ids), 100,000-byte statements (the loader keeps them under 90,000), and a 5 GB file per `d1 execute`.
- Showing words in the reader by status (new, learning, known), and offline review.

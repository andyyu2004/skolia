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
card(id, lemma_id, lang, kind, active, ...ts-fsrs card fields)
review(id, card_id, rating, review_time)      -- append-only
```

- `lemma_id` is the entry's id after the bundle's fallback lookup (`bundle.lookup`), so it matches a lexicon row exactly. *Old* in "Old Town" is filed under `en:old:ADJ`.
- Only the lemma for now. Practising its forms and cases is a later extension.
- There are two kinds of card:
  - `recognition`: the lemma on the front, its meanings on the back.
  - `production`: the English word on the front (the first sense's translations without their definitions, `clue` in `reader/src/lib/review.ts`) with the part of speech and aspect, and the lemma and its meanings on the back. Form-of glosses ("verbal noun of dopracować") make poor clues.
- Tapping a word you've never marked adds it: a tap suggests you didn't know it. Proper nouns, numbers and symbols aren't added (`WordSheet.svelte`). The word sheet has no controls for it; a card's Known button, while reviewing, marks the word known and skips its other card that session (`Review.svelte`). `ignored` has no button for now. Adding a word creates the word and both cards. If they already exist, it does nothing. The two cards are scheduled independently, with no special handling of siblings.
- `known` or `ignored` takes a word's cards out of reviews without deleting them or their history, and `active` brings them back. Marking a word known needs no cards. Known words aren't rated Easy, because Easy brings them back after 54 and 234 days, and those ratings would end up in the review log.
- Each language is reviewed on its own, like an Anki deck per language, with its own daily allowance of new cards. `card.lang` is generated from the lemma id, and every card index starts with it.
- `card.active` copies the word's status (active or not), which `setWord` keeps in step, so the review queries need only `card`'s partial indexes and don't join `word`.
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

The lexicon SQLite is built by Nix (`analysis/flake.nix`, `lexicon`) and only exists inside the ingest images, so the API Worker can't read it. Cards also need what a document's bundle has and the lexicon doesn't: the lemma's pronunciations, and Polish paradigms, which Morfeusz generates during ingest. So `skolia-build-cards` (`analysis/src/skolia_analysis/lexicon/cards.py`) builds a cards lexicon from it, the Nix output `cards-lexicon-{lang}`, which isn't in the images. That goes into a D1 database of its language's own, `skolia-lexicon-{lang}`, bound as `LEXICON_{LANG}` (`api/lexicon-migrations`). Each environment has its own, previews included.

```sql
entry(lemma_id, version, lemma, upos, senses, relations, pronunciations, paradigms)
featureset(version, id, feature, value)
loaded(id = 1, version)        -- the version served
```

A paradigm lists each spelling once, with the feature sets it has, by id. Morfeusz's

```json
{"form": "psa", "xpos": "subst:sg:gen:m2", "feats": {"Animacy": "Nhum", "Case": "Gen", "Gender": "Masc", "Number": "Sing"}}
{"form": "psa", "xpos": "subst:sg:acc:m2", "feats": {"Animacy": "Nhum", "Case": "Acc", "Gender": "Masc", "Number": "Sing"}}
```

is `["psa", [50, 51]]` in `entry.paradigms`:

```json
[{"homonym": "Sm2", "forms": [["pies", [49]], ["psa", [50, 51]], ["psu", [52]], ...]}]
```

and sets 50 and 51 are rows of `featureset`, one per UD feature:

```
version  id  feature  value
…        50  Animacy  Nhum
…        50  Case     Gen
…        50  Gender   Masc
…        50  Number   Sing
…        51  Case     Acc
…
```

- It's the bundle's compact form (`compact` and `FeatsTable` in `bundle.py`): repeated feature objects and Morfeusz's `xpos` take most of the room, so all of Polish is 45 MB this way and about 889 MB as Morfeusz gives it (extrapolated from 3,000 lemmas).
- Feature sets are rows, not a column per feature: languages use different features (Polish 24, among them Variant, PrepCase and the layered `Number[psor]`; English 7), and UD lets a language add its own. A set's id only means something within its version, since a rebuild can number them differently.
- `entry.pronunciations` is the lemma's, with the bundle's fallbacks: `[{"ipa": "/ˈpjɛs/"}]`.
- A database per language, so each grows on its own as languages are added, a language's load or cleanup doesn't touch another's, and none gets near D1's 10 GB limit. The cost is a binding, its migrations and a Terraform resource per language, all driven by one list each (`LANGS`, `local.langs` in `infra/variables.tf`, `langs` in the `justfile`, and the bindings in `api/wrangler.jsonc`), and a lookup across languages makes a query per language (`D1Lexicon`).
- Paradigms stay JSON rather than a row per form: a card shows a lemma's whole table. A row per form would be about 6.4 million rows (Polish about 5.0 million, extrapolated; English 1,420,877), about 13 million rows written per full load against D1's 50 million a month included. Practising cases, or checking a typed answer against any form, would be the reason to change that.
- Sizes of the local cards lexicons (`data/lexicon/*.cards.sqlite`):

  | | entries | senses + relations | pronunciations | paradigms | feature sets (rows) |
  |---|---|---|---|---|---|
  | pl | 98,917 | 18.8 MB | 2.3 MB | 45.3 MB | 1,834 (10,921) |
  | en | 745,660 | 191.5 MB | 7.8 MB | 25.5 MB | 35 (136) |

- `just load-lexicon <env>` loads it through `infra/load-lexicon.py`, and every deploy runs it (`deploy.yml`, job `load-lexicon`). It's keyed by the cards lexicon's version, the lexicon's with `+cards1` (`CARDS_VERSION`):
  - An unchanged version is skipped.
  - A new version's rows go in beside the old ones, then `loaded` points at it, and the old rows are deleted 50,000 at a time. A load that stops part way leaves the old version serving. Every run deletes any old rows left over, even when the version hasn't changed.
  - A preview loads only the English entries for wordfreq's 3,000 most common words (`--sample`): 6,028 entries, about 12,000 rows written with the primary key's index.
  - Locally (`just lexicon-local`, which rebuilds `{lang}.cards.sqlite` when the lexicon is newer), loading both took about 75 s: 80 MB of SQL for Polish, 301 MB for English.
- `POST /api/lexicon/entries { ids }` returns the entries for up to 100 ids and the feature sets their paradigms use, by language. The due list carries its cards' entries and their feature sets, so a review session needs one request. Caching them in IndexedDB for offline review is for later.
- With pronunciations and paradigms in D1, most of a document's bundle repeats it. The bundle could shrink to what's the document's own (`lookup`, how each token resolves to a lemma id) once D1 also has frames, idioms and the pronunciations of inflected forms; then a lexicon update reaches old documents without re-bundling them.

### Routes

```
GET  /api/me/words                    statuses and maturity, for the reader's colouring
PUT  /api/me/words/:lemmaId           { status }; active creates the cards
GET  /api/me/cards/counts?dayStart=   each language's due and new counts
GET  /api/me/cards/due?lang=&dayStart= a language's due cards, then new ones, with the words' entries
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
- D1's limit is 10 GB per database, well above the cards lexicons' ~300 MB.

## Open

- How long a full remote load takes. Only previews' sample has been loaded remotely. D1's limits page allows 100 bound parameters per query (the lookup takes at most 100 ids), 100,000-byte statements (the loader keeps them under 90,000), and a 5 GB file per `d1 execute`.
- Showing words in the reader by status (new, learning, known), and offline review.

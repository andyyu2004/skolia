# skolia architecture

An assisted-reading app built around morphology. Tap a word or select a span. You get the lemma, the full grammatical features, the paradigm with the current form highlighted, and why the word has that form. Polish first, kept behind a language-plugin interface.

## Principles

- **Analyze once, at import.** Taps are local lookups: instant and offline. Only translations and explanations need the network.
- **UD features are the internal schema** (`Case=Gen|Number=Sing|Gender=Masc|Animacy=Anim`). Only plugins know which language they handle.
- **Track knowledge per lemma.** Known words and cards key on `(lang, lemma, upos)`, not on surface forms.
- **Keep the readings the analyzer didn't pick.** Show alternatives and let user corrections override them.
- **The LLM explains; it doesn't analyze.** It gets the sentence plus the parsed features. Its responses are cached and shared across users.
- **The source text is permanent, analysis can be thrown away, and user data points at the text** (character offsets).

## Components

```
Phone or desktop (responsive PWA) ──► skolia (Worker: reader assets + API) ──► D1 (users, cards, quotas, doc metadata)
  │                                      │                                └─► R2 (source texts, analyses, bundles, status)
  │                                      │
  │                                      └─► Queue ──► skolia-ingest (Worker) ──► Durable Object ──► container (Python) ──► R2
  │
  └─ IndexedDB: cached document bundles
```

Locally (`compose.yaml`): the API runs on Node, Redis replaces the Queue, RustFS (S3 API) replaces R2 and a SQLite file replaces D1. The API reaches them through small interfaces (`api/src/ports.ts`); ingest reaches storage over the S3 API, which R2 also speaks. Ingest writes `doc/{doc}/status.json` as it goes (queued, analysing, ready, failed), and the API reads it to tell the reader.

On Cloudflare: Terraform (`infra/`) manages R2, D1, the queue, the `skolia` Worker with the reader as static assets, the skolia.io domain and ingest's R2 token. The `skolia-ingest` Worker and its container are deployed with wrangler (`api/wrangler.ingest.jsonc`), as the provider has no container resource. The consumer hands each job to the container over HTTP and acks it once accepted: a consumer may run 15 minutes and an analysis can take longer. The container keeps jobs in memory, sleeps when idle (the Durable Object asks ingest whether it's busy before stopping it), and has the models and lexicon in its image. A job lost with its container is re-queued by the stuck rule below.

| Part | Tech | Responsibility |
|---|---|---|
| Client | PWA, Svelte 5 + TypeScript; one layout for phone (bottom sheet) and desktop (side panel) | Reader, word/span sheet, paradigm tables, review sessions (FSRS in JS), local state with background sync |
| API | Cloudflare Workers (TypeScript) | Auth, sync, import job submission, explain proxy + cache, quotas |
| User data | D1 | Users, document metadata, known lemmas, cards, overrides, explanation cache |
| Blobs | R2 | Lexicon files per language, source texts, analysis blobs |
| Analysis | Python on Cloudflare Containers, fed from Cloudflare Queues by a consumer Worker | Segment, analyze, match lexicon, write blob |
| Lexicon build | Offline Python scripts | Kaikki/Wiktionary + Morfeusz → per-language lexicon files |

## Frontend / backend split

The backend does anything heavy, anything that happens once, and anything secret. The frontend does anything that has to feel instant.

```
Import:       phone → API → queue → analysis container    (slow, once per text)
Open:         phone ← document + its lexicon bundle        (one request, then cached)
Tap/select:   phone only                                   (structure, paradigm, gloss)
Translate/why: phone → API → cache or LLM                  (network, metered)
Mark/review:  phone first, synced later
```

## Language plugin

```python
class LanguagePlugin:
    code: str
    def segment(text) -> list[Sentence]
    def analyze(sentence) -> list[Token]        # lemma, upos, feats, head, deprel, candidates
    def paradigm_layout(upos) -> Layout         # e.g. noun: rows=Case, cols=Number
    def government(lemma, upos) -> list[Frame]  # optional: "do + Gen", "pomagać + Dat"
    def aspect_partner(lemma) -> str | None     # optional, language-specific
```

Polish: COMBO (XLM-RoBERTa, trained on UD Polish PDB) picks the reading that fits the context and gives the dependency parse; Stanza models are available as alternatives. Morfeusz 2 supplies the list of candidate readings and generates missing paradigms. When the parser's reading isn't one Morfeusz allows, the closest Morfeusz reading replaces it and the parser's is kept alongside. Measured choices and scores: `analysis/EVALUATION.md`.

Why a word has its case is worked out at import (`pl_cases.py`) from the dependency tree and the verb's valency in Walenty (IPI PAN's valency dictionary, CC BY-SA 4.0): each token with a case gets a `case_reason` (the rule, the word that causes it, and the verb or preposition). Rules: preposition, agreement, coordination, governing numeral, verb's lexical case (`szukać` + gen), negation (`nie mam czasu`), structural object, partitive, subject, predicate after `być`, possessive and noun complement, verbal noun's object, instrumental, vocative. The reader turns the reason into a sentence and underlines the triggering word.

## Lexicon (static, per language)

Built offline (`analysis/src/skolia_analysis/lexicon/`) into one SQLite file per language on the server, keyed by the analyser's `lemma_id`. The lexicon follows the analyser's conventions: each Kaikki (Wiktionary) headword is looked up in Morfeusz and converted with the analyser's own code, so `który` is filed as DET just as the analyser tags it.

```
entry(lemma_id, lemma, upos, senses_json, relations_json)
  senses:    gloss, tags (slang, dated...), examples, and `when`: the features that select
             the sense (pies the dog: Animacy=Nhum; the cop: Animacy=Hum)
  relations: aspect partner (robić <-> zrobić), derived-from (pani <- pan, rubelek <- rubel)
```

Paradigms aren't stored: Morfeusz generates them, in the analyser's feature conventions, when a document's bundle is made. A verb's paradigm includes its participles and gerunds.

Each imported document gets a bundle with only the lemmas it uses (meanings, relations, paradigms), so taps stay offline. Lookup falls back from the exact `lemma_id` to the same lemma under another part of speech, then to the lemma lowercased. A full-dictionary download for search is a possible later addition (meanings only, without paradigms).

Later: showing a word's frames on its sheet ("`pomagać` + dative", from the same Walenty data the case reasons use) and `expression` (multi-word, matched by lemma sequence, from Wiktionary's phrase entries and Walenty's idioms).

## Documents and versioning

```
doc/{hash}/text.txt                                     -- permanent
doc/{hash}/status.json                                  -- import state; points at the current analysis and bundle
doc/{hash}/analysis/s{schema}-a{analyzer}.json.br       -- derived, disposable
doc/{hash}/bundle/b{schema}-a{analyzer}-l{lexicon}.json.br  -- derived, disposable
versions/{lang}.json                                    -- what ingest produces now, written when it starts
```

- Analyses and bundles are JSON compressed with Brotli (quality 11), stored with `Content-Encoding: br` and sent as stored to clients that accept it (the API decompresses for those that don't). On *Kamizelka*, Brotli was 41% (analysis) and 59% (bundle) the size of gzip, and smaller than zstd at level 22; MessagePack was no smaller than JSON once compressed.
- Texts are limited to 200,000 characters per import (about 30,000 words, roughly 10 minutes of analysis), checked by the API and again by ingest.
- Everything about a document is under one prefix, so it can be inspected or deleted in one place. `{analyzer}` and `{lexicon}` are short hashes of the version strings. Stale analyses and bundles are the ones `status.json` doesn't point at; clean them up by that rule, not by age (an old document's current analysis is old too).
- Documents are deduped by content hash: if many users import the same text, it's analyzed once. A user only sees texts they imported themselves or texts in the shared library.
- An analysis or bundle is named by everything it depends on: the blob shape (`SCHEMA`, `BUNDLE_SCHEMA`), the analyser (plugin version, models, Morfeusz, snap policy, Walenty) and, for the bundle, the lexicon. Bump `PLUGIN_VERSION` whenever the analysis output changes, and the shape numbers whenever the JSON shape does. The generated `schema.gen.ts` carries the shape numbers, and the reader refuses a shape it doesn't know.
- The reader fetches the analysis and bundle by those names (`/api/documents/{id}/analysis/{name}`), so what's at a URL never changes and is cached forever, and an analysis and bundle always belong together.
- Migration: when the API lists or opens a ready document whose analysis or bundle name isn't the one in `versions/{lang}.json`, it queues the document again. Until the new analysis is ready, the status keeps the old keys, so the reader shows the old analysis and says it's updating. Ingest reuses an analysis and bundle whose keys already exist, so a document queued twice costs nothing. A document queued or analysing for over 30 minutes has lost its job and is queued again. A storage failure puts the job back on the queue; an analysis that fails is recorded and not retried. Ingest fails a job whose analysis names another analyser than it published, so a mismatch can't loop. Not done yet: backfilling the shared library ahead of time, and several ingest versions running at once during a deploy (each publishes its own versions). Add read-time upgrade functions only if re-analysis gets expensive.

Token shape in the blob:

```
start, end, text, lemma, lemma_id, upos, xpos?, feats, head, deprel, candidates?
```

- `lemma_id` is a stable string key, `{lang}:{lemma}:{upos}` (e.g. `pl:pies:NOUN`). It survives lexicon rebuilds. Homographs share one `lemma_id`; the token's features pick the sense (see Lexicon). Polish participles and gerunds use their verb's id (`położony` → `pl:położyć:VERB`), because to a learner they are forms of the verb.
- `xpos` is the language-specific tag (NKJP for Polish). It's optional, and only plugins read it.
- `head` is the 0-based index of the head token in the sentence, `null` for the root. `feats` is an object.
- `candidates` is present only when there's more than one reading.

Expressions per sentence: `{ "from": 2, "to": 4, "id": "pl:dać sobie radę" }`, matched by lemma sequence. Contiguous only at first.

## User data (D1)

```
user_document(user_id, doc_hash, title, added_at)
known_lemma(user_id, lemma_id, status)                   -- new / learning / known / ignored
lookup(user_id, doc_hash, char_start, char_end, at)
card(id, user_id, lemma_id?, expression_id?, doc_hash, char_start, char_end, fsrs_state, due)
override(user_id, doc_hash, char_start, char_end, lemma_id, feats)
explanation_cache(key, text, model, created_at)          -- key = hash(sentence, char_start, char_end)
```

After a re-analysis, overrides are re-applied by character offset. If a token boundary has moved, the override is flagged rather than guessed.

## Span selection

Selections snap to word boundaries. Computed on the phone from the bundle:
- dependency structure within the span (head, attachments, agreement)
- government (which word is triggering which case)
- matched multi-word expressions

From the backend: a translation of the span in context, and "explain this phrase".

## Cost and tiers

- Static lexicon on a CDN: near zero.
- User data: small, D1.
- Analysis: deduped, rate-limited on the free tier, with a pre-analyzed public-domain library (Wolne Lektury for Polish). Later, on-device analysis.
- LLM: the only real per-use cost. Use a small model, a shared cache and daily quotas.

Free: reader, dictionary, paradigms, structure view, SRS, shared library, a few imports and explanations a day.
Paid (a few EUR/month): unlimited imports and explanations.

## Build order

1. Polish lexicon import from Kaikki. Check coverage on real articles.
2. Polish plugin + ingest. Check lemma, features, the "why" and ambiguity on a real paragraph.
3. Minimal reader with the word sheet.
4. Span selection + structure view.
5. Explain service.
6. Known words + SRS.
7. Auth, quotas, offline caching.

Steps 1 and 2 are the main risk. Validate them before building UI.

## Open questions

- Auth provider
- Name: skolia.com is registered (2026-07, by a domain reseller); skolia.io was free on 2026-11-04

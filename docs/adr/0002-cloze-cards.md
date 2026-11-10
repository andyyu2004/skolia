# 2. Cloze cards

2026-11-10. Accepted.

## Context

A word's cards (0001) teach the lemma: *praca* means "work". They don't teach the form a sentence needs, which is most of what's hard in Polish: *szukam **pracy***, *idę do **pracy***, *myślę o **pracy***. Readers meet those forms in their texts, and the analysis already says why each has its case (`case_reason`, explained by `explainCase`).

## Decision

A cloze card is a sentence from a text with one word blanked out and its lemma as the hint:

> W renomowanej jadłodajni, gdzie właściciele składów bielizny i sklepów winnych schodzą się na ＿＿ (kolacja), mówiono o tym sklepie bardzo wiele.

The back shows the sentence filled in, the word's grammar (accusative · singular · feminine), why it has that case (na + accusative means where to, …), the lemma's meanings, and its paradigm with the form marked.

- The word sheet offers it ("Practise kolację in this sentence") for a learnable word whose form isn't its lemma, signed in, in either reader mode. The user picks the sentences; nothing is made automatically, since the parser's mistakes would make bad cards.
- It's answered by revealing, like the other cards. Typing the form would test it better, but Polish diacritics are slow to type on a phone.
- A lemma can have any number of cloze cards, one per sentence and word. A text's sentence and word (`document_id`, `sentence_start`, `blank_start`) have at most one, and asking again returns it (200, or 201 when made).
- Cloze cards aren't tied to the word's status. Marking *kolacja* known says you know what it means, not that you can pick its case. Their review button is Delete, not Known: it deletes the card and its reviews, for a sentence the parser got wrong or one not worth keeping.
- The card copies the sentence, the word's features and the explanation of its case. The user's entry for the text can be deleted or made private, a curated text that changes is a new document, and the analysis can be redone, so the card doesn't depend on any of them. `document_id` and `sentence_start` still point at the text, for Open the text and to know which words already have a card.

### Storage

`card.kind` gains `cloze`, and a `cloze` table has the sentence:

```
cloze(card_id, document_id, sentence, sentence_start, blank_start, blank_end, feats, why)
```

`blank_start` and `blank_end` are offsets in `sentence`, as the analysis gives them (JavaScript string indices); `sentence_start` is the sentence's offset in the text.

`card` had `UNIQUE (lemma_id, kind)` and a foreign key to `word`, so migration 4 rebuilds it: a partial unique index (`card_word`, `WHERE kind != 'cloze'`) keeps a word to one card of each of its kinds, and the foreign key goes. `setWord` only changes its word's own cards. SQLite can't drop a constraint in place, and a Durable Object can't turn `foreign_keys` off, so `review`'s rows are set aside in a table while `card` is rebuilt. `PRAGMA defer_foreign_keys` isn't enough: dropping `card` counts each review as a violation, and the new table taking its name doesn't uncount them, so the commit fails.

### Routes

```
POST   /api/me/clozes                 { lemmaId, documentId, sentence, sentenceStart, blankStart, blankEnd, feats, why }
GET    /api/me/clozes?documentId=     the text's cloze cards: { cardId, start }, start in the text
DELETE /api/me/clozes/:cardId         a cloze card and its reviews
```

The due list's cards carry `cloze`, null for a word's cards.

## Open

- Cards keyed on the pattern rather than the sentence (*szukać* + genitive), each review showing another sentence from the user's texts with it.
- A translation of the sentence, from an LLM, on the back.

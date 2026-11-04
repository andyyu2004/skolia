# Analyser evaluation

Scored on UD Polish PDB (current master, identical to UD 2.18) with the official CoNLL 2018 evaluator, via `scripts/eval_ud.py`. The input is the raw text of each gold sentence, one sentence per paragraph, so tokenization and sentence splitting are scored too. Defaults were chosen on dev; the numbers below are test (2215 sentences, 34k words). F1, %.

## Test results

| Model | Snap | UPOS | UFeats | AllTags | Lemmas | UAS | LAS | Parse time |
|---|---|---|---|---|---|---|---|---|
| combo | upos (default) | 99.27 | 97.43 | 96.76 | 98.91 | 96.28 | 94.94 | 105 s |
| combo | none | 99.27 | 96.89 | 96.18 | 98.11 | 96.28 | 94.94 | |
| stanza-accurate | upos | 98.96 | 96.58 | 95.93 | 98.46 | 96.35 | 95.01 | 74 s |
| stanza-accurate | none | 98.96 | 96.36 | 95.67 | 97.57 | 96.35 | 95.01 | |
| stanza | upos | 98.56 | 95.47 | 94.56 | 98.21 | 94.17 | 92.39 | 33 s |
| stanza | none | 98.56 | 94.77 | 93.81 | 97.19 | 94.17 | 92.39 | |

Not integrated, scored on the same test text by their own pipelines (no snapping):

| Model | UPOS | UFeats | Lemmas | LAS | Why not |
|---|---|---|---|---|---|
| UDPipe 2 (`polish-pdb-ud-2.17-251125`, LINDAT API) | 98.97 | 96.09 | 98.29 | 91.13 | behind combo; tried via the public web service only |
| Trankit large (UD 2.5, 2021) | 97.38 | 95.93 | 96.67 | 90.67 | behind on everything; splits too many tokens (precision 98.81, recall 99.36) |

Times are CPU on an Apple M-series laptop for the whole test set.

## What the numbers say

- The default (combo + `upos` snap) halves the feature error rate of the original setup (stanza, no snap): UFeats error 5.2% → 2.6%, lemma error 2.8% → 1.1%, LAS error 7.6% → 5.1%.
- Snapping to the dictionary (`reconcile.py`) helps every model on features and lemmas and by design never changes UPOS or the tree. On combo test it turned 451 wrong words right and 23 right words wrong (counted over sentences tokenized like the gold).
- stanza-accurate parses about as well as combo (LAS 95.01 vs 94.94) but tags worse.
- Voting among the three models (tags and heads by majority) didn't beat combo + snap on dev, so it was dropped.

## Caveats

- UD 2.18 re-annotated some relations (e.g. `obl:cmpr` → `advcl:cmp`, many `acl` → `amod`). Against r2.17 gold, combo gets LAS 93.06 and stanza 90.67; UDPipe, trained on 2.17, gets 92.94. combo stays ahead either way.
- All models here are trained on PDB train, so PDB test is in-domain. Expect lower scores on other genres.
- Real text arrives without sentence boundaries marked by paragraphs; segmentation errors will cost a little more than here.

## Lexicon coverage

Share of word tokens (not punctuation, symbols or X) whose entry has at least one meaning, via `scripts/eval_lexicon.py`, lexicon from Kaikki's extract of 2026-10-30. Two texts analysed with the default model:

| Text | Words | Exact | Other part of speech | Lowercased | No meaning |
|---|---|---|---|---|---|
| Prus, *Kamizelka* (1882 short story, Wolne Lektury) | 2798 | 97.0% | 1.6% | 0.1% | 1.3% |
| Wikipedia *Kraków*, intro + history | 5009 | 86.3% | 0.8% | 1.3% | 11.6% |

Of the Kraków misses, 280 of 581 are numbers in digits or Roman numerals (tagged ADJ as ordinals: *w 1918 roku*), which need no meaning. The rest: place names (Rudawa, Prądnik), rare derived adjectives (likwidacyjny), fixed phrases COMBO joins into one lemma (między_innymi, na_przykład) and a few wrong lemmas (stopień_Celsju). In *Kamizelka* they are rare words and the dialect spellings in a character's speech (kamyzelka, wjatr).

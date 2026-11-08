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

## English

UD English EWT (master, downloaded 2026-11-06), test: 2077 sentences, 25k words, scored the same way. English has no candidate readings, so no snapping.

| Model | UPOS | UFeats | AllTags | Lemmas | UAS | LAS | Parse time |
|---|---|---|---|---|---|---|---|
| stanza-accurate (default) | 97.08 | 96.59 | 95.09 | 96.75 | 94.01 | 92.22 | 137 s |
| stanza | 96.01 | 95.85 | 93.69 | 96.39 | 90.92 | 88.88 | 23 s |

stanza-accurate is ahead on every column, most on the tree (LAS error 11.1% → 7.8%), at about 6 times the parse time. Stanza's English models are trained on EWT train among other treebanks, so this is in-domain too.

## French

UD French GSD (master, downloaded 2026-11-08), test: 416 sentences, 10k words, through the French plugin with `scripts/eval_ud.py`. No candidate readings, so no snapping. The numbers are those in [Choosing the next language](#choosing-the-next-language): stanza-accurate (default) UPOS 98.26, UFeats 97.88, Lemmas 98.49, LAS 93.88, in 42 s.

On the same text analysed and bundled with the lexicon (Kaikki extract of 2026-11-08), the word sheet would mark the token's own form in its table for 825 of 827 verbs, 361 of 361 auxiliaries, 1661 of 1681 nouns and 556 of 565 adjectives that have one. The misses read are parser errors (*bougeront* as first person), capitals without their accent (*Eglise*) and abbreviations (*M.*).

Memory, in the French image (Docker, amd64 emulated), loading the ingest pipeline and analysing and bundling the first 19,948 characters of the test text (the import limit is 20,000; 4011 tokens): 1.08 GiB once loaded, and a peak of 5.74 GiB with Stanza's batches of 5000 words, so the whole text goes through CamemBERT at once. In batches of 1000 words for the tagger and the parser the peak is 3.50 GiB, and the test set's output is byte for byte the same, so the French parser uses 1000.

## Lexicon coverage

Share of word tokens (not punctuation, symbols or X) whose entry has at least one meaning, via `scripts/eval_lexicon.py`, lexicon from Kaikki's extract of 2026-10-30. Two texts analysed with the default model:

| Text | Words | Exact | Other part of speech | Lowercased | No meaning |
|---|---|---|---|---|---|
| Prus, *Kamizelka* (1882 short story, Wolne Lektury) | 2798 | 97.0% | 1.6% | 0.1% | 1.3% |
| Wikipedia *Kraków*, intro + history | 5009 | 86.3% | 0.8% | 1.3% | 11.6% |

Of the Kraków misses, 280 of 581 are numbers in digits or Roman numerals (tagged ADJ as ordinals: *w 1918 roku*), which need no meaning. The rest: place names (Rudawa, Prądnik), rare derived adjectives (likwidacyjny), fixed phrases COMBO joins into one lemma (między_innymi, na_przykład) and a few wrong lemmas (stopień_Celsju). In *Kamizelka* they are rare words and the dialect spellings in a character's speech (kamyzelka, wjatr).

French, the UD French GSD test text (8786 word tokens) with the French extract of 2026-11-08: exact 85.6%, other part of speech 7.9%, lowercased 0.5%, no meaning 5.9%. Most misses are numbers and names (2010, New York, Ahmed); a few are function words Wiktionary files under another part of speech or as a form of another word (eux, quelques).

## Case reasons

`scripts/pl/eval_case_reasons.py` on PDB dev (combo, snap upos, Walenty 2018-07-26): 14,090 of 15,589 words with a case (90.4%) get a reason. By rule: agreement 24.5%, preposition 24.4%, subject 12.8%, structural object 7.6%, possessive 4.9%, coordination 4.6%, noun complement 4.2%, verb's lexical case 3.0%, verbal noun 1.7%, negation, numeral, predicate, instrumental, vocative and partitive under 1% each. The most common words without one: sentence roots in the nominative (headlines, list items) and numerals' own case. This counts coverage, not correctness; the 40-word samples the script prints read right, with one misleading reason found and fixed (multi-word prepositions now name the whole preposition: *w stosunku do*).

### Case correction from valency

When the governing verb rules the parser's case out and the form also has the required case, the case is switched (`Szukam psa`: COMBO says accusative, `szukać` takes only the genitive, and `psa` is both). It's on, in its narrow form; the parser's reading is kept and the reader says what changed. Words changed, counted against the gold case (`scripts/pl/eval_case_correction.py`):

| Version | Dev | Test | Train |
|---|---|---|---|
| any verb, including those with a structural object | 4 fixed, 0 broken | 2 fixed, 7 broken | 1 fixed, 37 broken |
| only verbs whose bare complements are all lexical | 1 fixed, 0 broken | 0 fixed, 0 broken | 0 fixed, 6 broken |
| **lexical only, and not where się may be impersonal (current)** | **1 fixed, 0 broken** | **0, 0** | **0 fixed, 3 broken** |

The broad version broke correct subjects the parser had labelled as objects (inverted word order), so it's not used. Reading the narrow version's six train "breaks" by hand: two are treebank errors, where the verb takes the genitive and the look-alike form is annotated accusative (`Urzędnicy boją się go`, `mama oczekiwała mnie`), so the correction was right; one was a real error, an impersonal się taken for the reflexive verb (`Takie przemiany nazywa się skojarzonymi`), which the się check now excludes; two are unclear. So on the cases that can be judged, the current version is 3 right, 0 wrong. The narrow version was designed after seeing test and train errors, so neither is a clean estimate; it fires rarely (once on dev) because COMBO is usually right.

## Choosing the next language

French, German and Russian scored before any of them had a plugin, to pick the next one (2026-11-08). The parser columns are Stanza 1.15 run directly (its own labels, no skolia plugin), on the raw text of each UD test set from master, scored with the CoNLL 2018 evaluator as above. The same run on English EWT gives the numbers in the English table, but for stanza-accurate's Lemmas (96.76 against 96.75). Russian has no multi-word token model, so it ran without `mwt`.

The last column is the share of gold words (not punctuation, symbols or X) whose gold lemma has a Kaikki entry with a meaning, by the same part of speech, another one or lowercased (Kaikki extracts of 2026-11-08; English's of 2026-10-30).

| Language (treebank) | Model | UPOS | UFeats | AllTags | Lemmas | UAS | LAS | Parse time | No meaning |
|---|---|---|---|---|---|---|---|---|---|
| English (EWT, 2077 sentences) | stanza-accurate | 97.08 | 96.59 | 95.09 | 96.76 | 94.01 | 92.22 | 129 s | 3.5% |
| French (GSD, 416) | stanza-accurate | 98.26 | 97.88 | 97.39 | 98.49 | 95.55 | 93.88 | 41 s | 5.5% |
| | stanza | 97.89 | 97.52 | 96.99 | 98.24 | 93.34 | 91.30 | 7 s | |
| Russian (SynTagRus, 8800) | stanza-accurate | 98.36 | 96.59 | 96.22 | 97.98 | 94.59 | 93.14 | 261 s | 5.4% |
| | stanza | 98.14 | 95.61 | 95.20 | 97.76 | 92.98 | 91.19 | 114 s | |
| German (GSD, 977) | stanza-accurate | 97.03 | 91.89 | 89.66 | 98.00 | 89.75 | 86.94 | 28 s | 9.0% |
| | stanza | 96.67 | 90.65 | 88.24 | 98.11 | 87.47 | 84.00 | 12 s | |

French is next: ahead on features and lemmas, which pick the table cell and the dictionary entry. It's close to Russian, and on the fewest sentences. Russian's features are harder (case and animacy on every noun) and it scores about as COMBO does on Polish without snapping. German is behind on features.

- Each language is scored on its own treebank, all in-domain (Stanza's French and German models are trained on several treebanks including GSD, Russian's on SynTagRus), so the gaps are partly between treebanks.
- Most Russian misses are lemmas spelled with е where Wiktionary has ё (тяжелый, ученый); folding ё would recover them. Most German misses are compounds (Wirtschaftsgipfel) and lemmas spelled differently from Wiktionary's headwords (letzt). Numbers and names are common misses in all four.
- Inflection tables: of the gold verbs found, 99.8% of French, 99.8% of German and 97.3% of Russian entries have forms (median 45, 53 and 25 distinct forms).

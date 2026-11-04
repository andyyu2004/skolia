"""The lexicon: meanings, relations and paradigms for each lemma_id the analyser produces.

Built offline from Kaikki (Wiktionary) into one SQLite file per language (build.py).
Each imported document gets a bundle with just its own lemmas (bundle.py), so taps on
the phone are local lookups. Paradigms come from Morfeusz when the bundle is made.
"""

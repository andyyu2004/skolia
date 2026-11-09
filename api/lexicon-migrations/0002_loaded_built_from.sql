-- The Nix output the loaded version came from (with +sampleN on previews), set once the old
-- versions' rows are deleted. When analysis#cards-lexicon-{lang} evaluates to the same path,
-- just load-lexicon skips building it (infra/load-lexicon.py --built-from).
ALTER TABLE loaded ADD COLUMN built_from TEXT;

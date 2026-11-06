import type { Language } from "../types.ts";
import { explainCase } from "./cases.ts";
import { argumentsOf, frames } from "./frames.ts";
import { layout, mergeLabels } from "./paradigm.ts";

// NKJP's class for the person ending split off a fused word (dałem -> dał + em)
const PERSON_ENDING = "aglt";

export const polish: Language = {
  name: "Polish",
  paradigm: layout,
  mergeLabels,
  explainCase: (tokens, index) => explainCase(tokens, index),
  uses: (entry, tokens, index) =>
    frames(entry.frames, argumentsOf(tokens, index)).map((frame) => ({
      head: frame.reflexive ? `${entry.lemma} się` : entry.lemma,
      pattern: frame.pattern,
      tags: frame.tags,
      idiom: frame.idiom,
      here: frame.here,
    })),
  partOfWord: (token) => ((token.xpos ?? "").startsWith(PERSON_ENDING) ? "person ending" : null),
  grammarTags: new Set([
    "masculine",
    "feminine",
    "neuter",
    "animal-not-person",
    "person",
    "personal",
    "inanimate",
    "animate",
    "perfective",
    "imperfective",
  ]),
  relationLabel: (relation) =>
    relation.type === "aspect-partner"
      ? `${relation.note ?? "aspect"} partner`
      : `from (${relation.note ?? "derived"})`,
};

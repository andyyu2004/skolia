import type { Language } from "../types.ts";
import { layout } from "./paradigm.ts";

export const french: Language = {
  paradigm: layout,
  cases: false,
  // The analysis gives no case reasons and the lexicon no frames for French
  explainCase: () => null,
  uses: () => [],
  partOfWord: () => null,
  // A noun's gender is on the grammar line; its senses are selected by it (livre)
  grammarTags: new Set(["masculine", "feminine"]),
};

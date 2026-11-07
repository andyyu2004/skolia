import type { Language } from "../types.ts";
import { layout } from "./paradigm.ts";

export const english: Language = {
  paradigm: layout,
  // The analysis gives no case reasons and the lexicon no frames for English
  explainCase: () => null,
  uses: () => [],
  partOfWord: () => null,
  grammarTags: new Set(),
};

// "Why this case?": the analysis's case_reason in plain English.
import type { Case, Token } from "@skolia/shared/schema";

export const CASE_NAME: Record<Case, string> = {
  Nom: "nominative",
  Gen: "genitive",
  Dat: "dative",
  Acc: "accusative",
  Ins: "instrumental",
  Loc: "locative",
  Voc: "vocative",
};

// Prepositions that take two cases, with what each means
const TWO_CASE: Partial<Record<string, Partial<Record<Case, string>>>> = {
  w: { Loc: "where (w domu)", Acc: "where to, or into (w dom)" },
  na: { Loc: "where, on (na stole)", Acc: "where to, onto, or for (na stół, na tydzień)" },
  o: { Loc: "about (o psie)", Acc: "for, or against (prosić o pomoc, oprzeć o ścianę)" },
  po: { Loc: "after, or along (po obiedzie, po mieście)", Acc: "to fetch, or up to (po chleb, po kolana)" },
  za: { Ins: "behind, where (za domem)", Acc: "behind, where to; or for (za dom, dziękuję za pomoc)" },
  pod: { Ins: "under, where (pod stołem)", Acc: "under, where to (pod stół)" },
  nad: { Ins: "above, where (nad stołem)", Acc: "above, where to (nad morze)" },
  przed: { Ins: "in front of, or before (przed domem, przed obiadem)", Acc: "in front of, where to (przed dom)" },
  między: { Ins: "between, where (między domami)", Acc: "between, where to (między domy)" },
};

/** Agreement and coordination point at another word; follow that far, no further. */
const MAX_CHAIN = 1;

export interface CaseExplanation {
  text: string;
  /** Index in the sentence of the word that causes the case, to mark in the text. */
  trigger: number | null;
}

export function explainCase(tokens: Token[], index: number, depth = 0): CaseExplanation | null {
  const token = tokens[index];
  const reason = token?.case_reason;
  const caseValue = token?.feats.Case;
  if (!token || !reason || !caseValue) return null;
  const name = CASE_NAME[caseValue];
  const trigger = reason.trigger ?? null;
  const other = trigger === null ? undefined : tokens[trigger];
  const word = other?.text ?? "";
  const governor = reason.governor ?? other?.lemma ?? word;
  const chained = (): string => {
    if (trigger === null || depth >= MAX_CHAIN) return "";
    const next = explainCase(tokens, trigger, depth + 1);
    return next ? ` ${word}: ${next.text}` : "";
  };
  const text = ((): string => {
    switch (reason.rule) {
      case "vocative":
        return "Someone is being addressed.";
      case "preposition": {
        const meaning = TWO_CASE[governor]?.[caseValue];
        return meaning
          ? `${governor} + ${name} means ${meaning}.`
          : `${governor} takes the ${name}.`;
      }
      case "agreement":
        return `It agrees with ${word}.${chained()}`;
      case "coordination":
        return `It's listed with ${word}, so it takes the same case.${chained()}`;
      case "numeral":
        return `After ${word}, a noun goes in the genitive (numbers from five, and words like wiele, kilka, dużo).`;
      case "verb":
        return `${governor} governs the ${name} for its object.`;
      case "negation":
        return `${governor} takes the accusative (its object), but nie turns it into the genitive.`;
      case "structural":
        return `It's the object of ${governor}, and objects are accusative.`;
      case "partitive":
        return `${governor} takes the genitive for "some of" and the accusative for "all of".`;
      case "subject":
        return `It's the subject of ${word}, and subjects are nominative.`;
      case "predicate":
        return `After ${governor}, a noun that says what the subject is goes in the instrumental (jest lekarzem).`;
      case "possessive":
        return `It belongs to ${word}: "of" is the genitive (dom brata).`;
      case "noun-complement":
        return `It completes the noun ${word}, and a noun's complement is genitive.`;
      case "verbal-noun":
        return `${word} is a noun made from ${governor}, and its object is genitive (czytać książkę → czytanie książki).`;
      case "instrumental":
        return "Instrumental without a preposition: by means of, or when (pisać długopisem, wieczorem).";
    }
  })();
  return { text, trigger };
}

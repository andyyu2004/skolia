import * as m0001 from "./0001_known_lemma.ts";
import * as m0002 from "./0002_flashcards.ts";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "known_lemma", ...m0001 },
  { version: 2, name: "flashcards", ...m0002 },
];

import * as m0001 from "./0001_known_lemma.ts";
import * as m0002 from "./0002_flashcards.ts";
import * as m0003 from "./0003_reading_position.ts";
import * as m0004 from "./0004_cloze.ts";
import * as m0005 from "./0005_card_groups.ts";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "known_lemma", ...m0001 },
  { version: 2, name: "flashcards", ...m0002 },
  { version: 3, name: "reading_position", ...m0003 },
  { version: 4, name: "cloze", ...m0004 },
  { version: 5, name: "card_groups", ...m0005 },
];

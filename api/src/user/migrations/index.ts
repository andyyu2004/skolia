import * as m0001 from "./0001_known_lemma.ts";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: "known_lemma", ...m0001 }];

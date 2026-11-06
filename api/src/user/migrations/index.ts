import * as m0001 from "./0001_known_lemma.ts";

export interface Migration {
  up: string;
  down: string;
}

export const MIGRATIONS: readonly Migration[] = [m0001];

import { LANGS, type Lang } from "@skolia/shared/api";
import { polish } from "./pl/index.ts";
import type { Language } from "./types.ts";

export const LANGUAGES: Record<Lang, Language> = {
  pl: polish,
};

export function isLang(code: string): code is Lang {
  return LANGS.some((l) => l === code);
}

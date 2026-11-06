import type { Lang } from "@skolia/shared/api";
import { english } from "./en/index.ts";
import { polish } from "./pl/index.ts";
import type { Language } from "./types.ts";

export const LANGUAGES: Record<Lang, Language> = {
  en: english,
  pl: polish,
};

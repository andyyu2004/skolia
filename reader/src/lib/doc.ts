// The text split into what the reader renders: words to tap and the gaps between them.
import type { Blob, Token } from "@skolia/shared/schema";

export interface WordRef {
  sentence: number;
  index: number;
  token: Token;
}

export type Piece =
  | { kind: "gap"; text: string }
  | {
      kind: "word";
      /** Index among word pieces, for keyboard navigation. */
      id: number;
      text: string;
      /** Usually one; a fused word (zrobiłem = zrobił + em) has several. */
      words: WordRef[];
      punct: boolean;
    };

export interface Layout {
  pieces: Piece[];
  /** Word piece id for each "sentence:token" pair, to find a token's head. */
  pieceOf: Map<string, number>;
  /** Word pieces by id. */
  words: Extract<Piece, { kind: "word" }>[];
}

export function tokenKey(sentence: number, index: number): string {
  return `${sentence}:${index}`;
}

export function layout(text: string, analysis: Blob): Layout {
  const pieces: Piece[] = [];
  const words: Layout["words"] = [];
  const pieceOf = new Map<string, number>();
  let cursor = 0;
  analysis.sentences.forEach((sentence, s) => {
    let index = 0;
    while (index < sentence.tokens.length) {
      const first = sentence.tokens[index];
      if (!first) break;
      const group: WordRef[] = [];
      // Words of a fused token share its character span
      while (index < sentence.tokens.length) {
        const token = sentence.tokens[index];
        if (!token || token.start !== first.start || token.end !== first.end) break;
        group.push({ sentence: s, index, token });
        index += 1;
      }
      if (first.start > cursor) pieces.push({ kind: "gap", text: text.slice(cursor, first.start) });
      const piece: Layout["words"][number] = {
        kind: "word",
        id: words.length,
        text: text.slice(first.start, first.end),
        words: group,
        punct: group.every((w) => w.token.upos === "PUNCT" || w.token.upos === "SYM"),
      };
      for (const w of group) pieceOf.set(tokenKey(w.sentence, w.index), piece.id);
      pieces.push(piece);
      words.push(piece);
      cursor = Math.max(cursor, first.end);
    }
  });
  if (cursor < text.length) pieces.push({ kind: "gap", text: text.slice(cursor) });
  return { pieces, pieceOf, words };
}

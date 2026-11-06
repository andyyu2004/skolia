"""COMBO backend (IPI PAN / CLARIN-PL): https://gitlab.clarin-pl.eu/syntactic-tools/combo

An XLM-RoBERTa-based tagger and parser with its own segmenter (combo-seg). Code GPL-3.0,
models CC BY-NC-SA 4.0 (trained on PDB).
"""

from __future__ import annotations

import contextlib
import importlib
import sys
from collections.abc import Generator
from importlib.metadata import version
from typing import TYPE_CHECKING, cast
from unittest import mock

from .. import ud
from ..parsed import ParsedSentence, ParsedToken, ParsedWord, align

# Importing combo loads torch, so it waits until a ComboParser is built
if TYPE_CHECKING:
    from combo import COMBO, Token  # pyright: ignore[reportMissingTypeStubs]
    from transformers import PreTrainedModel


ROOT_HEAD = 0
UNSET = "_"

# The lemmatizer crashes with larger batches (tensor size mismatch in combo 4.0.14)
BATCH_SIZE = 1


class ComboParser:
    def __init__(self, model: str, device: str = "cpu") -> None:
        from combo import COMBO  # pyright: ignore[reportMissingTypeStubs]

        self._model = model
        # COMBO prints progress to stdout, which would corrupt the analyser's output
        with contextlib.redirect_stdout(sys.stderr), _without_base_weights():
            self._nlp: COMBO = COMBO.from_pretrained(model, device=device, batch_size=BATCH_SIZE)

    @property
    def name(self) -> str:
        return f"combo-{version('combo-nlp')}:{self._model.split('/')[-1]}"

    def __call__(self, text: str) -> list[ParsedSentence]:
        with contextlib.redirect_stdout(sys.stderr):
            doc = self._nlp(text)
        sentences: list[ParsedSentence] = []
        cursor = 0
        for sentence in doc.sentences:
            groups = _group(sentence.tokens)
            surfaces = [surface for surface, _ in groups]
            offsets = list(align(text, surfaces, cursor))
            if offsets:
                cursor = offsets[-1][1]
            tokens = tuple(
                ParsedToken(surface, start, end, tuple(_word(w) for w in words))
                for (surface, words), (start, end) in zip(groups, offsets, strict=True)
            )
            sentences.append(ParsedSentence(tokens))
        return sentences


class _EncoderFromConfig:
    """Stands in for transformers.AutoModel while COMBO loads."""

    @staticmethod
    def from_pretrained(name: str) -> PreTrainedModel:
        from transformers import AutoConfig, AutoModel
        from transformers.initialization import no_init_weights

        config = AutoConfig.from_pretrained(name)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        # The checkpoint overwrites every weight, so random initialisation is wasted time
        with no_init_weights():
            return cast("PreTrainedModel", AutoModel.from_config(config))  # pyright: ignore[reportUnknownMemberType]


@contextlib.contextmanager
def _without_base_weights() -> Generator[None]:
    """Build COMBO's encoders from the base model's config, without its weights.

    The parser and the segmenter each load their encoder with
    AutoModel.from_pretrained(base model), then replace every encoder weight from
    their own checkpoint. So the base model's 1.1 GB of weights are read and thrown
    away, and the image needn't contain them: only its config and tokenizer.
    """
    parser = importlib.import_module("combo.model.parser")
    segmenter = importlib.import_module("combo_seg.model")
    with (
        mock.patch.object(parser, "AutoModel", _EncoderFromConfig),
        mock.patch.object(segmenter, "AutoModel", _EncoderFromConfig),
    ):
        yield


def _group(words: list[Token]) -> list[tuple[str, list[Token]]]:
    """Words back into surface tokens: a fused token's words share its multiword span."""
    groups: list[tuple[str, list[Token]]] = []
    index = 0
    while index < len(words):
        multiword = words[index].multiword
        if multiword is None:
            groups.append((words[index].form, [words[index]]))
            index += 1
        else:
            form, (start, end) = multiword
            span = end - start + 1
            groups.append((form, words[index : index + span]))
            index += span
    return groups


def _word(word: Token) -> ParsedWord:
    head = word.head
    return ParsedWord(
        text=word.form,
        lemma=_present(word.lemma),
        upos=ud.parse_upos(_present(word.upos)),
        # The PDB model's XPOS tags are NKJP tags (Polish National Corpus), e.g. praet:sg:m1:perf
        xpos=_present(word.xpos),
        feats=ud.check_feats(word.feats),
        head=None if head in (None, ROOT_HEAD) else head - 1,
        deprel=ud.parse_deprel(_present(word.deprel)),
    )


def _present(value: str) -> str | None:
    """COMBO writes a missing value as CoNLL-U's "_"."""
    return None if value == UNSET else value

"""Pronunciations from Wiktionary's sounds: phonemic IPA, each transcription once; and
recordings, each file once."""

from collections.abc import Callable, Iterable

from .kaikki import KaikkiSound
from .schema import Accent, Pronunciation, Recording

type Accents = Callable[[KaikkiSound], list[Accent] | None]
"""The accents a sound is for: empty for all of them, None to leave the sound out."""


def pronunciations(sounds: Iterable[KaikkiSound], accents: Accents) -> list[Pronunciation]:
    found: list[Pronunciation] = []
    for sound in sounds:
        ipa = sound.get("ipa", "")
        # Phonemic only, between slashes. Phonetic ones, in brackets, add detail a learner
        # doesn't need ([ˈlɪi̯d] beside /ˈliːd/) and are mostly regional variants.
        if not (len(ipa) > 2 and ipa.startswith("/") and ipa.endswith("/")):
            continue
        sound_accents = accents(sound)
        if sound_accents is None:
            continue
        found = merge(found, [_pronunciation(ipa, sound_accents)])
    return found


def merge(ours: list[Pronunciation], theirs: list[Pronunciation]) -> list[Pronunciation]:
    """One pronunciation per transcription, for the union of the accents; for every
    accent if either is."""
    merged = [p.copy() for p in ours]
    for new in theirs:
        same = next((p for p in merged if p["ipa"] == new["ipa"]), None)
        if same is None:
            merged.append(new.copy())
            continue
        mine, other = same.get("accents"), new.get("accents")
        if mine is None or other is None:
            same.pop("accents", None)
        else:
            same["accents"] = mine + [a for a in other if a not in mine]
    return merged


def recordings(sounds: Iterable[KaikkiSound]) -> list[Recording]:
    found: list[Recording] = []
    for sound in sounds:
        audio, mp3_url = sound.get("audio"), sound.get("mp3_url")
        if not (audio and mp3_url):
            continue
        recording: Recording = {"audio": audio, "mp3_url": mp3_url}
        if tags := sound.get("tags"):
            recording["tags"] = tags
        found = merge_recordings(found, [recording])
    return found


def merge_recordings(ours: list[Recording], theirs: list[Recording]) -> list[Recording]:
    """Each file once: Wiktionary pages often share one between parts of speech."""
    seen = {r["audio"] for r in ours}
    return ours + [r for r in theirs if r["audio"] not in seen]


def _pronunciation(ipa: str, accents: list[Accent]) -> Pronunciation:
    if accents:
        return {"ipa": ipa, "accents": accents}
    return {"ipa": ipa}

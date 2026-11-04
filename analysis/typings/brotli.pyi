MODE_GENERIC: int
MODE_TEXT: int
MODE_FONT: int

def compress(
    string: bytes, mode: int = ..., quality: int = ..., lgwin: int = ..., lgblock: int = ...
) -> bytes:
    """quality 0-11 (11: smallest, slowest)."""
    ...

def decompress(string: bytes) -> bytes: ...

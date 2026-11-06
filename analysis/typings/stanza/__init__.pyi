from enum import Enum

from stanza.models.common.doc import Document

class DownloadMethod(Enum):
    NONE = 1
    REUSE_RESOURCES = 2
    DOWNLOAD_RESOURCES = 3

class Pipeline:
    def __init__(
        self,
        lang: str = ...,
        *,
        package: str = ...,
        processors: str = ...,
        logging_level: str | None = ...,
        download_method: DownloadMethod | None = ...,
    ) -> None: ...
    def __call__(self, doc: str) -> Document: ...

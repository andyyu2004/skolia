from stanza.models.common.doc import Document

class Pipeline:
    def __init__(
        self,
        lang: str = ...,
        *,
        processors: str = ...,
        logging_level: str | None = ...,
    ) -> None: ...
    def __call__(self, doc: str) -> Document: ...

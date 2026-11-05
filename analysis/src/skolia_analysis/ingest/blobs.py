"""Blob storage: S3-compatible (RustFS locally, R2 in production) or a folder (tests)."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from types_boto3_s3 import S3Client

BROTLI = "br"
"""Content-Encoding of the analysis and bundle. Measured on Kamizelka against gzip -9
and zstd -22: Brotli -11 was 41% (analysis) and 60% (bundle) the size of gzip, and
11-17% smaller than zstd. Browsers decode it natively over HTTPS."""


class BlobError(Exception):
    """Storage failed (after the client's own retries): try the job again later."""


class Blobs(Protocol):
    """Every method raises BlobError when storage fails; a missing key isn't a failure."""

    def get(self, key: str) -> bytes | None:
        """The object's stored bytes (still compressed if it was put with an encoding)."""
        ...

    def exists(self, key: str) -> bool: ...

    def put(
        self, key: str, data: bytes, content_type: str, encoding: str | None = None
    ) -> None: ...


class S3Blobs:
    def __init__(self, bucket: str, endpoint: str | None = None) -> None:
        """Credentials come from the usual AWS environment variables
        (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY); R2 and MinIO need endpoint."""
        import boto3

        self._bucket = bucket
        self._s3: S3Client = boto3.client("s3", endpoint_url=endpoint)

    def get(self, key: str) -> bytes | None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            response = self._s3.get_object(Bucket=self._bucket, Key=key)
            return response["Body"].read()
        except self._s3.exceptions.NoSuchKey:
            return None
        except (BotoCoreError, ClientError) as error:
            raise BlobError(f"get {key}: {error}") from error

    def exists(self, key: str) -> bool:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self._s3.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as error:
            # HEAD has no body, so a missing key comes back as a bare 404
            if error.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
                return False
            raise BlobError(f"head {key}: {error}") from error
        except BotoCoreError as error:
            raise BlobError(f"head {key}: {error}") from error

    def put(self, key: str, data: bytes, content_type: str, encoding: str | None = None) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            if encoding is None:
                self._s3.put_object(
                    Bucket=self._bucket, Key=key, Body=data, ContentType=content_type
                )
            else:
                self._s3.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                    ContentEncoding=encoding,
                )
        except (BotoCoreError, ClientError) as error:
            raise BlobError(f"put {key}: {error}") from error


class DirBlobs:
    """Blobs as files under a folder; keys become relative paths."""

    def __init__(self, root: Path) -> None:
        self._root = root

    def get(self, key: str) -> bytes | None:
        path = self._root / key
        try:
            return path.read_bytes() if path.exists() else None
        except OSError as error:
            raise BlobError(f"get {key}: {error}") from error

    def exists(self, key: str) -> bool:
        return (self._root / key).exists()

    def put(self, key: str, data: bytes, content_type: str, encoding: str | None = None) -> None:
        path = self._root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

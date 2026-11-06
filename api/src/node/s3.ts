// Blobs over the S3 API: RustFS locally. (On Workers, the R2 binding replaces this.)
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { BlobStore, StoredBlob } from "../ports.ts";

export class S3Blobs implements BlobStore {
  private readonly s3: S3Client;
  private readonly bucket: string;

  /** Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. */
  constructor(bucket: string, endpoint: string | undefined) {
    this.bucket = bucket;
    this.s3 = new S3Client(
      endpoint === undefined ? {} : { endpoint, forcePathStyle: true, region: "auto" },
    );
  }

  async get(key: string): Promise<StoredBlob | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return null;
      return {
        body: await response.Body.transformToByteArray(),
        contentType: response.ContentType,
      };
    } catch (error: unknown) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}

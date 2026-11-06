output "d1_database_id" {
  value = cloudflare_d1_database.skolia.id
}

output "queue_id" {
  value = cloudflare_queue.ingest.queue_id
}

output "r2_s3_endpoint" {
  value = "https://${var.account_id}.r2.cloudflarestorage.com"
}

# R2 S3 credentials derive from the token: https://developers.cloudflare.com/r2/api/tokens/
output "ingest_s3_access_key_id" {
  value     = cloudflare_account_token.ingest_r2.id
  sensitive = true
}

output "ingest_s3_secret_access_key" {
  value     = sha256(cloudflare_account_token.ingest_r2.value)
  sensitive = true
}

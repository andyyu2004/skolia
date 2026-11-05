locals {
  bundle = "${path.module}/../api/dist/main.js"
}

data "cloudflare_zone" "skolia" {
  filter = {
    name = "skolia.io"
  }
}

resource "cloudflare_r2_bucket" "blobs" {
  account_id = var.account_id
  name       = "skolia"
}

resource "cloudflare_d1_database" "skolia" {
  account_id = var.account_id
  name       = "skolia"
}

# The consumer is the skolia-ingest Worker; wrangler attaches it.
resource "cloudflare_queue" "ingest" {
  account_id = var.account_id
  queue_name = "skolia-ingest"
}

# Uploading a script deploys it to 100% of traffic, so no separate version/deployment.
resource "cloudflare_workers_script" "skolia" {
  account_id         = var.account_id
  script_name        = "skolia"
  main_module        = "main.js"
  content_file       = local.bundle
  content_sha256     = filesha256(local.bundle)
  compatibility_date = "2026-10-19"

  assets = {
    directory = "${path.module}/../reader/dist"
    config = {
      not_found_handling = "single-page-application"
      run_worker_first   = ["/api/*"]
    }
  }

  bindings = [
    {
      name = "DB"
      type = "d1"
      id   = cloudflare_d1_database.skolia.id
    },
    {
      name        = "BLOBS"
      type        = "r2_bucket"
      bucket_name = cloudflare_r2_bucket.blobs.name
    },
    {
      name       = "INGEST"
      type       = "queue"
      queue_name = cloudflare_queue.ingest.queue_name
    },
  ]
}

resource "cloudflare_workers_custom_domain" "apex" {
  account_id = var.account_id
  zone_id    = data.cloudflare_zone.skolia.id
  hostname   = "skolia.io"
  service    = cloudflare_workers_script.skolia.script_name
}

# The name filter must be URL-encoded; the exact match guards against a partial match.
data "cloudflare_account_api_token_permission_groups" "r2_bucket_item_write" {
  account_id = var.account_id
  name       = "Workers%20R2%20Storage%20Bucket%20Item%20Write"
}

resource "cloudflare_account_token" "ingest_r2" {
  account_id = var.account_id
  name       = "skolia-ingest R2"
  policies = [{
    effect = "allow"
    permission_groups = [{
      id = one([
        for g in data.cloudflare_account_api_token_permission_groups.r2_bucket_item_write.permission_groups :
        g.id if g.name == "Workers R2 Storage Bucket Item Write"
      ])
    }]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.blobs.name}" = "*"
    })
  }]
}

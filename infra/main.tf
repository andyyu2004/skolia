locals {
  bundle = "${path.module}/../api/dist/main.js"
}

data "cloudflare_zone" "skolia" {
  count = var.domain == null ? 0 : 1
  filter = {
    name = var.domain
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
    {
      name = "MAX_IMPORTS_PER_DAY"
      type = "plain_text"
      text = tostring(var.max_imports_per_day)
    },
  ]
}

resource "cloudflare_workers_script_subdomain" "skolia" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.skolia.script_name
  enabled     = true
}

resource "cloudflare_workers_custom_domain" "apex" {
  count      = var.domain == null ? 0 : 1
  account_id = var.account_id
  zone_id    = data.cloudflare_zone.skolia[0].id
  hostname   = var.domain
  service    = cloudflare_workers_script.skolia.script_name
}

# All groups, picked by exact name below (the singular data source returns null here)
data "cloudflare_account_api_token_permission_groups_list" "all" {
  account_id = var.account_id
}

resource "cloudflare_account_token" "ingest_r2" {
  account_id = var.account_id
  name       = "skolia-ingest R2"
  policies = [{
    effect = "allow"
    permission_groups = [{
      id = one([
        for g in data.cloudflare_account_api_token_permission_groups_list.all.result :
        g.id if g.name == "Workers R2 Storage Bucket Item Write"
      ])
    }]
    resources = jsonencode({
      "com.cloudflare.edge.r2.bucket.${var.account_id}_default_${cloudflare_r2_bucket.blobs.name}" = "*"
    })
  }]
}

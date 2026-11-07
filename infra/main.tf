resource "cloudflare_r2_bucket" "blobs" {
  account_id = var.account_id
  name       = "skolia${local.suffix}"
}

resource "cloudflare_d1_database" "skolia" {
  account_id = var.account_id
  name       = "skolia${local.suffix}"
}

# The lexicon for flashcards (infra/load-lexicon.py loads it). Previews bind staging's.
resource "cloudflare_d1_database" "lexicon" {
  count      = startswith(var.env, "pr-") ? 0 : 1
  account_id = var.account_id
  name       = "skolia-lexicon${local.suffix}"
}

# The consumer is the ingest Worker (skolia-ingest[-env]); wrangler attaches it.
resource "cloudflare_queue" "ingest" {
  account_id = var.account_id
  queue_name = "skolia-ingest${local.suffix}"
}

# The skolia Worker, its workers.dev subdomain and its custom domain are deployed by
# wrangler from api/wrangler.jsonc, which also applies its Durable Object migrations.
# Terraform made them before; these let it forget them without deleting them.
removed {
  from = cloudflare_workers_script.skolia
  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_workers_script_subdomain.skolia
  lifecycle {
    destroy = false
  }
}

removed {
  from = cloudflare_workers_custom_domain.apex
  lifecycle {
    destroy = false
  }
}

# All groups, picked by exact name below (the singular data source returns null here)
data "cloudflare_account_api_token_permission_groups_list" "all" {
  account_id = var.account_id
}

resource "cloudflare_account_token" "ingest_r2" {
  account_id = var.account_id
  name       = "skolia-ingest${local.suffix} R2"
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

# Signs the skolia Worker's sessions and encrypts its OAuth tokens. just deploy-web passes
# it as a Worker secret.
resource "random_password" "better_auth_secret" {
  length  = 48
  special = false
}

resource "cloudflare_r2_bucket" "tf_providers" {
  count      = var.env == "production" ? 1 : 0
  account_id = var.account_id
  name       = "skolia-tf-providers"
}

resource "cloudflare_r2_managed_domain" "tf_providers" {
  count       = var.env == "production" ? 1 : 0
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.tf_providers[0].name
  enabled     = true
}

output "tf_providers_mirror_url" {
  value = one([for d in cloudflare_r2_managed_domain.tf_providers : "https://${d.domain}/"])
}

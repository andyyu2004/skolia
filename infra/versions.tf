terraform {
  required_version = ">= 1.11"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
  }

  # R2 via the S3 backend. key (one state per environment), endpoints.s3 and credentials
  # are passed at init by tf.sh.
  backend "s3" {
    bucket                      = "skolia-tfstate"
    region                      = "auto"
    use_path_style              = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "cloudflare" {}

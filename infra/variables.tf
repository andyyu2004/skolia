variable "account_id" {
  type = string
}

variable "env" {
  type        = string
  description = "staging or production. Production keeps the original unsuffixed names."
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production."
  }
}

locals {
  # skolia, skolia-staging; skolia-ingest, skolia-ingest-staging. Wrangler names the
  # ingest Worker the same way for its "staging" environment.
  suffix = var.env == "production" ? "" : "-${var.env}"
}

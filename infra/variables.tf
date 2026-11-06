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

variable "max_imports_per_day" {
  type        = number
  default     = 50
  description = "New texts the API accepts per UTC day, across all users. Analysis time is the main cost."
}

variable "zone" {
  type        = string
  default     = null
  description = "A zone on this account (e.g. skolia.io). Production is served at its apex, another environment at {env}.{zone}. Without it, only workers.dev."
}

locals {
  # skolia, skolia-staging; skolia-ingest, skolia-ingest-staging. Wrangler names the
  # ingest Worker the same way for its "staging" environment.
  suffix   = var.env == "production" ? "" : "-${var.env}"
  hostname = var.zone == null ? null : (var.env == "production" ? var.zone : "${var.env}.${var.zone}")
}

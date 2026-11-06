variable "account_id" {
  type = string
}

variable "env" {
  type        = string
  description = "staging, production or pr-<N> (a pull request's preview). Production keeps the original unsuffixed names."
  validation {
    condition     = contains(["staging", "production"], var.env) || can(regex("^pr-[0-9]+$", var.env))
    error_message = "env must be staging, production or pr-<N>."
  }
}

locals {
  # skolia, skolia-staging, skolia-pr-12; skolia-ingest, skolia-ingest-staging. Wrangler
  # names the ingest Worker the same way for its "staging" environment.
  suffix = var.env == "production" ? "" : "-${var.env}"
}

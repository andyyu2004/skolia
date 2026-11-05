variable "account_id" {
  type = string
}

variable "max_imports_per_day" {
  type        = number
  default     = 50
  description = "New texts the API accepts per UTC day, across all users. Analysis time is the main cost."
}

variable "domain" {
  type        = string
  default     = null
  description = "A zone on this account to serve the Worker at (e.g. skolia.io). Without it, only workers.dev."
}

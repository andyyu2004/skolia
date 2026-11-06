variable "alert_email" {
  type        = string
  default     = null
  description = "Address that gets the Usage Based Billing emails. Required in production."
  validation {
    condition     = var.env != "production" || var.alert_email != null
    error_message = "alert_email is required in production."
  }
}

locals {
  usage_alerts = {
    worker_requests                 = { name = "Workers requests", limit = 11000000 }
    worker_standard_cpu_ms          = { name = "Workers CPU ms", limit = 33000000 }
    worker_durable_objects_requests = { name = "Durable Objects requests", limit = 1100000 }
    worker_durable_objects_duration = { name = "Durable Objects duration (GB-s)", limit = 440000 }
    r2_storage                      = { name = "R2 storage (bytes)", limit = 11000000000 }
    r2_class_a_operations           = { name = "R2 class A operations", limit = 1100000 }
    r2_class_b_operations           = { name = "R2 class B operations", limit = 11000000 }
    d1_rows_read                    = { name = "D1 rows read", limit = 27500000000 }
    d1_rows_written                 = { name = "D1 rows written", limit = 55000000 }
    queues_standard_operations      = { name = "Queues operations", limit = 1100000 }
  }
}

# Usage is per account, so the alerts are made once, with production
resource "cloudflare_notification_policy" "usage" {
  for_each = var.env == "production" ? local.usage_alerts : {}

  account_id  = var.account_id
  name        = "skolia: ${each.value.name}"
  description = "Usage this billing cycle passed ${each.value.limit}, above the Workers Paid included amount."
  alert_type  = "billing_usage_alert"
  enabled     = true

  filters = {
    product = [each.key]
    limit   = [tostring(each.value.limit)]
  }

  mechanisms = {
    email = [{ id = var.alert_email }]
  }
}

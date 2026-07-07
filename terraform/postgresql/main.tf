terraform {
  required_version = ">= 1.6.0"
}

variable "database_url" {
  description = "PostgreSQL connection URL for the target database."
  type        = string
  sensitive   = true
}

variable "org_id" {
  description = "Organization id from the Pub/Sub event that triggered this DDL run."
  type        = string
  default     = ""
}

resource "terraform_data" "contractedorg_ddl" {
  triggers_replace = {
    ddl_sha256 = filesha256("${path.module}/schema.sql")
    org_id     = var.org_id
  }

  provisioner "local-exec" {
    command = "psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -v org_id=\"$ORG_ID\" -f \"${path.module}/schema.sql\""

    environment = {
      DATABASE_URL = var.database_url
      ORG_ID       = var.org_id
    }
  }
}

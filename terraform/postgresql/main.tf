terraform {
  required_version = ">= 1.6.0"
}

variable "database_url" {
  description = "PostgreSQL connection URL for the target database."
  type        = string
  sensitive   = true
}

resource "terraform_data" "contractedorg_ddl" {
  triggers_replace = {
    ddl_sha256 = filesha256("${path.module}/schema.sql")
  }

  provisioner "local-exec" {
    command = "psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f \"${path.module}/schema.sql\""

    environment = {
      DATABASE_URL = var.database_url
    }
  }
}

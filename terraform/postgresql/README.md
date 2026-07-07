# PostgreSQL DDL Terraform

This Terraform module applies the DDL in `schema.sql` to the target PostgreSQL database.

It expects the same pooler connection string used by the service:

```text
TF_VAR_database_url=postgresql://postgres.ofqhwumptcehlzialsjg:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
```

Keep the real value in GitHub Actions secrets or a local environment variable. Do not commit it.

## Run Locally

```bash
terraform init
terraform apply
```

## Pipeline

The GitHub Actions workflow at `.github/workflows/terraform-postgresql-ddl.yml` runs:

```bash
terraform init
terraform plan
terraform apply
```

`apply` runs only on `main` branch pushes or manual workflow dispatch.

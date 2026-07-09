# PostgreSQL DDL Terraform

This Terraform module applies the DDL in `schema.sql` to the target PostgreSQL database.

It expects the same pooler connection string used by the service:

```text
TF_VAR_database_url=postgresql://postgres.ofqhwumptcehlzialsjg:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
```

Keep the real value in GitHub Actions secrets or a local environment variable. Do not commit it.

When the workflow is triggered by Cloud Run through GitHub `repository_dispatch`, the Pub/Sub `orgid` is passed to Terraform as:

```text
TF_VAR_org_id
```

The Pub/Sub schema name is passed to Terraform as:

```text
TF_VAR_schema_name
```

`schema_name` must be a valid PostgreSQL identifier matching `^[A-Za-z_][A-Za-z0-9_]{0,62}$`. The SQL always keeps the shared `core.contractedorg` DDL up to date. When `schema_name` is provided, it creates that schema. When the schema name starts with `trawlerowner`, it also creates:

```text
auction
auctiondetails
group
journeycost
journeyinfo
journeyledger
trawlermaster
```

## Run Locally

```bash
terraform init
terraform apply -var="schema_name=trawlerowner_demo1"
```

## Pipeline

The GitHub Actions workflow at `.github/workflows/terraform-postgresql-ddl.yml` runs:

```bash
terraform init
terraform plan
terraform apply
```

`apply` runs only on `main` branch pushes or manual workflow dispatch.

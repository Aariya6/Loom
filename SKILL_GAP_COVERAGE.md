# LOOM skill-gap coverage

| Area from job-gap corpus | Evidence in repository | Status |
|---|---|---|
| PostgreSQL | SQLAlchemy PostgreSQL URL, indexes, Docker Postgres | implemented |
| Elasticsearch | Optional search boundary + deployment notes | integration-ready |
| Docker | Dockerfile + Compose | implemented |
| Kubernetes | `infra/k8s/deployment.yaml` | implemented |
| Terraform | `infra/terraform/main.tf` | infrastructure scaffold |
| CI/CD | GitHub Actions + Jenkinsfile | implemented |
| PyTorch / ML | scikit-learn local analysis; PyTorch boundary documented | ML implemented; PyTorch optional |
| Distributed systems | versioned persistence + bounded history + deployment replicas | implemented at application level |
| System design | architecture/data-flow docs | implemented |
| C++ | compiled statistics utility | implemented utility |
| Rust | compiled statistics utility | implemented utility |
| Go | compiled export utility | implemented utility |
| Kotlin | executable stats utility | interop utility |
| Ruby | executable manifest checker | interop utility |
| Node.js / Next.js | front end is deliberately zero-build; Node is not a runtime dependency | consciously not used |
| Kafka | outbox/event boundary documented for optional broker | optional integration |
| GCP | deployment notes / Terraform boundary | deployment-ready |
| BigQuery | analytical export schema | implemented schema |
| MongoDB | not required for the core normalized relational model | consciously not used |
| LLM | no hosted LLM dependency; local deterministic analysis is used instead | consciously not used |
| A/B testing | study workflow supports deterministic pattern comparison | application concept |
| Jenkins | pipeline included for CI parity | implemented artifact |

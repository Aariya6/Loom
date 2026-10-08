terraform {
  required_version = ">= 1.6"
}

# Provider blocks are deliberately omitted: this file models the resource
# boundary without forcing a cloud account or credentials into the project.
variable "service_name" { default = "loom" }
variable "region" { default = "europe-west1" }

output "service_name" { value = var.service_name }
output "region" { value = var.region }

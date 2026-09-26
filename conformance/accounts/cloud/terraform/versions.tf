terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 8.4.0"
    }
  }

  # State lives outside the repository: run.sh passes
  # -backend-config=path=<private dir>/terraform.tfstate at init.
  backend "local" {}
}

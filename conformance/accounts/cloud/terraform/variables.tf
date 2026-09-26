# Project identity is always an explicit private input. There is no default,
# and the provider never falls back to an ambient gcloud project.
variable "project" {
  description = "Google Cloud project ID that owns every run-created resource."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project))
    error_message = "project must be a Google Cloud project ID."
  }
}

variable "project_number" {
  description = "Expected project number; plan refuses if the ID resolves to another project."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[0-9]{6,20}$", var.project_number))
    error_message = "project_number must be the numeric project number."
  }
}

variable "run_id" {
  description = "Unique run identity; every resource name and label carries it."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{5,19}$", var.run_id))
    error_message = "run_id must be 6-20 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "zone" {
  description = "Zone for the VM; the subnet uses its region."
  type        = string
  default     = "us-central1-a"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+-[a-z]$", var.zone))
    error_message = "zone must be a Compute Engine zone name."
  }
}

variable "machine_type" {
  description = "VM shape. host.sh preflight needs at least 4 vCPUs and 6 GiB available memory."
  type        = string
  default     = "e2-standard-4"

  validation {
    condition     = contains(["e2-standard-4", "n2-standard-4", "n2d-standard-4"], var.machine_type)
    error_message = "machine_type must be one of the reviewed 4-vCPU x86_64 shapes."
  }
}

variable "disk_gb" {
  description = "Boot disk size in GB (pd-balanced)."
  type        = number
  default     = 20

  validation {
    condition     = var.disk_gb >= 10 && var.disk_gb <= 40
    error_message = "disk_gb must be between 10 and 40."
  }
}

# The exact public image is pinned so a second plan cannot drift to a newer one.
variable "image_project" {
  description = "Public project that publishes the boot image."
  type        = string
  default     = "ubuntu-os-cloud"
}

variable "image_name" {
  description = "Exact boot image name (Ubuntu 24.04 LTS, x86_64)."
  type        = string
  default     = "ubuntu-2404-noble-amd64-v20260918"
}

variable "subnet_cidr" {
  description = "Private range of the run-owned /29 subnet."
  type        = string
  default     = "10.236.36.0/29"
}

variable "ssh_user" {
  description = "Transport account the guest agent creates from the instance SSH key."
  type        = string
  default     = "sem3ops"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{2,15}$", var.ssh_user))
    error_message = "ssh_user must be a short lowercase account name."
  }
}

variable "ssh_public_key" {
  description = "Per-run ED25519 public key; its private half stays in the private run directory."
  type        = string
  nullable    = false

  validation {
    condition     = can(regex("^ssh-ed25519 [A-Za-z0-9+/=]+( [^:]*)?$", var.ssh_public_key))
    error_message = "ssh_public_key must be one ssh-ed25519 public key line."
  }
}

variable "max_run_hours" {
  description = "Deletion deadline: Compute Engine deletes the VM this long after it starts."
  type        = number
  default     = 8

  validation {
    condition     = var.max_run_hours >= 1 && var.max_run_hours <= 24 && floor(var.max_run_hours) == var.max_run_hours
    error_message = "max_run_hours must be a whole number from 1 to 24."
  }
}

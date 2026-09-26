# One disposable Linux x86_64 VM for the SEM-3 container fixture, with its
# own network. Nothing here reads, imports or changes existing resources.

provider "google" {
  project        = var.project
  region         = local.region
  zone           = var.zone
  default_labels = local.labels
}

locals {
  region = join("-", slice(split("-", var.zone), 0, 2))
  name   = "sem3-${var.run_id}"
  tag    = "sem3-fixture"
  labels = {
    semaphile-fixture = "sem3"
    semaphile-run     = var.run_id
    managed-by        = "terraform"
  }
  # Google's published source range for IAP TCP forwarding.
  iap_range = "35.235.240.0/20"
}

data "google_project" "target" {
  project_id = var.project
}

data "google_compute_image" "host" {
  project = var.image_project
  name    = var.image_name
}

resource "google_compute_network" "fixture" {
  project                 = var.project
  name                    = local.name
  description             = "SEM-3 fixture run ${var.run_id}; disposable."
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"

  lifecycle {
    # Every other resource depends on this network, so a wrong project stops
    # the plan before anything is created.
    precondition {
      condition     = data.google_project.target.number == var.project_number
      error_message = "The project ID does not resolve to the expected project number."
    }
    precondition {
      # The data source exposes no architecture; the family names it, and
      # the Ansible host play asserts x86_64 on the booted VM.
      condition     = data.google_compute_image.host.status == "READY" && data.google_compute_image.host.family == "ubuntu-2404-lts-amd64"
      error_message = "The boot image is not a READY image of the ubuntu-2404-lts-amd64 family."
    }
  }
}

resource "google_compute_subnetwork" "fixture" {
  project                  = var.project
  name                     = local.name
  region                   = local.region
  network                  = google_compute_network.fixture.id
  ip_cidr_range            = var.subnet_cidr
  stack_type               = "IPV4_ONLY"
  private_ip_google_access = false
}

# SSH only through IAP TCP forwarding: no port is open to the internet.
resource "google_compute_firewall" "iap_ssh" {
  project       = var.project
  name          = "${local.name}-iap-ssh"
  network       = google_compute_network.fixture.id
  direction     = "INGRESS"
  priority      = 1000
  source_ranges = [local.iap_range]
  target_tags   = [local.tag]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# Egress is limited to HTTP(S) for the Ubuntu archive and the pinned image.
# Metadata-server DNS and NTP are not subject to firewall rules.
resource "google_compute_firewall" "egress_web" {
  project            = var.project
  name               = "${local.name}-egress-web"
  network            = google_compute_network.fixture.id
  direction          = "EGRESS"
  priority           = 1000
  destination_ranges = ["0.0.0.0/0"]
  target_tags        = [local.tag]

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
}

resource "google_compute_firewall" "egress_deny" {
  project            = var.project
  name               = "${local.name}-egress-deny"
  network            = google_compute_network.fixture.id
  direction          = "EGRESS"
  priority           = 65000
  destination_ranges = ["0.0.0.0/0"]

  deny {
    protocol = "all"
  }
}

resource "google_compute_instance" "host" {
  project      = var.project
  name         = local.name
  zone         = var.zone
  machine_type = var.machine_type
  description  = "SEM-3 fixture run ${var.run_id}; deleted by Compute Engine after ${var.max_run_hours} h at the latest."
  tags         = [local.tag]

  boot_disk {
    auto_delete = true

    initialize_params {
      image  = data.google_compute_image.host.self_link
      size   = var.disk_gb
      type   = "pd-balanced"
      labels = local.labels
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.fixture.id

    # Ephemeral public address for egress only; ingress allows IAP alone.
    access_config {}
  }

  metadata = {
    block-project-ssh-keys  = "TRUE"
    enable-oslogin          = "FALSE"
    enable-guest-attributes = "TRUE"
    serial-port-enable      = "FALSE"
    ssh-keys                = "${var.ssh_user}:${var.ssh_public_key}"
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  # The deletion deadline is a backstop; run.sh destroys and audits first.
  scheduling {
    provisioning_model          = "STANDARD"
    automatic_restart           = false
    on_host_maintenance         = "TERMINATE"
    instance_termination_action = "DELETE"

    max_run_duration {
      seconds = var.max_run_hours * 3600
    }
  }

  # No service_account block: the VM holds no Google Cloud credentials.
  deletion_protection       = false
  allow_stopping_for_update = false
}

output "instance_name" {
  description = "VM name; also its guest hostname and the Ansible inventory host."
  value       = google_compute_instance.host.name
}

output "instance_id" {
  description = "Numeric VM id, recorded so cleanup can refuse a different VM."
  value       = google_compute_instance.host.instance_id
}

output "zone" {
  value = google_compute_instance.host.zone
}

output "ssh_user" {
  value = var.ssh_user
}

output "boot_image" {
  value = data.google_compute_image.host.self_link
}

output "max_run_seconds" {
  value = var.max_run_hours * 3600
}

output "run_owned_resources" {
  description = "Everything this run created; cleanup audits that each is gone."
  value = {
    instance     = google_compute_instance.host.self_link
    network      = google_compute_network.fixture.self_link
    subnetwork   = google_compute_subnetwork.fixture.self_link
    firewalls    = [for rule in [google_compute_firewall.iap_ssh, google_compute_firewall.egress_web, google_compute_firewall.egress_deny] : rule.self_link]
    boot_disk    = google_compute_instance.host.boot_disk[0].source
    external_ip  = "ephemeral, released with the VM"
    service_acct = "none"
  }
}

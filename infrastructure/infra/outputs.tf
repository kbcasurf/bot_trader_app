output "subnet_id" {
  value = oci_core_subnet.subnet.id
}

output "availability_domains" {
  value = data.oci_identity_availability_domains.ads.availability_domains
}
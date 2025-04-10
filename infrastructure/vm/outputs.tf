output "instance_public_ip" {
  value = oci_core_instance.bot_trader_instance.public_ip
}

output "instance_private_ip" {
  value = oci_core_instance.bot_trader_instance.private_ip
}
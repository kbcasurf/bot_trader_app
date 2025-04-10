output "instance_public_ip" {
  value = module.vm.instance_public_ip
  description = "The public IP address of the bot trader instance"
}

output "instance_private_ip" {
  value = module.vm.instance_private_ip
  description = "The private IP address of the bot trader instance"
}
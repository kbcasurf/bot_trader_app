provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

module "infra" {
  source = "./infra"

  tenancy_ocid     = var.tenancy_ocid
  compartment_ocid = var.compartment_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}

module "vm" {
  source = "./vm"
  depends_on = [module.infra]

  tenancy_ocid     = var.tenancy_ocid
  compartment_ocid = var.compartment_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
  
  availability_domain = module.infra.availability_domains[0].name
  subnet_id           = module.infra.subnet_id
  ssh_public_key      = var.ssh_public_key
}
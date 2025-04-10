variable "tenancy_ocid" {
  description = "OCI Tenancy OCID"
}

variable "compartment_ocid" {
  description = "OCI Compartment OCID"
}

variable "user_ocid" {
  description = "OCI User OCID"
}

variable "fingerprint" {
  description = "OCI API Key Fingerprint"
}

variable "private_key_path" {
  description = "Path to the OCI private key"
}

variable "region" {
  description = "OCI Region"
  default     = "us-phoenix-1"
}

variable "availability_domain" {
  description = "Availability Domain name"
}

variable "subnet_id" {
  description = "Subnet ID for the instance"
}

variable "ssh_public_key" {
  description = "SSH public key for instance access"
}
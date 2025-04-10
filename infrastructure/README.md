# Bot Trader Infrastructure Provisioning

This directory contains Terraform configurations to deploy the Bot Trader application on Oracle Cloud Infrastructure (OCI) Free Tier.

## Prerequisites

- [Terraform](https://www.terraform.io/downloads.html) installed (v1.0.0+)
- OCI account with Free Tier subscription
- OCI API key configuration

## Infrastructure Overview

The deployment consists of:

- Virtual Cloud Network (VCN) with Internet Gateway
- Security rules for SSH, HTTP, and HTTPS
- Ubuntu 24.04 Minimal VM.Standard.A1.Flex instance (1 OCPU, 6GB RAM)
- 50GB boot volume
- Automatic application deployment via cloud-init

## Directory Structure

- `infra/` - Network infrastructure (VCN, Subnet, Security List)
- `vm/` - VM configuration and cloud-init setup
- `main.tf` - Root Terraform module that integrates the components

## Setup Instructions

1. Clone this repository
   ```bash
   git clone https://github.com/YOUR_USERNAME/bot_trader_app.git
   cd bot_trader_app/infrastructure
   ```

2. Create a `terraform.tfvars` file based on the example:
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

3. Edit `terraform.tfvars` with your OCI credentials and SSH public key

4. Initialize Terraform:
   ```bash
   terraform init
   ```

5. Plan the deployment:
   ```bash
   terraform plan
   ```

6. Apply the configuration:
   ```bash
   terraform apply
   ```

7. After successful deployment, you'll receive the public IP address of your instance:
   ```
   Outputs:
   instance_public_ip = "X.X.X.X"
   ```

## Accessing Your Instance

Use SSH to connect to your instance:
```bash
ssh ubuntu@<instance_public_ip>
```

The application will be automatically deployed and available at:
```
http://<instance_public_ip>
```

## Cleaning Up

To destroy all resources:
```bash
terraform destroy
```
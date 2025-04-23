# Deploying Bot Trader App with Traefik

This guide explains how to deploy the Bot Trader App in a VPS using Traefik as a reverse proxy with Let's Encrypt SSL.

## Prerequisites

1. A VPS with Docker and Docker Compose installed
2. Domain names pointed to your VPS IP address:
   - `turnebikes.com.br` (main application)
   - `admin.turnebikes.com.br` (phpMyAdmin)
3. Ports 80 and 443 open in your VPS firewall

## Step 1: Prepare Your VPS

```bash
# Update your server
sudo apt update && sudo apt upgrade -y

# Create a directory for your application
mkdir -p ~/bot_trader_app
cd ~/bot_trader_app

# Create a directory for Let's Encrypt certificates
mkdir -p letsencrypt
```

## Step 2: Set Up Your Project

```bash
# Clone the repository (if using Git)
git clone https://your-repo-url.git .

# Or, upload your files using SCP/SFTP
# scp -r /path/to/local/project/* user@your-vps-ip:~/bot_trader_app/
```

## Step 3: Configure Environment Variables

```bash
# Create or edit .env file
nano .env
```

Add these variables to your `.env` file:

```
# Basic configuration
MYSQL_ROOT_PASSWORD=your_strong_password
DB_USER=trading_bot_user
DB_PASSWORD=your_db_password
DB_NAME=trading_bot_db

# Domain Configuration (update these with your own domains)
DOMAIN=yourdomain.com
ADMIN_DOMAIN=admin.yourdomain.com

# For Let's Encrypt SSL
ACME_EMAIL=your-email@example.com

# Backend URL for frontend connections (should match your domain with https)
VITE_BACKEND_URL=https://yourdomain.com
```

## Step 4: Deploy the Application

```bash
# Start the application
docker-compose up -d

# Check if containers are running
docker-compose ps

# Check Traefik logs for certificate issuance
docker-compose logs -f traefik
```

Wait until you see successful certificate issuance messages in the Traefik logs.

## Step 5: Verify the Deployment

1. Open `https://turnebikes.com.br` in your browser to access the main application
2. Open `https://admin.turnebikes.com.br` in your browser to access phpMyAdmin

## Maintenance Tasks

### Updating the Application

```bash
# Pull latest changes (if using Git)
git pull

# Or upload new files manually
# scp -r /path/to/updated/files/* user@your-vps-ip:~/bot_trader_app/

# Rebuild and restart the application
docker-compose down
docker-compose up -d --build
```

### Viewing Logs

```bash
# View all logs
docker-compose logs

# View logs for a specific service
docker-compose logs frontend
docker-compose logs backend
docker-compose logs traefik

# Follow logs in real-time
docker-compose logs -f
```

### Database Backup

```bash
# Create a database backup
docker-compose exec database sh -c 'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --all-databases' > backup.sql

# To restore from a backup
cat backup.sql | docker-compose exec -T database sh -c 'exec mysql -u root -p"$MYSQL_ROOT_PASSWORD"'
```

### Certificate Renewal

Traefik handles certificate renewal automatically. You can verify certificates with:

```bash
# Check certificate status
docker-compose exec traefik cat /letsencrypt/acme.json
```

## Troubleshooting

### Certificate Issues

If certificates aren't being issued:

1. Verify DNS records are correctly pointing to your VPS IP address
2. Check that ports 80 and 443 are open on your VPS firewall
3. Examine Traefik logs for errors:
   ```bash
   docker-compose logs traefik
   ```

### Connection Issues

If you can't connect to the application:

1. Check container status:
   ```bash
   docker-compose ps
   ```

2. Verify network connectivity:
   ```bash
   docker-compose exec frontend curl -I http://backend:3000/health
   ```

3. Check application logs:
   ```bash
   docker-compose logs frontend
   docker-compose logs backend
   ```

### Resource Monitoring

Monitor your VPS resources:

```bash
# Monitor CPU and memory usage
docker stats

# Monitor disk usage
df -h
```

## Security Recommendations

1. Set up a firewall allowing only ports 80, 443, and SSH
2. Use strong passwords for database and admin accounts
3. Regularly update your system and containers
4. Consider setting up regular backups to external storage
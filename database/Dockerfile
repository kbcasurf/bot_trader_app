FROM mariadb:lts

# Add custom configuration if needed
COPY my.cnf /etc/mysql/conf.d/

# Add healthcheck
HEALTHCHECK --interval=5s --timeout=5s --retries=3 CMD mysqladmin ping -h localhost -u root -p${MARIADB_ROOT_PASSWORD} || exit 1

# Set character set and collation
CMD ["mysqld", "--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]
FROM mariadb:11.2

# Copy initialization scripts
COPY init/ /docker-entrypoint-initdb.d/

# Copy custom MariaDB configuration
COPY conf/mariadb.cnf /etc/mysql/conf.d/

# Expose port
EXPOSE 3306
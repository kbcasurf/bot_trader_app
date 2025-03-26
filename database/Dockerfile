# database/Dockerfile
FROM mariadb:10.6

# Copy schema first (tables creation)
COPY schema.sql /docker-entrypoint-initdb.d/01-schema.sql

# Copy init data after schema (data insertion)
COPY init.sql /docker-entrypoint-initdb.d/02-init.sql

EXPOSE 3306

CMD ["mysqld"]
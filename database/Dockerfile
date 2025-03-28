FROM mariadb:10.6

COPY init.sql /docker-entrypoint-initdb.d/
COPY schema.sql /docker-entrypoint-initdb.d/

EXPOSE 3306
FROM mariadb:10.6

COPY schema.sql /docker-entrypoint-initdb.d/
COPY init.sql /docker-entrypoint-initdb.d/

EXPOSE 3306

CMD ["mysqld"]
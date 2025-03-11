FROM mariadb:10.6

ENV MYSQL_ROOT_PASSWORD=password
ENV MYSQL_DATABASE=crypto_bot

COPY schema.sql /docker-entrypoint-initdb.d/

EXPOSE 3306
#!/bin/sh
# Runs once, when the Postgres volume is first created. One login and one database per app,
# so no app can read another's tables. An app whose password is blank in deploy/.env is not
# being run, and gets nothing.
#
# herder's vector extension is created here, as the superuser, because herder's first
# migration runs CREATE EXTENSION as the herder login, which is not allowed to. IF NOT
# EXISTS then makes that migration a no-op.
#
# Switching an app on later, after this has already run: see "Switching on another app"
# in DEPLOYMENT-GUIDE.md.
set -eu

create_app_db() {
	name="$1"
	password="$2"
	if [ -z "$password" ]; then
		echo "initdb: no password for $name, skipping"
		return
	fi
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
		CREATE ROLE $name LOGIN PASSWORD '$password';
		CREATE DATABASE $name OWNER $name;
	SQL
}

create_app_db mailman "${MAILMAN_DB_PASSWORD:-}"
create_app_db herder "${HERDER_DB_PASSWORD:-}"
create_app_db whereyago "${WHEREYAGO_DB_PASSWORD:-}"

if [ -n "${HERDER_DB_PASSWORD:-}" ]; then
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname herder <<-SQL
		CREATE EXTENSION IF NOT EXISTS vector;
	SQL
fi

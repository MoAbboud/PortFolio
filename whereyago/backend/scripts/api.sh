#!/usr/bin/env bash
# =============================================================================
# whereyago API — curl helper functions.
#
# These are real `curl` calls. On Windows run them in **Git Bash** (not
# PowerShell — there `curl` is an alias for Invoke-WebRequest, not real curl).
#
# Usage:
#   source scripts/api.sh                 # load the functions into your shell
#   wyg_help                              # list everything
#   wyg_health                            # is the API up?
#   wyg_register me@example.com me password123
#   wyg_login    me@example.com password123     # stores the token for you
#   wyg_create_sample_day
#   wyg_list_days
#
# Point at a different server:  export WYG_BASE_URL=http://host:8000/api/v1
# =============================================================================

WYG_BASE_URL="${WYG_BASE_URL:-http://localhost:8000/api/v1}"
WYG_TOKEN="${WYG_TOKEN:-}"

# --- internal helpers --------------------------------------------------------

# Pretty-print JSON from stdin (uses jq or python if available, else raw).
_wyg_pp() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  elif command -v python >/dev/null 2>&1; then
    python -m json.tool 2>/dev/null || cat
  else
    cat
  fi
}

# Extract a top-level field ($1) from JSON on stdin.
_wyg_json_get() {
  if command -v jq >/dev/null 2>&1; then
    jq -r ".$1 // empty"
  elif command -v python >/dev/null 2>&1; then
    python -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" 2>/dev/null
  fi
}

# Core request: _wyg_request METHOD PATH [BODY] [auth]
# Prints the (pretty) response body to stdout and the HTTP status to stderr.
_wyg_request() {
  local method="$1" path="$2" body="$3" auth="$4"
  local -a args=(-sS -w $'\n%{http_code}' -X "$method" -H 'Content-Type: application/json')

  if [ "$auth" = "auth" ]; then
    if [ -z "$WYG_TOKEN" ]; then
      echo "✋ Not logged in. Run: wyg_login <email> <password>" >&2
      return 1
    fi
    args+=(-H "Authorization: Bearer ${WYG_TOKEN}")
  fi
  [ -n "$body" ] && args+=(--data "$body")

  local response status payload
  response="$(curl "${args[@]}" "${WYG_BASE_URL}${path}")" || {
    echo "❌ Could not reach ${WYG_BASE_URL} — is the API running?" >&2
    return 1
  }
  status="$(printf '%s' "$response" | tail -n1)"
  payload="$(printf '%s' "$response" | sed '$d')"

  printf '%s' "$payload" | _wyg_pp
  printf '→ HTTP %s\n' "$status" >&2
}

# --- public functions --------------------------------------------------------

wyg_health() { _wyg_request GET /health; }

wyg_register() {
  if [ $# -lt 3 ]; then
    echo "usage: wyg_register <email> <username> <password> [display_name]" >&2
    return 1
  fi
  local email="$1" username="$2" password="$3" display="$4" body
  if [ -n "$display" ]; then
    body=$(cat <<EOF
{"email":"$email","username":"$username","password":"$password","display_name":"$display"}
EOF
)
  else
    body=$(cat <<EOF
{"email":"$email","username":"$username","password":"$password"}
EOF
)
  fi
  _wyg_request POST /auth/register "$body"
}

wyg_login() {
  if [ $# -lt 2 ]; then
    echo "usage: wyg_login <email> <password>" >&2
    return 1
  fi
  local email="$1" password="$2" body response token
  body=$(cat <<EOF
{"email":"$email","password":"$password"}
EOF
)
  response="$(curl -sS -X POST -H 'Content-Type: application/json' \
    --data "$body" "${WYG_BASE_URL}/auth/login")" || {
    echo "❌ Could not reach ${WYG_BASE_URL} — is the API running?" >&2
    return 1
  }
  token="$(printf '%s' "$response" | _wyg_json_get access_token)"
  if [ -n "$token" ]; then
    export WYG_TOKEN="$token"
    echo "✅ Logged in. Token saved to \$WYG_TOKEN (auth calls now work)."
  else
    echo "❌ Login failed:" >&2
    printf '%s' "$response" | _wyg_pp >&2
    return 1
  fi
}

wyg_me() { _wyg_request GET /auth/me '' auth; }

# wyg_create_day '<json>'   OR   wyg_create_day @path/to/day.json
wyg_create_day() {
  if [ -z "$1" ]; then
    echo 'usage: wyg_create_day '"'"'{"title":"...","vibe":"chill","stops":[...]}'"'"'   (or @file.json)' >&2
    return 1
  fi
  _wyg_request POST /days "$1" auth
}

wyg_create_sample_day() {
  _wyg_request POST /days '{"title":"Lazy Sunday Reset","vibe":"chill","city":"Kansas City, MO","summary":"Brunch, art, a walk and ice cream.","stops":[{"name":"City Market Brunch","type":"cafe","time":"10:00"},{"name":"Nelson-Atkins Museum","type":"attraction","time":"12:00","lat":39.0454,"lon":-94.5810},{"name":"Loose Park","type":"outdoors","time":"14:30","note":"Picnic by the rose garden"}]}' auth
}

wyg_list_days() { _wyg_request GET /days '' auth; }

wyg_get_day() {
  [ -z "$1" ] && { echo "usage: wyg_get_day <id>" >&2; return 1; }
  _wyg_request GET "/days/$1" '' auth
}

wyg_delete_day() {
  [ -z "$1" ] && { echo "usage: wyg_delete_day <id>" >&2; return 1; }
  _wyg_request DELETE "/days/$1" '' auth
}

wyg_discover() { _wyg_request GET /days/discover; }

wyg_logout() { unset WYG_TOKEN; echo "Token cleared."; }

# One-shot demo: register (ignoring 'already exists'), login, create, list.
wyg_quickstart() {
  local email="${1:-demo@example.com}" user="${2:-demo}" pass="${3:-password123}"
  echo "1) health";          wyg_health;            echo
  echo "2) register $email"; wyg_register "$email" "$user" "$pass" >/dev/null 2>&1
  echo "3) login";           wyg_login "$email" "$pass" || return 1; echo
  echo "4) create sample day"; wyg_create_sample_day; echo
  echo "5) list my days";    wyg_list_days
}

wyg_help() {
  cat <<EOF
whereyago API helpers  (base: ${WYG_BASE_URL})

  wyg_health                                  GET  /health
  wyg_register <email> <user> <pass> [name]   POST /auth/register
  wyg_login    <email> <pass>                 POST /auth/login   (saves token)
  wyg_me                                      GET  /auth/me        [auth]
  wyg_create_sample_day                       POST /days (example) [auth]
  wyg_create_day '<json>' | @file.json        POST /days           [auth]
  wyg_list_days                               GET  /days           [auth]
  wyg_get_day    <id>                         GET  /days/<id>      [auth]
  wyg_delete_day <id>                         DELETE /days/<id>    [auth]
  wyg_discover                                GET  /days/discover
  wyg_logout                                  clear the saved token
  wyg_quickstart [email] [user] [pass]        run a full demo end-to-end

Tip: override the server with  export WYG_BASE_URL=http://host:8000/api/v1
EOF
}

echo "whereyago curl helpers loaded. Run 'wyg_help' for commands. Base: ${WYG_BASE_URL}"

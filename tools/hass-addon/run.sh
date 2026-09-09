#!/usr/bin/with-contenv bashio
set -e

OUT="/share/tbm"
REPO="/opt/tbm"
INTERVAL="$(bashio::config 'interval')"
KEEP="$(bashio::config 'keep_days')"
REF="$(bashio::config 'git_ref')"

mkdir -p "${OUT}"

# --- code du recorder : clone au premier lancement, sinon mise a jour ----
bashio::log.info "Recuperation du code (${REF})..."
if [ -d "${REPO}/.git" ]; then
    git -C "${REPO}" fetch --depth 1 origin "${REF}"
    git -C "${REPO}" reset --hard FETCH_HEAD
else
    git clone --depth 1 -b "${REF}" https://github.com/adrienl82/Tbm.git "${REPO}"
fi
cd "${REPO}"
npm install --omit=dev --no-audit --no-fund

# --- menage : gzip des jours termines, purge au-dela de keep_days --------
housekeep() {
    local today
    today="$(date +%F)"
    for d in "${OUT}"/20*/ ; do
        [ -d "${d}" ] || continue
        [ "$(basename "${d}")" = "${today}" ] && continue
        find "${d}" -name '*.ndjson' -exec gzip -f {} + 2>/dev/null || true
    done
    if [ "${KEEP:-0}" -gt 0 ]; then
        find "${OUT}" -maxdepth 1 -type d -name '20*' -mtime "+${KEEP}" \
            -exec rm -rf {} + 2>/dev/null || true
    fi
}

housekeep
( while sleep 3600; do housekeep; done ) &

# exec -> node devient le process principal, donc le SIGTERM d'un "stop"
# add-on lui parvient directement et il s'arrete proprement (flush + meta).
bashio::log.info "Demarrage : record-feed --interval ${INTERVAL} --out ${OUT}"
exec node tools/record-feed.mjs --interval "${INTERVAL}" --out "${OUT}"

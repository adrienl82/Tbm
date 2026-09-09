#!/usr/bin/with-contenv bashio
set -e

OUT="/share/tbm"
REPO="/opt/tbm"
INTERVAL="$(bashio::config 'interval')"
KEEP="$(bashio::config 'keep_days')"
REF="$(bashio::config 'git_ref')"
CUT="$(bashio::config 'session_cut')"
GAP="$(bashio::config 'session_gap_min')"

FLAGS=""
if bashio::config.true 'trips'; then FLAGS="${FLAGS} --trips"; fi
if bashio::config.true 'alerts'; then FLAGS="${FLAGS} --alerts"; fi

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

# --- menage horaire ----------------------------------------------------
#  - gzip les .ndjson d'une session close (dossier avec un fichier DONE) et
#    des vieux dossiers dates (format pre-v1.2) ; la session ouverte n'a pas
#    de DONE et reste donc en clair
#  - purge une session traitee (PROCESSED) au-dela de keep_days jours
#  - purge dur au-dela de 2x keep_days meme sans PROCESSED (garde-fou)
housekeep() {
    for d in "${OUT}"/session-*/ ; do
        if [ -f "${d}DONE" ]; then
            find "${d}" -name '*.ndjson' -exec gzip -f {} + 2>/dev/null || true
        fi
    done
    for d in "${OUT}"/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ ; do
        if [ -d "${d}" ]; then
            find "${d}" -name '*.ndjson' -exec gzip -f {} + 2>/dev/null || true
        fi
    done
    if [ "${KEEP:-0}" -gt 0 ]; then
        find "${OUT}" -maxdepth 1 -type d -name 'session-*' -mtime "+${KEEP}" | while read -r d; do
            if [ -f "${d}/PROCESSED" ]; then rm -rf "${d}"; fi
        done
        find "${OUT}" -maxdepth 1 -type d \( -name 'session-*' -o -name '20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]' \) \
            -mtime "+$(( KEEP * 2 ))" -exec rm -rf {} + 2>/dev/null || true
    fi
}

housekeep
( while sleep 3600; do housekeep; done ) &

# exec -> node devient le process principal, donc le SIGTERM d'un "stop"
# add-on lui parvient directement et il s'arrete proprement (flush + etat).
bashio::log.info "Demarrage : record-feed --interval ${INTERVAL}${FLAGS} --session-cut ${CUT} --session-gap-min ${GAP} --out ${OUT}"
exec node tools/record-feed.mjs --interval "${INTERVAL}" ${FLAGS} \
    --session-cut "${CUT}" --session-gap-min "${GAP}" --out "${OUT}"

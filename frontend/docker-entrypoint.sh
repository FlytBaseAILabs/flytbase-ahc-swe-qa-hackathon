#!/bin/sh
set -e
API_URL="${API_URL:-http://localhost:4000}"
WHEP_URL="${WHEP_URL:-http://localhost:8889}"
ORG_ID="${ORG_ID:-flytbase}"
MAP_TILES="${MAP_TILES:-google}"
MAP_TERRAIN="${MAP_TERRAIN:-world}"
CESIUM_ION_TOKEN="${CESIUM_ION_TOKEN:-}"
cat > /usr/share/nginx/html/config.js <<CFG
window.__config = { apiUrl: '${API_URL}', whepUrl: '${WHEP_URL}', orgId: '${ORG_ID}', mapTiles: '${MAP_TILES}', mapTerrain: '${MAP_TERRAIN}', ionToken: '${CESIUM_ION_TOKEN}' };
CFG
exec nginx -g 'daemon off;'

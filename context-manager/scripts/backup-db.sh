#!/usr/bin/env bash
# backup-db.sh - Backup de la base de données PostgreSQL DCM
#
# Usage: ./backup-db.sh [--output DIR] [--compress] [--keep N]
#
# Options:
#   --output DIR   Répertoire de destination (défaut: ~/.claude/backups)
#   --compress     Compresser le backup avec gzip
#   --keep N       Garder seulement les N derniers backups (défaut: 7)
#
# Exemples:
#   ./backup-db.sh
#   ./backup-db.sh --compress --keep 14
#   ./backup-db.sh --output /mnt/backups

set -euo pipefail

# Configuration par défaut
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-claude_context}"
DB_USER="${DB_USER:-$USER}"

OUTPUT_DIR="${HOME}/.claude/backups"
COMPRESS=false
KEEP_COUNT=7

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --compress)
            COMPRESS=true
            shift
            ;;
        --keep)
            KEEP_COUNT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--output DIR] [--compress] [--keep N]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "$1"
}

# Créer le répertoire de backup s'il n'existe pas
mkdir -p "$OUTPUT_DIR"

# Nom du fichier de backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${OUTPUT_DIR}/dcm_backup_${TIMESTAMP}.sql"

log "${YELLOW}Starting backup of ${DB_NAME}...${NC}"
log "  Host: ${DB_HOST}:${DB_PORT}"
log "  User: ${DB_USER}"
log "  Output: ${BACKUP_FILE}"

# Vérifier que pg_dump est disponible
if ! command -v pg_dump &> /dev/null; then
    log "${RED}Error: pg_dump not found. Install PostgreSQL client.${NC}"
    exit 1
fi

# Vérifier la connexion à la base
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
    log "${RED}Error: Cannot connect to PostgreSQL at ${DB_HOST}:${DB_PORT}${NC}"
    exit 1
fi

# Effectuer le backup
log "${YELLOW}Running pg_dump...${NC}"
if pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-privileges --clean --if-exists \
    -f "$BACKUP_FILE" 2>/dev/null; then

    # Afficher la taille
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    log "${GREEN}Backup created: ${SIZE}${NC}"

    # Compresser si demandé
    if [[ "$COMPRESS" == "true" ]]; then
        log "${YELLOW}Compressing...${NC}"
        gzip -f "$BACKUP_FILE"
        BACKUP_FILE="${BACKUP_FILE}.gz"
        SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        log "${GREEN}Compressed: ${SIZE}${NC}"
    fi

    log "${GREEN}Backup complete: ${BACKUP_FILE}${NC}"

else
    log "${RED}Error: pg_dump failed${NC}"
    exit 1
fi

# Rotation des anciens backups
log "${YELLOW}Cleaning old backups (keeping last ${KEEP_COUNT})...${NC}"

# Lister les backups triés par date (plus récent en premier)
BACKUP_PATTERN="dcm_backup_*.sql"
if [[ "$COMPRESS" == "true" ]]; then
    BACKUP_PATTERN="dcm_backup_*.sql.gz"
fi

# Compter et supprimer les vieux backups
BACKUP_COUNT=0
while IFS= read -r -d '' file; do
    ((BACKUP_COUNT++))
    if [[ $BACKUP_COUNT -gt $KEEP_COUNT ]]; then
        rm -f "$file"
        log "  Deleted: $(basename "$file")"
    fi
done < <(find "$OUTPUT_DIR" -name "$BACKUP_PATTERN" -type f -print0 | sort -rz)

REMAINING=$((BACKUP_COUNT > KEEP_COUNT ? KEEP_COUNT : BACKUP_COUNT))
log "${GREEN}Kept ${REMAINING} backup(s)${NC}"

# Résumé
echo ""
log "${GREEN}=== Backup Summary ===${NC}"
log "  Database: ${DB_NAME}"
log "  File: ${BACKUP_FILE}"
log "  Size: ${SIZE}"
log "  Backups kept: ${REMAINING}"

# Optionnel: vérifier l'intégrité du backup
if [[ "$COMPRESS" == "true" ]]; then
    if gzip -t "$BACKUP_FILE" 2>/dev/null; then
        log "  Integrity: OK"
    else
        log "${RED}  Integrity: FAILED${NC}"
        exit 1
    fi
else
    # Vérifier que le fichier n'est pas vide
    if [[ -s "$BACKUP_FILE" ]]; then
        log "  Integrity: OK (non-empty)"
    else
        log "${RED}  Integrity: FAILED (empty file)${NC}"
        exit 1
    fi
fi

exit 0

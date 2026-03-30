#!/usr/bin/env bash
#
# suggest-skills.sh - UserPromptSubmit hook for skill, agent & command suggestion
#
# Queries 3 DCM sources in parallel:
#   1. Routing API (learned scores from past usage) — skills + agents
#   2. Catalog API (dynamic filesystem scan) — skills + agents + commands
# Merges results, deduplicates, and outputs tiered recommendations.
#
# Execution: UserPromptSubmit
# Timeout budget: 800ms total (600ms curl + 200ms processing)
# Output: {"hookSpecificOutput":{"additionalContext":"..."}}
#
set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

# Configuration
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
readonly LOG_FILE="/tmp/dcm-suggest-skills.log"
readonly CURL_CONNECT_TIMEOUT=0.3
readonly CURL_MAX_TIME=0.5
readonly MAX_KEYWORDS=15
readonly MIN_KEYWORD_LENGTH=4
readonly ROUTING_LIMIT=5
readonly CATALOG_LIMIT=5
readonly ROUTING_MIN_SCORE=0.3
readonly SCORE_HIGH=0.8

# Logging helper
log_message() {
    local level="$1"
    shift
    printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Stop words (French + English)
readonly STOP_WORDS="le la les un une des du de dans pour avec par sur qui que est sont fait faire nous vous ils elles ce cette ces mon ton son the and for are but not you all any can had her was one our out has have been from this that they were with will each make like them then what when your which their there some could more very only come into over such also back than much even most made just about than been call first find give long look many most some take come than them than used want were what when will with also been both each from have just know like make many most only some take tell them that then this used very want were what when with your aussi bien dans donc elle etre fait mais nous pour sont tout tres avec ajoute cree modifie corrige implemente genere"

# Read stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

user_prompt=$(echo "$RAW_INPUT" | jq -r '.user_prompt // .prompt // empty' 2>/dev/null)
[[ -z "$user_prompt" ]] && exit 0

if ! dcm_api_available; then
    log_message "SKIP" "Circuit breaker open"
    exit 0
fi

# --- Keyword Extraction ---
declare -A stop_word_map
for sw in $STOP_WORDS; do
    stop_word_map["$sw"]=1
done

keywords=()
declare -A seen_map

while IFS= read -r word; do
    (( ${#word} < MIN_KEYWORD_LENGTH )) && continue
    [[ -n "${stop_word_map[$word]:-}" ]] && continue
    [[ -n "${seen_map[$word]:-}" ]] && continue
    seen_map["$word"]=1
    keywords+=("$word")
    (( ${#keywords[@]} >= MAX_KEYWORDS )) && break
done < <(echo "$user_prompt" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '\n' | grep -v '^$')

if (( ${#keywords[@]} == 0 )); then
    log_message "SKIP" "No keywords extracted"
    exit 0
fi

keywords_csv=$(IFS=','; echo "${keywords[*]}")
# For catalog search, use space-separated (first 5 keywords)
search_term=$(echo "${keywords[*]:0:5}" | tr ' ' '+')

log_message "INFO" "Keywords: $keywords_csv"

# --- 3 parallel queries to DCM ---
ROUTING_SKILL_TMP=$(mktemp)
ROUTING_AGENT_TMP=$(mktemp)
CATALOG_TMP=$(mktemp)
trap 'rm -f "$ROUTING_SKILL_TMP" "$ROUTING_AGENT_TMP" "$CATALOG_TMP"' EXIT

# 1. Routing: learned skill scores (exclude builtins — they pollute suggestions)
curl -s --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" \
    "${API_URL}/api/routing/suggest?keywords=${keywords_csv}&limit=${ROUTING_LIMIT}&min_score=${ROUTING_MIN_SCORE}&tool_type=skill&exclude_types=builtin" \
    > "$ROUTING_SKILL_TMP" 2>/dev/null &
PID1=$!

# 2. Routing: learned agent scores
curl -s --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" \
    "${API_URL}/api/routing/suggest?keywords=${keywords_csv}&limit=${ROUTING_LIMIT}&min_score=${ROUTING_MIN_SCORE}&tool_type=agent" \
    > "$ROUTING_AGENT_TMP" 2>/dev/null &
PID2=$!

# 3. Catalog: search per keyword (top 3 keywords, parallel) then merge
CATALOG_TMP1=$(mktemp); CATALOG_TMP2=$(mktemp); CATALOG_TMP3=$(mktemp)
trap 'rm -f "$ROUTING_SKILL_TMP" "$ROUTING_AGENT_TMP" "$CATALOG_TMP" "$CATALOG_TMP1" "$CATALOG_TMP2" "$CATALOG_TMP3"' EXIT

# Pick the 3 most specific keywords (longest first) for catalog search
mapfile -t sorted_kw < <(printf '%s\n' "${keywords[@]}" | awk '{ print length, $0 }' | sort -rn | head -3 | awk '{ print $2 }')
kw1="${sorted_kw[0]:-}"; kw2="${sorted_kw[1]:-}"; kw3="${sorted_kw[2]:-}"

[[ -n "$kw1" ]] && curl -s --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" \
    "${API_URL}/api/registry/catalog?search=${kw1}" > "$CATALOG_TMP1" 2>/dev/null &
PID3=$!

[[ -n "$kw2" ]] && curl -s --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" \
    "${API_URL}/api/registry/catalog?search=${kw2}" > "$CATALOG_TMP2" 2>/dev/null &
PID4=$!

[[ -n "$kw3" ]] && curl -s --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" \
    "${API_URL}/api/registry/catalog?search=${kw3}" > "$CATALOG_TMP3" 2>/dev/null &
PID5=$!

wait "$PID1" "$PID2" ${PID3:-} ${PID4:-} ${PID5:-} 2>/dev/null

routing_skills=$(cat "$ROUTING_SKILL_TMP" 2>/dev/null || echo "")
routing_agents=$(cat "$ROUTING_AGENT_TMP" 2>/dev/null || echo "")

# Merge catalog results: combine skills/agents/commands from all keyword searches
catalog_data=$(jq -n \
  --slurpfile c1 "$CATALOG_TMP1" \
  --slurpfile c2 "$CATALOG_TMP2" \
  --slurpfile c3 "$CATALOG_TMP3" \
  '{
    skills: ([$c1[0].skills // [], $c2[0].skills // [], $c3[0].skills // []] | add | unique_by(.id)),
    agents: ([$c1[0].agents // [], $c2[0].agents // [], $c3[0].agents // []] | add | unique_by(.id)),
    commands: ([$c1[0].commands // [], $c2[0].commands // [], $c3[0].commands // []] | add | unique_by(.id)),
    counts: {
      skills: ([$c1[0].skills // [], $c2[0].skills // [], $c3[0].skills // []] | add | unique_by(.id) | length),
      agents: ([$c1[0].agents // [], $c2[0].agents // [], $c3[0].agents // []] | add | unique_by(.id) | length),
      commands: ([$c1[0].commands // [], $c2[0].commands // [], $c3[0].commands // []] | add | unique_by(.id) | length)
    }
  }' 2>/dev/null || echo "")

# Need at least one valid response
any_valid=false
for resp in "$routing_skills" "$routing_agents" "$catalog_data"; do
    if [[ -n "$resp" ]] && echo "$resp" | jq empty 2>/dev/null; then
        any_valid=true
        break
    fi
done

if [[ "$any_valid" == "false" ]]; then
    dcm_api_failed
    log_message "WARN" "All 3 DCM queries failed"
    exit 0
fi

dcm_api_success

# --- Build output sections ---

# Track seen items to deduplicate
declare -A seen_items

# Section: Skills from routing (learned scores)
skill_lines=""
if [[ -n "$routing_skills" ]] && echo "$routing_skills" | jq empty 2>/dev/null; then
    while IFS= read -r item; do
        local_name=$(echo "$item" | jq -r '.tool_name // empty' 2>/dev/null)
        local_score=$(echo "$item" | jq -r '.score // 0' 2>/dev/null)
        local_usage=$(echo "$item" | jq -r '.usage_count // 0' 2>/dev/null)
        local_success=$(echo "$item" | jq -r '.success_rate // 0' 2>/dev/null)
        local_matches=$(echo "$item" | jq -r '.keyword_matches // [] | join(", ")' 2>/dev/null)
        [[ -z "$local_name" ]] && continue
        seen_items["skill:$local_name"]=1
        skill_lines="${skill_lines}  - /${local_name} (score: ${local_score}, ${local_usage}x usage, ${local_success}% succes, matched: ${local_matches})\n"
    done < <(echo "$routing_skills" | jq -c '.suggestions[]?' 2>/dev/null)
fi

# Section: Agents from routing (learned scores)
agent_lines=""
if [[ -n "$routing_agents" ]] && echo "$routing_agents" | jq empty 2>/dev/null; then
    while IFS= read -r item; do
        local_name=$(echo "$item" | jq -r '.tool_name // empty' 2>/dev/null)
        local_score=$(echo "$item" | jq -r '.score // 0' 2>/dev/null)
        local_usage=$(echo "$item" | jq -r '.usage_count // 0' 2>/dev/null)
        local_success=$(echo "$item" | jq -r '.success_rate // 0' 2>/dev/null)
        local_matches=$(echo "$item" | jq -r '.keyword_matches // [] | join(", ")' 2>/dev/null)
        [[ -z "$local_name" ]] && continue
        seen_items["agent:$local_name"]=1
        agent_lines="${agent_lines}  - subagent_type=\"${local_name}\" (score: ${local_score}, ${local_usage}x usage, ${local_success}% succes, matched: ${local_matches})\n"
    done < <(echo "$routing_agents" | jq -c '.suggestions[]?' 2>/dev/null)
fi

# Section: Catalog discoveries (dynamic scan — fills gaps where routing has no data)
catalog_skill_lines=""
catalog_agent_lines=""
catalog_command_lines=""
if [[ -n "$catalog_data" ]] && echo "$catalog_data" | jq empty 2>/dev/null; then
    # Skills from catalog (not already in routing)
    while IFS= read -r item; do
        local_id=$(echo "$item" | jq -r '.id // empty' 2>/dev/null)
        local_name=$(echo "$item" | jq -r '.name // empty' 2>/dev/null)
        local_desc=$(echo "$item" | jq -r '.description // "" | .[0:80]' 2>/dev/null)
        local_cat=$(echo "$item" | jq -r '.category // ""' 2>/dev/null)
        [[ -z "$local_id" ]] && continue
        [[ -n "${seen_items["skill:$local_id"]:-}" ]] && continue
        seen_items["skill:$local_id"]=1
        catalog_skill_lines="${catalog_skill_lines}  - /${local_id} [${local_cat}] — ${local_desc}\n"
    done < <(echo "$catalog_data" | jq -c '.skills[]?' 2>/dev/null | head -"$CATALOG_LIMIT")

    # Agents from catalog (not already in routing)
    while IFS= read -r item; do
        local_id=$(echo "$item" | jq -r '.id // empty' 2>/dev/null)
        local_name=$(echo "$item" | jq -r '.name // empty' 2>/dev/null)
        local_desc=$(echo "$item" | jq -r '.description // "" | .[0:80]' 2>/dev/null)
        local_cat=$(echo "$item" | jq -r '.category // ""' 2>/dev/null)
        [[ -z "$local_id" ]] && continue
        [[ -n "${seen_items["agent:$local_id"]:-}" ]] && continue
        seen_items["agent:$local_id"]=1
        catalog_agent_lines="${catalog_agent_lines}  - subagent_type=\"${local_id}\" [${local_cat}] — ${local_desc}\n"
    done < <(echo "$catalog_data" | jq -c '.agents[]?' 2>/dev/null | head -"$CATALOG_LIMIT")

    # Commands from catalog
    while IFS= read -r item; do
        local_id=$(echo "$item" | jq -r '.id // empty' 2>/dev/null)
        local_desc=$(echo "$item" | jq -r '.description // "" | .[0:80]' 2>/dev/null)
        [[ -z "$local_id" ]] && continue
        catalog_command_lines="${catalog_command_lines}  - /${local_id} — ${local_desc}\n"
    done < <(echo "$catalog_data" | jq -c '.commands[]?' 2>/dev/null | head -3)
fi

# --- Nothing found at all → exit ---
if [[ -z "$skill_lines" && -z "$agent_lines" && -z "$catalog_skill_lines" && -z "$catalog_agent_lines" && -z "$catalog_command_lines" ]]; then
    log_message "INFO" "No suggestions found"
    exit 0
fi

# --- Build additionalContext ---
context_text="[DCM Routing — Skills, Agents & Commandes]"

# Routing results (high priority — learned from real usage)
if [[ -n "$skill_lines" || -n "$agent_lines" ]]; then
    context_text="${context_text}\n\n=== SCORES APPRIS (usage reel) ==="
    if [[ -n "$skill_lines" ]]; then
        context_text="${context_text}\nSkills:\n${skill_lines}"
    fi
    if [[ -n "$agent_lines" ]]; then
        context_text="${context_text}\nAgents:\n${agent_lines}"
    fi
fi

# Catalog results (discovery — complements routing for new/unused tools)
if [[ -n "$catalog_skill_lines" || -z "$skill_lines" ]] && [[ -n "$catalog_skill_lines" ]]; then
    context_text="${context_text}\n\n=== CATALOGUE (decouverte) ==="
    context_text="${context_text}\nSkills disponibles:\n${catalog_skill_lines}"
fi
if [[ -n "$catalog_agent_lines" || -z "$agent_lines" ]] && [[ -n "$catalog_agent_lines" ]]; then
    if [[ -z "$catalog_skill_lines" ]]; then
        context_text="${context_text}\n\n=== CATALOGUE (decouverte) ==="
    fi
    context_text="${context_text}\nAgents disponibles:\n${catalog_agent_lines}"
fi
if [[ -n "$catalog_command_lines" ]]; then
    context_text="${context_text}\nCommandes disponibles:\n${catalog_command_lines}"
fi

# Delegation reminder
context_text="${context_text}\n\n=== DELEGATION ===\n- Charge les skills AVANT d'ecrire du code ou de lancer un agent\n- Choisis le subagent_type le plus specialise pour chaque sous-tache\n- 1 agent = 1 fichier = 1 action. Prompt < 200 mots. Scope precis.\n- Ne jamais demander a un agent d'explorer ET implementer"

# Escape for JSON
escaped_context=$(printf '%b' "$context_text" | jq -Rs '.' 2>/dev/null)

if [[ -z "$escaped_context" || "$escaped_context" == "null" ]]; then
    escaped_context="\"[DCM] Suggestions disponibles mais formatage echoue.\""
fi

printf '{"hookSpecificOutput":{"additionalContext":%s}}' "$escaped_context"

# Logging
r_skill_count=$(echo "$routing_skills" | jq -r '.count // 0' 2>/dev/null || echo 0)
r_agent_count=$(echo "$routing_agents" | jq -r '.count // 0' 2>/dev/null || echo 0)
c_skill_count=$(echo "$catalog_data" | jq -r '.counts.skills // 0' 2>/dev/null || echo 0)
c_agent_count=$(echo "$catalog_data" | jq -r '.counts.agents // 0' 2>/dev/null || echo 0)
c_cmd_count=$(echo "$catalog_data" | jq -r '.counts.commands // 0' 2>/dev/null || echo 0)
log_message "INFO" "DCM routing: r_skills=${r_skill_count} r_agents=${r_agent_count} c_skills=${c_skill_count} c_agents=${c_agent_count} c_cmds=${c_cmd_count}"
exit 0

#!/usr/bin/env bash
#
# suggest-skills.sh - UserPromptSubmit hook for skill auto-suggestion
#
# Extracts keywords from user prompt, queries DCM routing API to suggest
# matching skills. High-confidence matches (>= 0.8) generate AUTO-INVOKE
# instructions; medium-confidence (0.5-0.8) generate suggestions.
#
# Execution: UserPromptSubmit
# Timeout budget: 500ms total (400ms curl + 100ms margin)
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
readonly CURL_MAX_TIME=0.4
readonly MAX_KEYWORDS=15
readonly MIN_KEYWORD_LENGTH=4
readonly API_LIMIT=5
readonly API_MIN_SCORE=0.5
readonly SCORE_AUTO_INVOKE=0.8

# Logging helper
log_message() {
    local level="$1"
    shift
    printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Stop words (French + English) — common words to filter out
readonly STOP_WORDS="le la les un une des du de dans pour avec par sur qui que est sont fait faire nous vous ils elles ce cette ces mon ton son the and for are but not you all any can had her was one our out has have been from this that they were with will each make like them then what when your which their there some could more very only come into over such also back than much even most made just about than been call first find give long look many most some take come than them than used want were what when will with also been both each from have just know like make many most only some take tell them that then this used very want were what when with your aussi bien dans donc elle etre fait mais nous pour sont tout tres avec"

# Read stdin (user prompt JSON)
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract user prompt — try both field names
user_prompt=$(echo "$RAW_INPUT" | jq -r '.user_prompt // .prompt // empty' 2>/dev/null)
[[ -z "$user_prompt" ]] && exit 0

# Check circuit breaker before doing any work
if ! dcm_api_available; then
    log_message "SKIP" "Circuit breaker open — skipping skill suggestion"
    exit 0
fi

# --- Keyword Extraction ---
# Convert to lowercase, split on non-alphanum, filter stop words, keep > MIN_KEYWORD_LENGTH chars

# Build stop-word associative lookup (for O(1) filtering)
declare -A stop_word_map
for sw in $STOP_WORDS; do
    stop_word_map["$sw"]=1
done

# Extract keywords: lowercase, split, deduplicate, filter
keywords=()
declare -A seen_map

while IFS= read -r word; do
    # Skip short words
    (( ${#word} < MIN_KEYWORD_LENGTH )) && continue

    # Skip stop words
    [[ -n "${stop_word_map[$word]:-}" ]] && continue

    # Skip duplicates
    [[ -n "${seen_map[$word]:-}" ]] && continue
    seen_map["$word"]=1

    keywords+=("$word")

    # Limit to MAX_KEYWORDS
    (( ${#keywords[@]} >= MAX_KEYWORDS )) && break
done < <(echo "$user_prompt" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '\n' | grep -v '^$')

# No keywords extracted — exit silently
if (( ${#keywords[@]} == 0 )); then
    log_message "SKIP" "No keywords extracted from prompt"
    exit 0
fi

# Build comma-separated keyword string for API
keywords_csv=$(IFS=','; echo "${keywords[*]}")

log_message "INFO" "Keywords extracted: $keywords_csv"

# --- Query DCM Routing API ---
api_path="/api/routing/suggest?keywords=${keywords_csv}&limit=${API_LIMIT}&min_score=${API_MIN_SCORE}&tool_type=skill"

# URL-encode the keywords (basic: replace spaces with %20)
encoded_path=$(echo "$api_path" | sed 's/ /%20/g')

response=$(curl -s \
    --connect-timeout "$CURL_CONNECT_TIMEOUT" \
    --max-time "$CURL_MAX_TIME" \
    "${API_URL}${encoded_path}" 2>/dev/null || echo "")

# API unreachable or empty response — exit silently
if [[ -z "$response" ]]; then
    dcm_api_failed
    log_message "WARN" "DCM routing API unreachable or empty response"
    exit 0
fi

# Validate JSON response
if ! echo "$response" | jq empty 2>/dev/null; then
    dcm_api_failed
    log_message "ERROR" "Invalid JSON from routing API"
    exit 0
fi

dcm_api_success

# Parse suggestion count
suggestion_count=$(echo "$response" | jq -r '.count // 0' 2>/dev/null)
if (( suggestion_count == 0 )); then
    log_message "INFO" "No skill suggestions returned"
    exit 0
fi

# --- Build Tiered Output ---
auto_invoke_lines=""
consider_lines=""

while IFS= read -r suggestion; do
    tool_name=$(echo "$suggestion" | jq -r '.tool_name // empty' 2>/dev/null)
    score=$(echo "$suggestion" | jq -r '.score // 0' 2>/dev/null)
    keyword_matches=$(echo "$suggestion" | jq -r '.keyword_matches // [] | join(", ")' 2>/dev/null)

    [[ -z "$tool_name" ]] && continue

    # Float comparison: score >= SCORE_AUTO_INVOKE
    # Use bc with fallback to awk
    is_auto_invoke=false
    if command -v bc &>/dev/null; then
        if (( $(echo "$score >= $SCORE_AUTO_INVOKE" | bc -l 2>/dev/null || echo "0") )); then
            is_auto_invoke=true
        fi
    else
        if awk "BEGIN { exit !($score >= $SCORE_AUTO_INVOKE) }" 2>/dev/null; then
            is_auto_invoke=true
        fi
    fi

    if [[ "$is_auto_invoke" == "true" ]]; then
        auto_invoke_lines="${auto_invoke_lines}  - AUTO-INVOKE: /${tool_name} (score: ${score}, matched: ${keyword_matches})\n"
    else
        consider_lines="${consider_lines}  - Consider: /${tool_name} (score: ${score}, matched: ${keyword_matches})\n"
    fi
done < <(echo "$response" | jq -c '.suggestions[]' 2>/dev/null)

# No lines built — exit silently
if [[ -z "$auto_invoke_lines" && -z "$consider_lines" ]]; then
    log_message "INFO" "No actionable suggestions after tier filtering"
    exit 0
fi

# --- Build additionalContext ---
context_text="[DCM Skill Suggestions]"

if [[ -n "$auto_invoke_lines" ]]; then
    context_text="${context_text}\nHigh-confidence skills (auto-invoke recommended):\n${auto_invoke_lines}"
fi

if [[ -n "$consider_lines" ]]; then
    context_text="${context_text}\nAvailable skills to consider:\n${consider_lines}"
fi

# Escape for JSON using jq
escaped_context=$(printf '%b' "$context_text" | jq -Rs '.' 2>/dev/null)

# Fallback if jq escaping fails
if [[ -z "$escaped_context" || "$escaped_context" == "null" ]]; then
    escaped_context="\"[DCM Skill Suggestions] Skills available but formatting failed.\""
fi

# Output the hook response
printf '{"hookSpecificOutput":{"additionalContext":%s}}' "$escaped_context"

auto_count=$(printf '%b' "$auto_invoke_lines" | grep -c 'AUTO-INVOKE' 2>/dev/null || echo 0)
consider_count=$(printf '%b' "$consider_lines" | grep -c 'Consider' 2>/dev/null || echo 0)
log_message "INFO" "Suggested ${suggestion_count} skills (auto-invoke: ${auto_count}, consider: ${consider_count})"
exit 0

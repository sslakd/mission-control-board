#!/bin/bash
# ==============================================
# Mission Control Dashboard - UI Integrity Test
# ==============================================
# Exit: 0 = ALL PASS, 1 = FAIL
# ==============================================

PASS=0
FAIL=0
HTML_FILE="$(cd "$(dirname "$0")" && pwd)/index.html"
SERVER_PORT=3001
NGINX_PORT=8080

echo "========================================="
echo "🧪 Mission Control Dashboard — UI Test"
echo "========================================="

check() {
    local desc="$1"
    local result="$2"
    if [ "$result" = "ok" ]; then
        echo "  ✅ $desc"
        PASS=$((PASS + 1))
    else
        echo "  ❌ $desc"
        FAIL=$((FAIL + 1))
    fi
}

# ---------- 1. File exists ----------
echo ""
echo "--- 1. File checks ---"
[ -f "$HTML_FILE" ]
check "index.html exists" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

FILESIZE=$(wc -c < "$HTML_FILE" | tr -d ' ')
check "index.html size ($FILESIZE bytes > 10KB)" "$([ "$FILESIZE" -gt 10000 ] && echo 'ok' || echo 'fail')"

# ---------- 2. Page count = 11 ----------
echo ""
echo "--- 2. Page count ---"
PAGE_COUNT=$(grep -c 'id="page-' "$HTML_FILE")
check "Exactly 11 pages (found: $PAGE_COUNT)" "$([ "$PAGE_COUNT" -eq 11 ] && echo 'ok' || echo 'fail')"

# ---------- 3. All pages have non-empty content ----------
echo ""
echo "--- 3. Each page has content ---"
ALL_CONTENT_OK=true
for page in dashboard backlog cron leadership games amazon cvjobs website system live files; do
    # Extract content between page divs (approx)
    # Look for the page opening div and check if it has child content
    LINE=$(grep -n "id=\"page-$page\"" "$HTML_FILE" | head -1 | cut -d: -f1)
    if [ -z "$LINE" ]; then
        echo "  ❌ Page '$page' not found"
        ALL_CONTENT_OK=false
        continue
    fi
    # Count chars between this page div and the next or /main
    TOTAL_LINES=$(wc -l < "$HTML_FILE")
    NEXT_PAGE_LINE=$(tail -n +$((LINE+1)) "$HTML_FILE" | grep -n 'id="page-\|</div><!-- \/main -->' | head -2 | tail -1 | cut -d: -f1)
    if [ -z "$NEXT_PAGE_LINE" ]; then
        NEXT_PAGE_LINE=$((TOTAL_LINES - LINE))
    fi
    END_LINE=$((LINE + NEXT_PAGE_LINE - 1))
    CONTENT_CHARS=$(sed -n "${LINE},${END_LINE}p" "$HTML_FILE" | wc -c | tr -d ' ')
    if [ "$CONTENT_CHARS" -lt 100 ]; then
        echo "  ❌ Page '$page' has insufficient content ($CONTENT_CHARS chars)"
        ALL_CONTENT_OK=false
    else
        echo "  ✅ Page '$page' has $CONTENT_CHARS chars"
    fi
done
check "All pages have sufficient content" "$([ "$ALL_CONTENT_OK" = "true" ] && echo 'ok' || echo 'fail')"

# ---------- 4. Nav items match pages ----------
echo ""
echo "--- 4. Nav items match pages ---"
NAV_PAGES=$(grep -o 'data-page="[a-z]*"' "$HTML_FILE" | sed 's/data-page="//;s/"//' | sort -u)
HTML_PAGES=$(grep -o 'id="page-[a-z]*"' "$HTML_FILE" | sed 's/id="page-//;s/"//' | sort -u)
if [ "$NAV_PAGES" = "$HTML_PAGES" ]; then
    check "Nav items match page IDs" "ok"
else
    echo "  NAV: $NAV_PAGES"
    echo "  HTML: $HTML_PAGES"
    check "Nav items match page IDs" "fail"
fi

# ---------- 5. No duplicate page IDs ----------
echo ""
echo "--- 5. No duplicate page IDs ---"
DUPS=$(grep -o 'id="page-[a-z]*"' "$HTML_FILE" | sort | uniq -d)
check "No duplicate page IDs" "$([ -z "$DUPS" ] && echo 'ok' || echo 'fail')"
if [ -n "$DUPS" ]; then
    echo "  Duplicates found: $DUPS"
fi

# ---------- 6. Required elements ----------
echo ""
echo "--- 6. Required elements ---"
grep -q 'Vue' "$HTML_FILE" || grep -q 'vue' "$HTML_FILE"
check "Vue.js referenced (live tasks)" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

grep -q 'marked.parse' "$HTML_FILE"
check "Markdown parser (marked.js)" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

grep -q 'RAW_BASE' "$HTML_FILE"
check "Raw GitHub base URL configured" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

grep -q 'sidebar' "$HTML_FILE"
check "Sidebar navigation exists" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

grep -q 'page-header' "$HTML_FILE"
check "Page headers present" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

grep -q 'md-viewer' "$HTML_FILE"
check "Markdown viewer modal exists" "$([ $? -eq 0 ] && echo 'ok' || echo 'fail')"

# ---------- 7. API server test ----------
echo ""
echo "
--- 9. HTML structure ---
  fi

--- 7. API server ---"
if command -v curl &>/dev/null; then
    API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:$SERVER_PORT/api/tasks 2>/dev/null)
    if [ "$API_STATUS" = "200" ]; then
        check "API server (port $SERVER_PORT) returns 200" "ok"
    else
        check "API server (port $SERVER_PORT) returns $API_STATUS" "fail"
    fi
else
    echo "  ⚠️ curl not available, skipping API test"
fi

# ---------- 8. Nginx test ----------
echo ""
echo "--- 8. Nginx ---"
if command -v curl &>/dev/null; then
    NGINX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:$NGINX_PORT/ 2>/dev/null)
    if [ "$NGINX_STATUS" = "200" ] || [ "$NGINX_STATUS" = "304" ]; then
        check "Nginx (port $NGINX_PORT) returns 200/304" "ok"
    else
        check "Nginx (port $NGINX_PORT) returns $NGINX_STATUS" "fail"
    fi
else
    echo "  ⚠️ curl not available, skipping Nginx test"
fi

# ---------- Summary ----------
echo ""
echo "========================================="
TOTAL=$((PASS + FAIL))
echo "📊 Results: $PASS/$TOTAL passed"
if [ "$FAIL" -eq 0 ]; then
    echo "🚀 ALL TESTS PASSED"
    exit 0
else
    echo "❌ $FAIL TEST(S) FAILED"
    exit 1
fi

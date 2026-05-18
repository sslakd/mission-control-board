#!/bin/bash
# update-dashboard.sh — Cập nhật data.json + deploy lên GitHub Pages
# Chạy tự động qua cron 23:00 hàng ngày

set -e
REPO_DIR="$HOME/.openclaw/workspace/mission-control-board"
DATA_FILE="$REPO_DIR/data.json"

cd "$REPO_DIR"

# === Cập nhật KDP ===
KDP_DIR="$HOME/Desktop/Openclaw/05_Amazon/KDP"
CHAPTER_COUNT=$(ls "$KDP_DIR"/chapter-*.md 2>/dev/null | wc -l | xargs)
WORDS_COUNT=$(cat "$KDP_DIR"/chapter-*.md 2>/dev/null | wc -w | xargs)
if [ -z "$CHAPTER_COUNT" ] || [ "$CHAPTER_COUNT" -eq 0 ]; then CHAPTER_COUNT=0; WORDS_COUNT=0; fi

# === Cập nhật YouTube ===
BATCH_FILE="$HOME/.openclaw/workspace/yt_batch.json"
YOUTUBE_TOTAL=$(ls ~/Desktop/quynhvideo/takeout-*.zip 2>/dev/null | wc -l | xargs)
if [ -f "$BATCH_FILE" ]; then
  ZIP_INDEX=$(python3 -c "import json; d=json.load(open('$BATCH_FILE')); print(d.get('zip_index',0))" 2>/dev/null || echo "0")
  ZIPS_PROCESSED=$(( (41 - YOUTUBE_TOTAL) ))
  [ $ZIPS_PROCESSED -lt 0 ] && ZIPS_PROCESSED=0
else
  ZIPS_PROCESSED=0
fi

# === Cập nhật data.json ===
python3 << PYEOF
import json, os, subprocess
from datetime import datetime, timezone, timedelta

tz = timezone(timedelta(hours=7))
now = datetime.now(tz).strftime("%Y-%m-%dT%H:%M:%S+07:00")

with open("$DATA_FILE") as f:
    data = json.load(f)

data["_updated"] = now

# KDP
data["kdp"]["chaptersDone"] = int("$CHAPTER_COUNT")
data["kdp"]["wordsWritten"] = int("$WORDS_COUNT")
data["kdp"]["sprintDaysDone"] = min(max(0, (datetime.now(tz) - datetime(2026, 5, 17, tzinfo=tz)).days), 14)

# Sprint progress %
sprint_progress = int(data["kdp"]["sprintDaysDone"] / 14 * 100)
data["kdp"]["percentComplete"] = sprint_progress

# YouTube
zips_processed_yt = int("$ZIPS_PROCESSED")
zips_total = data["youtube"]["zipsTotal"]
data["youtube"]["zipsProcessed"] = zips_processed_yt
data["youtube"]["percentComplete"] = int(zips_processed_yt / zips_total * 100) if zips_total > 0 else 0

# Estimate remaining videos (rough: ~5 videos per ZIP)
remaining_zips = zips_total - zips_processed_yt
data["youtube"]["videosRemaining"] = max(0, remaining_zips * 5)
# Upload ~25 videos/day quota
days_remaining = max(0, remaining_zips * 5 / 25)
if days_remaining > 0:
    eta = (datetime.now(tz) + timedelta(days=days_remaining)).strftime("%Y-%m-%d")
    data["youtube"]["eta"] = eta

if data["youtube"]["videosRemaining"] == 0:
    data["youtube"]["status"] = "Hoàn thành 🎉"
elif data["youtube"]["percentComplete"] > 50:
    data["youtube"]["status"] = "Đang chạy (>50%)"
else:
    data["youtube"]["status"] = "Đang chạy"

# Project sync
data["projects"][0]["progress"] = min(100, sprint_progress)
data["projects"][0]["status"] = "Đang viết" if int("$CHAPTER_COUNT") > 0 else "Chưa bắt đầu"

data["projects"][3]["progress"] = data["youtube"]["percentComplete"]
data["projects"][3]["status"] = "Hoàn thành 🎉" if data["youtube"]["videosRemaining"] == 0 else "Tự động"

with open("$DATA_FILE", "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"✅ Updated: KDP={data['kdp']['chaptersDone']}/{data['kdp']['chaptersTotal']} ch, YouTube={data['youtube']['percentComplete']}%")
PYEOF

# === Commit + Push lên GitHub ===
git add data.json
if git diff --cached --quiet; then
  echo "ℹ️  Không có thay đổi — skip commit"
else
  git commit -m "🔄 Dashboard update $(date '+%Y-%m-%d %H:%M')"
  git push origin main 2>&1 || echo "⚠️ Push failed — có thể cần auth"
  echo "✅ Committed + pushed"
fi

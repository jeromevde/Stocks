#!/bin/bash
# squash_by_day.sh
# Squash all commits on the same day into a single commit per day.
# USAGE: bash scripts/squash_by_day.sh <branch>

set -e

BRANCH=${1:-main}

git fetch origin "$BRANCH"
git checkout "$BRANCH"

tmp_branch="squash-by-day-tmp-$(date +%s)"
git checkout -b "$tmp_branch"

git log --reverse --pretty=format:'%H %ad' --date=short "$BRANCH" > /tmp/commits_by_day.txt

last_date=""
commits=()

squash_and_commit() {
  if [ ${#commits[@]} -eq 0 ]; then return; fi
  base_commit=${commits[0]}
  git reset --soft "$base_commit^"
  msg="Squashed commits for $last_date"
  git commit -m "$msg"
  commits=()
}

while read -r line; do
  commit=$(echo "$line" | awk '{print $1}')
  date=$(echo "$line" | awk '{print $2}')
  if [ "$date" != "$last_date" ]; then
    squash_and_commit
    last_date="$date"
  fi
  commits+=("$commit")
done < /tmp/commits_by_day.txt

squash_and_commit

git branch -M "$BRANCH-squashed"
git push origin "$BRANCH-squashed" --force

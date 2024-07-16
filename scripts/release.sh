#! /bin/bash

# The title is in UTC ISO 8601 format eg `2022-11-05T11:49-07:00`
# This is so it is easily machine parseable and also sortable.
#
# The notes are in a purely human readable format eg `Mon Jul 15 18:21:54 AKDT 2024`
#
# The git tag can't have a colon in it, so we choose a format that is still
# easily machine parseable and also sortable.
gh release create "$(date -u '+%Y%m%d-%H%M%S')" \
    downloads/*.csv \
    --title "$(date -u -Iseconds)" \
    --notes "Data scraped on $(TZ='America/Anchorage' date)"
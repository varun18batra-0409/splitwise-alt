#!/usr/bin/env bash
# Test browsers on GitHub's machines: the system packages they need, then the
# browsers themselves. Both steps have hung for 15+ minutes on a fresh machine
# (apt waiting on a lock or a slow mirror; a stuck download), so every step has
# a time limit and a retry, and says how long it took.
# Usage: scripts/ci-browsers.sh chromium [webkit]
set -u
browsers="$*"
t0=$(date +%s)

# 1. System packages: the list Playwright needs, installed with apt directly so
#    apt can be told not to wait forever (lock, network).
pkgs=$(npx playwright install-deps --dry-run $browsers 2>/dev/null | grep -o 'no-install-recommends[^"]*' | head -1 | sed 's/no-install-recommends//')
APT="-o DPkg::Lock::Timeout=90 -o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -q"
if [ -n "$pkgs" ]; then
  sudo timeout 240 apt-get $APT update >/dev/null || echo "::warning::apt update was slow or failed; installing anyway"
  ok=""
  for i in 1 2; do
    if sudo timeout 420 env DEBIAN_FRONTEND=noninteractive apt-get $APT install -y --no-install-recommends $pkgs >/dev/null; then ok=1; break; fi
    echo "::warning::System packages attempt $i failed or hung, retrying"
  done
  [ -n "$ok" ] || { echo "::error::System packages for the test browsers could not be installed"; exit 1; }
else
  echo "::warning::Couldn't read the package list; using Playwright's installer"
  npx playwright install-deps $browsers || exit 1
fi
t1=$(date +%s)

# 2. The browsers (kept between runs by the cache step, so usually nothing to download).
ok=""
for i in 1 2 3; do
  if timeout 300 npx playwright install $browsers; then ok=1; break; fi
  echo "::warning::Browser download attempt $i failed or hung, retrying"
done
[ -n "$ok" ] || { echo "::error::Test browsers could not be downloaded"; exit 1; }
t2=$(date +%s)
echo "::notice title=Test browsers::system packages $((t1 - t0))s, browsers $((t2 - t1))s"

#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

FAILED=0

run_tests() {
  local name="$1"
  local dir="$2"
  shift 2

  echo -e "\n${CYAN}▶ Running ${name} tests...${NC}"
  if (cd "$dir" && npx vitest run "$@"); then
    echo -e "${GREEN}✔ ${name} tests passed${NC}"
  else
    echo -e "${RED}✘ ${name} tests failed${NC}"
    FAILED=1
  fi
}

echo "═══════════════════════════════════════"
echo " PawsitiveMileage — Unit Test Suite"
echo "═══════════════════════════════════════"

run_tests "API"      api
run_tests "Frontend" web

echo ""
echo "═══════════════════════════════════════"
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN} ✔ All test suites passed${NC}"
else
  echo -e "${RED} ✘ One or more test suites failed${NC}"
  exit 1
fi

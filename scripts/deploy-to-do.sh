#!/usr/bin/env bash
# one-shot deployment script for DigitalOcean droplet
set -euo pipefail

echo "Deploying fschchat on $(hostname)"
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file found. Copy .env.example to .env and edit values first."
  exit 1
fi

# Ensure docker compose plugin exists
if ! command -v docker >/dev/null; then
  echo "docker is required. install docker first"
  exit 1
fi

if ! command -v docker-compose >/dev/null && ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required. install docker compose plugin."
  exit 1
fi

# Build and run production stack
docker compose -f docker-compose.prod.yml up -d --build

echo "Done!"

echo "Frontend: http://localhost/"
echo "Backend: http://localhost:5001/api/health"

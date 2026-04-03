#!/bin/bash

# Vercel Ignored Build Step
# Allow builds only for main and production.

if [[ "$VERCEL_GIT_COMMIT_REF" == "main" ]] || [[ "$VERCEL_GIT_COMMIT_REF" == "production" ]]; then
  echo "Building $VERCEL_GIT_COMMIT_REF"
  exit 1
else
  echo "Skipping build for branch: $VERCEL_GIT_COMMIT_REF"
  exit 0
fi

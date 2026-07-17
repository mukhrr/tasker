# Tasker proposal drafter — Node 22 + git + the Codex CLI.
FROM node:22-slim

# git: clone/refresh the Expensify/App checkout the drafter investigates.
# ca-certificates: HTTPS to GitHub/Supabase/Telegram/OpenAI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The Codex CLI is a thin npm launcher around a native binary.
RUN npm install -g @openai/codex

WORKDIR /app
COPY package.json ./
COPY drafter.mjs ./
COPY prompts ./prompts

# Persisted volume holds the repo clone and CODEX_HOME (auth.json is refreshed
# in place, so it must survive redeploys). Mount a Railway volume at /data.
ENV DATA_DIR=/data
ENV CODEX_HOME=/data/codex

CMD ["node", "drafter.mjs"]

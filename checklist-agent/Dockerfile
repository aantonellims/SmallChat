# Prebuilt environment: app + Copilot runtime (bundled with @github/copilot-sdk) + skills + MCP configuration, in one image.
# NOTE: written from the Copilot SDK docs but NOT built/tested in this repo's CI yet (no Docker on the dev machine).
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY skills ./skills
COPY checklist.md checklist-extra.md ./

# Runtime data (Copilot state) lives outside the image; mount a volume here to keep sessions across restarts.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    COPILOT_APP_HOME=/data/copilot-home
RUN mkdir -p /data/copilot-home && chown -R node:node /data /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/me').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]

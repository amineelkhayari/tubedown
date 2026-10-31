FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY service/package.json service/package-lock.json ./
RUN npm ci
COPY service/tsconfig.json ./
COPY service/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ffmpeg ca-certificates tini \
    && python3 -m venv /opt/media \
    && /opt/media/bin/pip install --no-cache-dir 'yt-dlp[default]' \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/media/bin:${PATH}" \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data \
    NODE_ENV=production \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp \
    XDG_CONFIG_HOME=/tmp
WORKDIR /app
COPY --from=build --chown=node:node /build/node_modules ./node_modules
COPY --from=build --chown=node:node /build/dist ./dist
COPY --chown=node:node service/package.json ./
COPY --chown=node:node service/public ./public
COPY LICENSE* ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

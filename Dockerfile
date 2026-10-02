# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY postcss.config.js vite.config.ts ./
COPY viteBrokerProxyAddress.ts viteTerminalPreload.ts viteWebEnv.ts viteWebRuntimeConfig.ts ./
COPY index.html ./
COPY public ./public
COPY src ./src
ARG VITE_MODE=web
RUN npm run "build:${VITE_MODE}"

FROM nginx:1.27-alpine AS runtime-base
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
COPY docker-inline-runtime-config.awk /etc/nginx/inline-runtime-config.awk
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh /etc/nginx/inline-runtime-config.awk && \
    chmod +x /docker-entrypoint.d/40-runtime-config.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# CI packages the exact website validated in this workflow run. BuildKit skips
# the independent Node build stage when this target is selected.
FROM runtime-base AS ci-runtime
COPY dist /usr/share/nginx/html
COPY dist/index.html /etc/nginx/rtx-index.template.html

# Keep a self-contained default target for local builds and external tooling.
FROM runtime-base AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/dist/index.html /etc/nginx/rtx-index.template.html

# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN --mount=type=bind,source=.,target=/context,readonly \
    if [ -f /context/.npmrc ]; then cp /context/.npmrc .npmrc; fi && \
    npm ci && \
    rm -f .npmrc

COPY . .
ARG VITE_MODE=web
RUN npm run "build:${VITE_MODE}"

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
COPY docker-inline-runtime-config.awk /etc/nginx/inline-runtime-config.awk
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /app/dist/index.html /etc/nginx/rtx-index.template.html
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh /etc/nginx/inline-runtime-config.awk && \
    chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

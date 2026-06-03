# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN --mount=type=bind,source=.npmrc,target=/tmp/.npmrc,required=false \
    if [ -f /tmp/.npmrc ]; then cp /tmp/.npmrc .npmrc; fi && \
    npm ci && \
    rm -f .npmrc

COPY . .
ARG VITE_MODE=web
RUN npm run "build:${VITE_MODE}"

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

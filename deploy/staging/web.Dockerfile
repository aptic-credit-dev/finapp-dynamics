# Aptic Dynamics staging web image: build the React/Vite app, serve it via nginx (proxying /api to the API).
# Build context is the repository root (npm workspaces monorepo). Non-production; synthetic data only.
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm --workspace @finapp/web run build

FROM nginx:alpine AS runtime
COPY deploy/staging/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

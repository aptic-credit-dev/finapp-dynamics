# Stage-7 NON-PRODUCTION staging image for apps/api. Provider-neutral; no cloud/provider baked in.
# Build context is the repository root (npm workspaces monorepo).
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=staging
WORKDIR /app
# Copy the built workspace (dist + node_modules + sources needed by the migrate/start scripts).
COPY --from=build /app ./
# Fail-closed defaults; no secrets baked into the image (supplied at runtime via --env-file).
USER node
EXPOSE 3000
# Apply migrations (superuser via DATABASE_URL), then start the API (kernel SET ROLEs to the app role).
CMD ["sh", "-c", "npm run migrate && node apps/api/dist/src/main.js"]

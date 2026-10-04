# syntax=docker/dockerfile:1
#
# ComplyTrack frontend — Vite/React build served by nginx.
#
# Build context is `frontend/`:
#
#     docker build -t complytrack-frontend ./frontend
#
# Stage 1 runs `npm ci && npm run build` and stage 2 serves `dist/` with the
# SPA fallback, the /api reverse proxy and the security headers in nginx.conf.

# --------------------------------------------------------------------------- #
# Stage 1 — build the static bundle
# --------------------------------------------------------------------------- #
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first so the layer is cached until the lockfile changes.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --------------------------------------------------------------------------- #
# Stage 2 — serve with nginx
# --------------------------------------------------------------------------- #
FROM nginx:alpine AS runtime

# Our server block replaces the stock default.conf, and the shared security
# headers snippet lives where nginx.conf includes it.
RUN rm -f /etc/nginx/conf.d/default.conf && mkdir -p /etc/nginx/snippets
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/complytrack-security-headers.conf

COPY --from=build /app/dist /usr/share/nginx/html

# nginx:alpine ships wget (busybox) — use it for the container healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

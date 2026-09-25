# Build context is the repository root (workspaces need protocol/).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --workspace protocol
COPY protocol protocol
COPY frontend frontend

# Dev target: Vite dev server with hot module replacement. Used by
# docker-compose.override.yml, which `docker compose watch` syncs source files into.
FROM deps AS dev
WORKDIR /app/frontend
EXPOSE 5173
CMD ["npx", "vite", "--host", "--port", "5173"]

FROM deps AS build
RUN npm run build -w frontend

# Prod target: static bundle behind nginx.
FROM nginx:1.27-alpine AS prod
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/docker-entrypoint.sh /docker-entrypoint.d/99-cockpit-config.sh
# Strip CR in case the repo was checked out with CRLF line endings (Windows).
RUN sed -i "s/\r$//" /docker-entrypoint.d/99-cockpit-config.sh /etc/nginx/conf.d/default.conf \
 && chmod +x /docker-entrypoint.d/99-cockpit-config.sh
EXPOSE 80

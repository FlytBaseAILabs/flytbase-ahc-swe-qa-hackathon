FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY backend/package.json backend/
RUN npm ci --omit=dev --workspace backend --workspace protocol
COPY protocol protocol
COPY backend backend
WORKDIR /app/backend
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]

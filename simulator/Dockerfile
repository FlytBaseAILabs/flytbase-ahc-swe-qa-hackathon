FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY protocol/package.json protocol/
COPY simulator/package.json simulator/
RUN npm ci --omit=dev --workspace simulator --workspace protocol
COPY protocol protocol
COPY simulator simulator
WORKDIR /app/simulator
EXPOSE 4100
CMD ["npx", "tsx", "src/index.ts"]

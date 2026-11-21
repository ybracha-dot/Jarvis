# Jarvis, for a server you control. Node 22.13 or newer is required (built-in SQLite).
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production JARVIS_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]

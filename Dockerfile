FROM node:22-alpine
RUN apk add --no-cache su-exec ffmpeg
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY public/ /app/public/
ENV PUBLIC_DIR=/app/public MEDIA_DIR=/data/media PORT=5010
EXPOSE 5010
# 以 root 启动只为修正挂载目录的属主，随后降权为 node 用户运行
CMD ["sh", "-c", "mkdir -p \"$MEDIA_DIR\" && chown -R node:node \"$MEDIA_DIR\" && exec su-exec node node src/index.js"]

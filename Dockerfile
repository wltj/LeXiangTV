FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates tzdata \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    DATA_DIR=/app/data \
    HOME=/app/data

WORKDIR /app
COPY dist/server.mjs /app/server.mjs
COPY dist/public /app/public
RUN chmod -R a+rX /app

EXPOSE 8099
CMD ["node", "/app/server.mjs"]
# Built with the REPO ROOT as the build context (see fly.toml's
# `[build] dockerfile`), because this is an npm workspace: the server
# depends on the sibling `shared` package and the install needs the root
# lockfile.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/package.json
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json

RUN npm ci

COPY shared ./shared
COPY server ./server

WORKDIR /app/server

ENV NODE_ENV=production
ENV SYNC_PORT=1234
ENV DATA_DIR=/data

EXPOSE 1234

CMD ["npm", "run", "start"]

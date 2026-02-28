FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

RUN npm run build -w @cmg/api

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "run", "start", "-w", "@cmg/api"]

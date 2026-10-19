FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci && npx prisma generate

# One-shot migration runner: the Prisma CLI is a dev dependency, so it lives
# here rather than in the service image.
FROM deps AS migrate
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/statements && chown -R node:node /data /app
USER node
EXPOSE 4001
CMD ["node", "dist/index.js"]

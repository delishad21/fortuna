FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY src ./src

# Build
RUN npm run build

RUN mkdir -p /data/statements && chown -R node:node /data /app
USER node

EXPOSE 4001

CMD ["npm", "start"]

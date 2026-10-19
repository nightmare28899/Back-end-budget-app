FROM node:22-alpine AS build

WORKDIR /app

# Prisma's postinstall generates the client; its schema and config must be present.
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --include=dev

COPY . .
RUN npm run build --ignore-scripts
RUN npm prune --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/src/main.js"]

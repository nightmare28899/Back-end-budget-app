# Use the official Node 22 image (which is v22.14+)
FROM node:22-alpine

WORKDIR /app

# Copy package files + Prisma schema/config before install (postinstall runs prisma generate)
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# Copy the rest of your code
COPY . .

# Generate Prisma Client (Crucial step!)
RUN npx prisma generate

# Build the application
RUN npm run build

# Expose the port (NestJS usually runs on 3000)
EXPOSE 3000

# Start the server
CMD ["npm", "run", "start"]
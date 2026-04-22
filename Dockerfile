# Stage 1: Build the application
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Run the application
FROM node:22-slim

WORKDIR /app

# Copy ONLY the bundle and necessary production files
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json ./

# Install only production dependencies
# node-canvas 3.x provides its own native binaries and shared libraries for Linux, 
# so we don't need to install libcairo2, libpango, etc. manually.
RUN npm install --omit=dev && rm -rf /root/.npm

ENTRYPOINT ["node", "/app/dist/index.cjs"]

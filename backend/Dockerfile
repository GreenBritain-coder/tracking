FROM node:20-slim

# Install Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including devDependencies for build)
# Use npm install since package-lock.json may not exist
# Ensure devDependencies are installed even if NODE_ENV=production is set
RUN npm install --production=false

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Set environment variable for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Start the application
CMD ["npm", "start"]


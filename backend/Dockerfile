FROM node:18-alpine

# Install only necessary packages for health checks
RUN apk add --no-cache wget

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies with production flag to reduce size
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Health check to ensure application is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run the application
CMD ["node", "main.js"]
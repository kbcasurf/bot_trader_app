FROM node:18-alpine

# Install build dependencies (needed for some npm packages)
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Install dependencies first to benefit from Docker cache
COPY package*.json ./
# Use verbose flag to get more debug info and increase timeout
RUN npm install --verbose --no-fund --no-audit --loglevel=verbose

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Run the application
CMD ["node", "main.js"]
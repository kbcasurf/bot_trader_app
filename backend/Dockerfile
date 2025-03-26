FROM node:20-alpine

WORKDIR /app

# Copy package.json first for better caching
COPY package*.json ./

# Use npm ci for more reliable installations with package-lock.json
RUN npm install -g npm@11.2.0

# Copy application source code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Set environment variables
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Use the Node.js script to wait for database and start the application
CMD ["node", "wait-for-db.js"]
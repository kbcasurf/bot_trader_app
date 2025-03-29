FROM node:18-alpine

WORKDIR /app

# Install dependencies first to benefit from Docker cache
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Run the application with explicit Node options
CMD ["node", "--max-http-header-size=16384", "main.js"]
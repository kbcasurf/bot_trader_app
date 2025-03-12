FROM node:16-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install
RUN npm install mysql2 cors helmet express-rate-limit dotenv --save

# Copy the rest of the application
COPY . .

# Expose the port the app runs on
EXPOSE 4000

# Command to run the application
CMD ["node", "server.js"]
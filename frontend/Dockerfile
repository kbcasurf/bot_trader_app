FROM node:18-alpine as build

WORKDIR /app

# Copy package files for layer caching
COPY package*.json ./

# Install minimal dependencies needed for build
RUN npm install

# Copy application code
COPY . .

# Build for production
RUN npm run build

FROM nginx:alpine
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Explicitly copy the images folder to ensure it's included
COPY images /usr/share/nginx/html/images

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
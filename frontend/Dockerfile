FROM node:18-alpine as build

WORKDIR /app

# Copy package files for layer caching
COPY package*.json ./

# Install minimal dependencies needed for build
RUN npm install

# Copy application code
COPY . .

# Build for production
# Add ARG for environment variables that can be passed at build time
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

RUN npm run build

FROM nginx:alpine

# Install bash for our script
RUN apk add --no-cache bash

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Explicitly copy the images folder to ensure it's included
COPY images /usr/share/nginx/html/images

# Create a startup script to replace environment variables in the HTML/JS files
COPY <<EOT /docker-entrypoint.sh
#!/bin/bash
set -e

# Replace environment variables in the main HTML and JS files at runtime
if [ -n "\$VITE_BACKEND_URL" ]; then
  echo "Configuring app to use backend at \$VITE_BACKEND_URL"
  find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s|http://localhost:3000|\$VITE_BACKEND_URL|g" {} \\;
fi

# Execute the main container command
exec "\$@"
EOT

RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
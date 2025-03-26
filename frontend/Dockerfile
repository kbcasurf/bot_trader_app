FROM node:16-alpine as build-stage
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# First, install all dependencies including dev dependencies
RUN npm install

# Explicitly install the missing plugins
RUN npm install --save-dev @vue/cli-plugin-babel@~5.0.8 \
    @vue/cli-plugin-eslint@~5.0.8 \
    @vue/cli-plugin-router@~5.0.8 \
    @vue/cli-plugin-vuex@~5.0.8

# Copy the rest of the application code
COPY . .

# Make sure the logos directory exists
RUN mkdir -p /app/src/assets/logos

# Build the app
RUN npm run build

# Production stage
FROM nginx:stable-alpine as production-stage
# Copy built files
COPY --from=build-stage /app/dist /usr/share/nginx/html
# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Expose port
EXPOSE 80
# Start nginx
CMD ["nginx", "-g", "daemon off;"]
FROM node:18-alpine as build
WORKDIR /app

# Install dependencies first to benefit from Docker cache
COPY package*.json ./
RUN npm install

# Copy ALL application code including images folder
COPY . .

# Build for production
RUN npm run build

FROM nginx:alpine
# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Explicitly copy the images folder to ensure it's included
COPY --from=build /app/images /usr/share/nginx/html/images

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
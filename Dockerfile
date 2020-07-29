FROM node:12

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built app
COPY ./dist/. .

# Run app
EXPOSE 8080
CMD [ "node", "app.js"]

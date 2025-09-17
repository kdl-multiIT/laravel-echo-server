# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci --ignore-scripts

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S echoserver -u 1001

# Change ownership of the app directory
RUN chown -R echoserver:nodejs /app
USER echoserver

# Expose the port
EXPOSE 6001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.LARAVEL_ECHO_SERVER_PORT || 6001) + '/socket.io/', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => { process.exit(1) })"

# Start the server
CMD ["node", "server.js"]
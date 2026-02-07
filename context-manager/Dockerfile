FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/
COPY index.ts ./

# Expose ports
EXPOSE 3847 3849

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3847/health || exit 1

# Start both servers
CMD ["sh", "-c", "bun run src/server.ts & bun run src/websocket-server.ts & wait"]

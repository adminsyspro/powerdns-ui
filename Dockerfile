# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time — runtime env alone
# never reaches the browser, so client-side feature gating (e.g. the SSL Certificates
# nav item, the Internal CA tab) needs these present during `next build`.
ARG NEXT_PUBLIC_CERTS_ENABLED=false
ARG NEXT_PUBLIC_INTERNAL_CA_ENABLED=false
ARG NEXT_PUBLIC_APP_URL=
ENV NEXT_PUBLIC_CERTS_ENABLED=$NEXT_PUBLIC_CERTS_ENABLED \
    NEXT_PUBLIC_INTERNAL_CA_ENABLED=$NEXT_PUBLIC_INTERNAL_CA_ENABLED \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Set correct permissions
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]

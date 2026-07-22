FROM oven/bun:1.3.13 AS docs-build

WORKDIR /app
COPY docs/package.json docs/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts --cache-dir=/root/.bun/install/cache
COPY docs ./
COPY CHANGELOG.md /CHANGELOG.md
RUN bun run postinstall
RUN bun run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=docs-build --chown=nextjs:nodejs /app/public ./public
COPY --from=docs-build --chown=nextjs:nodejs /app/index.md ./index.md
COPY --from=docs-build --chown=nextjs:nodejs /app/content ./content
COPY --from=docs-build --chown=nextjs:nodejs /app/.source ./.source
COPY --from=docs-build --chown=nextjs:nodejs /app/source.config.ts ./source.config.ts
COPY --from=docs-build --chown=nextjs:nodejs /CHANGELOG.md /CHANGELOG.md
COPY --from=docs-build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=docs-build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

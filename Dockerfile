# Refute: a static site plus a tiny Node file server. No npm dependencies.
# The site is configured at container start from environment variables,
# so one image works for any institution:
#   docker build -t refute .
#   docker run -p 8000:8000 --env-file .env refute
FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node . .

ENV HOST=0.0.0.0 \
    PORT=8000 \
    NODE_ENV=production

USER node
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["sh", "-c", "node scripts/build.mjs && node scripts/serve.mjs dist"]

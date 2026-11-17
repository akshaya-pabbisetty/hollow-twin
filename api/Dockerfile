# Hollow Twin backend (lane 1). There are no packages to install: the server uses Node built-ins only.
# Build from the REPOSITORY ROOT, so the image also gets the shared contract folder:
#   docker build -f api/Dockerfile -t hollow-twin-api .
FROM node:22-alpine
WORKDIR /app
COPY api ./api
# the block registry (70 blocks) that the API validates against
COPY contract ./contract

# PORT: where the server listens (hosts usually override it).
# DATA: the append-only data file. Mount a persistent volume at /data or it is lost when the container is replaced.
ENV PORT=8787 \
    DATA=/data/readings.jsonl

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "api/server.js"]

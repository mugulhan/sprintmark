FROM node:26.7.0-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:26.7.0-alpine AS vendor
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
RUN npm run build:vendor

FROM node:26.7.0-alpine
WORKDIR /app
ENV NODE_ENV=production \
    SPRINTMARK_DATA_DIR=/data \
    SPRINTMARK_HOST=0.0.0.0 \
    SPRINTMARK_PORT=4310
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=vendor /app/dist ./dist
COPY package.json ./
COPY src ./src
COPY public ./public
RUN addgroup -S sprintmark && adduser -S sprintmark -G sprintmark && mkdir -p /data && chown -R sprintmark:sprintmark /app /data
USER sprintmark
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]

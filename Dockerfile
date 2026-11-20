FROM node:26.12.1-bookworm-slim AS ocr-tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        imagemagick libmagickcore-6.q16-6-extra poppler-utils tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

FROM node:26.12.1-bookworm-slim AS build
WORKDIR /app
RUN npm install --global corepack@0.36.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile
COPY next.config.ts next-env.d.ts tsconfig.json ./
COPY src ./src
COPY public ./public
ENV LEDGERHARBOUR_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack pnpm build

FROM ocr-tools AS runtime
WORKDIR /app
ENV NODE_ENV=production OCR_PROVIDER=local-tesseract NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
CMD ["node", "server.js"]

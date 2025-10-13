FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

COPY src ./src
COPY webpack.config.js .babelrc ./

RUN pnpm run build

FROM node:18-alpine

RUN apk add --no-cache dcron curl

WORKDIR /app

ENV PORT=8880
ENV WEBUI=true
ENV WEBUI_PATH=dist

COPY package.json pnpm-lock.yaml ./

RUN npm install -g pnpm && \
    pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist

COPY app ./app
COPY index.js ./
COPY config.js ./
COPY scripts ./scripts

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8880

ENTRYPOINT ["/entrypoint.sh"]

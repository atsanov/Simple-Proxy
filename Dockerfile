FROM node:18-alpine
RUN apk add --no-cache wget ca-certificates
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "amd64" ]; then CF_ARCH="amd64"; \
    elif [ "$TARGETARCH" = "arm64" ]; then CF_ARCH="arm64"; \
    else CF_ARCH="amd64"; fi && \
    wget -q "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" \
      -O /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3300
CMD ["npm", "start"]
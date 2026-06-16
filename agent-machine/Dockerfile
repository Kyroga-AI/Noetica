FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json server.ts ./

RUN npm install --save-dev esbuild tsx typescript && \
    npm run build && \
    npm prune --omit=dev

EXPOSE 8080

CMD ["node", "dist/server.js"]

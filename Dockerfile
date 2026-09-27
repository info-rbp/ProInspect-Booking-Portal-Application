FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_PROINSPECT_LOGO_URL=""
ENV VITE_PROINSPECT_LOGO_URL=${VITE_PROINSPECT_LOGO_URL}

RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server.ts firebase-applet-config.json ./
COPY src ./src

EXPOSE 8080

USER node

CMD ["npm", "run", "start"]

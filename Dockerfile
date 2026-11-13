FROM node:24-slim
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/cuando-pasa.db
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
# Sin dependencias npm (hasta la Etapa 7): no hay `npm install`.
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]

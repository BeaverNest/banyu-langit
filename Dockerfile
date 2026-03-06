FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --production
RUN npm install -g nodemon

COPY server/ ./server/
COPY public/ ./public/

RUN mkdir -p /app/uploads /app/data
COPY data/investor_tags.xlsx ./data/investor_tags.xlsx

EXPOSE 3000

CMD ["node", "server/index.js"]

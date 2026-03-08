FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Dependencies layer (cached unless package.json changes)
COPY package.json ./
RUN npm install --production
RUN npm install -g nodemon

# App source (always fresh on rebuild)
COPY server/ ./server/
COPY public/ ./public/

# Data directory + default tags
RUN mkdir -p /app/uploads /app/data
COPY data/investor_tags.xlsx ./data/investor_tags.xlsx

# Config
COPY .env* ./

EXPOSE 3000

CMD ["node", "server/index.js"]

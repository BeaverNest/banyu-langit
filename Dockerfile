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
# NOTE: data/investor_tags.xlsx is gitignored and optional.
# The app auto-loads it only if present (see server/index.js), so no hard COPY.
# COPY data/investor_tags.xlsx ./data/investor_tags.xlsx

# Config
COPY .env* ./

EXPOSE 3000

CMD ["node", "server/index.js"]

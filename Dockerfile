FROM node:16-alpine

RUN apk add --no-cache wget build-base cmake git ffmpeg

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

CMD ["node", "build/index.js"]

FROM node

WORKDIR /app

COPY package.json .

RUN npm install --legacy-peer-deps

COPY . .

COPY .env.example .env

# RUN npm run gen-sk-addr
# RUN npm i ts-node

# RUN node --loader ts-node/esm src/util/generate-credentials.ts

# RUN npm run ts-node --esm src/util/generate-credentials.ts

EXPOSE 4884

CMD [ "npm", "start" ]
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./

# The swap UI currently needs legacy peer resolution and must skip Husky's
# postinstall hook when installed outside the repo root.
RUN npm install --ignore-scripts --legacy-peer-deps

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

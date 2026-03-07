FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./

# Explorer still resolves a few old CRA-era peer mismatches, so install with
# legacy peer resolution and skip Git hooks during image builds.
RUN npm install --ignore-scripts --legacy-peer-deps

COPY . .

ENV HOST=0.0.0.0
EXPOSE 8080

CMD ["npm", "start"]

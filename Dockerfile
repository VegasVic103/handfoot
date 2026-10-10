FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
# This default save path is ephemeral unless covered by persistent storage.
# If mounting a volume at /data, also set SAVE_FILE=/data/tables.json.
ENV SAVE_FILE=/app/tables.json

EXPOSE 3000
CMD ["node", "server.js"]

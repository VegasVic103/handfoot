FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
# Tables are saved here so a restart doesn't lose a game in progress.
# Mount a volume at /data if your host offers one; otherwise this is fine.
ENV SAVE_FILE=/app/tables.json

EXPOSE 3000
CMD ["node", "server.js"]

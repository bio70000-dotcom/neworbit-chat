FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
RUN mkdir -p /var/log/neworbit
EXPOSE 3010
ENV PORT=3010
ENV LOG_DIR=/var/log/neworbit
CMD ["node", "server.js"]

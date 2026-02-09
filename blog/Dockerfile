FROM node:20-alpine

WORKDIR /app

# 패키지 설치
COPY package.json .
RUN npm install --production

# 소스 복사
COPY . .

# 임시 디렉토리 생성
RUN mkdir -p /app/tmp

CMD ["node", "agent.js"]

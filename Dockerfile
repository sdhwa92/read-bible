# Node.js 18 Alpine 이미지 사용
FROM node:18-alpine

# 작업 디렉토리 설정
WORKDIR /app

# 타임존 설정을 위한 패키지 설치
RUN apk add --no-cache tzdata

# 타임존 설정 (브리즈번)
ENV TZ=Australia/Brisbane

# package.json과 package-lock.json 복사
COPY package*.json ./

# 의존성 설치 (프로덕션만)
RUN npm ci --only=production

# 소스 코드 복사
COPY . .

# 데이터 디렉토리 생성
RUN mkdir -p /app/data

# 볼륨 마운트 포인트 설정
VOLUME ["/app/data"]

# 헬스체크 (선택사항)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('OK')" || exit 1

# 봇 실행
CMD ["node", "src/bot.js"]

# 텔레그램 성경통독 봇

매일 자동으로 성경 구절을 전송하고 완독 현황을 추적하는 텔레그램 봇입니다.

## 주요 기능

- 📖 **자동 성경 구절 전송**: 매일 설정한 시간에 AWS S3에서 성경 구절 이미지를 가져와 그룹에 전송
- ✅ **완독 추적**: 사용자가 "완독", "완료", "통독" 등의 키워드를 입력하면 자동으로 기록
- 📊 **일일 통계**: 매일 자정에 완독률 계산 및 보고
- 📅 **월간 통계**: 매월 말일에 월간 통독 통계 자동 생성
- 🎊 **전체 통독 완료**: 모든 구절 전송 완료 시 전체 통독 통계 및 TOP 5 참여자 발표
- 🔧 **관리자 명령어**: 진행 상황 초기화, 건너뛰기, 테스트 전송 등

## 기술 스택

- **Runtime**: Node.js 18+
- **텔레그램 SDK**: Telegraf (Polling 방식)
- **스케줄링**: node-cron
- **Storage**: AWS S3
- **Database**: SQLite3
- **배포**: Docker + AWS EC2

## 설치 및 설정

### 1. 사전 요구사항

- Node.js 18 이상
- AWS 계정 (S3 사용)
- 텔레그램 봇 토큰

### 2. 프로젝트 클론

```bash
git clone <repository-url>
cd read-bible
```

### 3. 의존성 설치

```bash
npm install
```

### 4. 환경 변수 설정

`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 필요한 값을 입력합니다:

```bash
cp .env.example .env
```

`.env` 파일 내용:

```env
# 텔레그램 봇 설정
TELEGRAM_BOT_TOKEN=1234567890:ABCDefGHIjklMNoPQrsTUVwxYZ0987654321
TELEGRAM_GROUP_CHAT_ID=-1009876543210

# 관리자 사용자 ID (쉼표로 구분)
ADMIN_USER_IDS=123456789,987654321

# AWS S3 설정
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=ap-northeast-2
S3_BUCKET_NAME=your-bible-images-bucket

# 환경
NODE_ENV=production
```

### 5. 그룹 Chat ID 확인 방법

1. 봇을 텔레그램 그룹에 추가
2. 임시로 봇을 실행하고 그룹에서 `/start` 명령어 입력
3. 터미널 로그에서 Chat ID 확인
4. `.env` 파일에 Chat ID 입력

또는 [@userinfobot](https://t.me/userinfobot)을 그룹에 추가하면 Chat ID를 확인할 수 있습니다.

### 6. S3 버킷 설정

#### 버킷 생성

1. AWS Console에서 S3 버킷 생성
2. 버킷 이름을 `.env` 파일에 입력

#### 이미지 업로드

성경 구절 이미지를 다음 형식으로 업로드:

- `1_창세기1장.jpg`
- `2_창세기2장.jpg`
- `3_창세기3장.jpg`
- ...

**중요**: 파일명은 반드시 숫자로 시작해야 하며, 언더스코어(`_`) 뒤에 원하는 이름을 입력할 수 있습니다.

#### IAM 권한 설정

봇이 S3에 접근할 수 있도록 IAM 사용자에게 다음 권한 부여:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

### 7. 설정 파일 커스터마이징

`config/default.json` 파일에서 봇 동작을 커스터마이징할 수 있습니다:

```json
{
  "timezone": "Australia/Brisbane",
  "sendTime": "05:00",
  "completionReportTime": "23:59",
  "excludeDays": [0],
  "completionKeywords": ["완독", "완료", "통독", "ㅇㄷ"],
  "startDate": "2026-02-10",
  "startIndex": 1
}
```

**설정 옵션:**

- `timezone`: 시간대 (기본: 브리즈번)
- `sendTime`: 매일 성경 구절 전송 시간 (HH:mm 형식)
- `completionReportTime`: 완독률 보고 시간
- `excludeDays`: 제외할 요일 (0=일요일, 1=월요일, ...)
- `completionKeywords`: 완독으로 인식할 키워드 배열
- `startDate`: 통독 시작 날짜 (YYYY-MM-DD 형식, null이면 즉시 시작)
- `startIndex`: 시작 인덱스 (기본: 0, 특정 구절부터 시작하려면 해당 인덱스 입력)

**시작일 설정 예시:**

```json
// 즉시 시작 (첫 스케줄 시간부터)
{
  "startDate": null,
  "startIndex": 0
}

// 2026년 2월 10일부터 1번 구절부터 시작
{
  "startDate": "2026-02-10",
  "startIndex": 1
}

// 즉시 시작하되 50번 구절부터
{
  "startDate": null,
  "startIndex": 50
}
```

## 실행 방법

### 로컬 실행

```bash
# 일반 실행
npm start

# 개발 모드 (파일 변경 시 자동 재시작)
npm run dev
```

### Docker로 실행

```bash
# Docker 이미지 빌드
docker build -t bible-bot .

# 컨테이너 실행
docker run -d \
  --name bkpc-bible-bot \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  bible-bot

# 또는 docker-compose 사용
docker-compose up -d
```

### Docker 관리 명령어

```bash
# 로그 확인
docker-compose logs -f

# 컨테이너 재시작
docker-compose restart

# 컨테이너 중지
docker-compose down

# 컨테이너 중지 및 볼륨 삭제
docker-compose down -v
```

## 사용자 명령어

### 일반 사용자

- `/start` - 봇 소개 및 사용법
- `/status` - 현재 진행 상황 확인
- `/stats` - 최근 7일 완독률 통계
- `/monthly [년] [월]` - 월간 통독 통계 (예: `/monthly 2024 12`)
- `/overall` - 전체 통독 통계 (완료 후)
- `/mycount` - 내 완독 횟수 확인

### 완독 기록

그룹에서 다음 키워드 중 하나를 입력하면 자동으로 완독 기록됩니다:

- `완독`
- `완료`
- `통독`
- `ㅇㄷ`

**참고**: 봇은 조용히 기록만 하며, 즉시 응답하지 않습니다.

## 관리자 명령어

`.env` 파일의 `ADMIN_USER_IDS`에 등록된 사용자만 사용 가능:

- `/reset [index]` - 진행 상황을 특정 인덱스로 초기화 (통계는 보존, 예: `/reset 0`)
- `/hardreset CONFIRM [index]` - 모든 데이터 완전 초기화 (⚠️ 모든 완독 기록 및 통계 삭제)
  - 예: `/hardreset CONFIRM 0` - 모든 데이터 삭제 후 0번부터 시작
  - **주의**: 완독 기록, 일일/월간 통계, 전체 통독 통계가 모두 삭제됩니다
- `/skip` - 현재 인덱스를 하나 건너뛰기
- `/send [index]` - 특정 인덱스의 사진 즉시 전송 (테스트용, 예: `/send 1`)
- `/setstart [날짜] [인덱스]` - 시작일과 시작 인덱스 설정
  - 예: `/setstart 2026-02-10 1` - 2026년 2월 10일부터 1번 구절부터
  - 예: `/setstart 2026-02-10` - 2026년 2월 10일부터 (현재 인덱스 유지)
  - 예: `/setstart null 50` - 즉시 시작, 50번 구절부터
  - 예: `/setstart null` - 즉시 시작으로 변경
- `/test` - S3 연결 테스트
- `/scheduleinfo` - 스케줄러 정보 조회 (현재 시간, 다음 실행 시간 등)

## AWS EC2 배포

### 1. EC2 인스턴스 생성

- AMI: Ubuntu 22.04 LTS
- 인스턴스 타입: t2.micro (프리 티어)
- 보안 그룹: 아웃바운드 HTTPS(443) 허용

### 2. 서버 접속 및 Docker 설치

```bash
# 서버 접속
ssh -i your-key.pem ubuntu@your-ec2-ip

# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# Docker 설치
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Docker Compose 설치
sudo apt install docker-compose -y

# 사용자를 docker 그룹에 추가
sudo usermod -aG docker ubuntu
```

### 3. 프로젝트 배포

```bash
# 프로젝트 클론
git clone <repository-url>
cd read-bible

# .env 파일 생성 및 편집
nano .env

# Docker Compose로 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f
```

### 4. 자동 재시작 설정 (systemd)

`/etc/systemd/system/bible-bot.service` 파일 생성:

```ini
[Unit]
Description=Bible Reading Telegram Bot
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/read-bible
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

서비스 활성화:

```bash
sudo systemctl daemon-reload
sudo systemctl enable bible-bot
sudo systemctl start bible-bot
```

## 데이터베이스 백업

SQLite 데이터베이스는 `data/` 디렉토리에 저장됩니다.

### 수동 백업

```bash
# 로컬 백업
cp data/bible_reading.db data/bible_reading.db.backup

# S3에 백업 (선택사항)
aws s3 cp data/bible_reading.db s3://your-backup-bucket/backups/bible_reading_$(date +%Y%m%d).db
```

### 자동 백업 (cron)

```bash
# crontab 편집
crontab -e

# 매일 오전 3시에 백업
0 3 * * * cd /home/ubuntu/read-bible && aws s3 cp data/bible_reading.db s3://your-backup-bucket/backups/bible_reading_$(date +\%Y\%m\%d).db
```

## 프로젝트 구조

```
read-bible/
├── src/
│   ├── bot.js              # 봇 메인 로직 및 명령어 핸들러
│   ├── scheduler.js        # 스케줄링 (사진 전송, 완독률 보고)
│   ├── database.js         # SQLite 연동 (완독 기록 CRUD)
│   ├── s3Service.js        # AWS S3 연동 (이미지 다운로드)
│   ├── config.js           # 설정 로드 및 검증
│   └── utils.js            # 유틸리티 함수
├── config/
│   └── default.json        # 기본 설정 파일
├── data/
│   └── bible_reading.db    # SQLite 데이터베이스
├── .env                    # 환경 변수 (gitignore)
├── .env.example            # 환경 변수 템플릿
├── package.json            # 의존성 관리
├── Dockerfile              # Docker 이미지 빌드
├── docker-compose.yml      # Docker Compose 설정
└── README.md               # 사용 가이드
```

## 문제 해결

### 봇이 시작되지 않는 경우

1. `.env` 파일의 모든 환경 변수가 올바르게 설정되어 있는지 확인
2. S3 버킷에 이미지가 업로드되어 있는지 확인
3. IAM 권한이 올바르게 설정되어 있는지 확인
4. 로그 확인: `docker-compose logs -f`

### S3 연결 실패

- AWS 자격 증명 확인
- S3 버킷 이름 확인
- IAM 권한 확인
- 관리자 명령어 `/test`로 연결 테스트

### 스케줄이 실행되지 않는 경우

- 타임존 설정 확인 (`config/default.json`)
- 서버 시간 확인: `docker exec -it bkpc-daily-bible-bot date`
- cron 표현식 검증

### 데이터베이스 초기화

```bash
# 데이터베이스 백업 후 삭제
docker-compose down
rm data/bible_reading.db
docker-compose up -d
```

## 라이선스

MIT License

## 기여

버그 리포트나 기능 제안은 Issues를 통해 제출해주세요.

## 연락처

문의사항이 있으시면 텔레그램 그룹 관리자에게 문의해주세요.

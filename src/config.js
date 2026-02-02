import { config as dotenvConfig } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// .env 파일 로드
dotenvConfig();

// __dirname 설정 (ESM 환경)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// config/default.json 로드
const configPath = join(__dirname, '..', 'config', 'default.json');
const defaultConfig = JSON.parse(readFileSync(configPath, 'utf-8'));

// 환경 변수 검증
function validateEnv() {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_GROUP_CHAT_ID',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'S3_BUCKET_NAME'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`필수 환경 변수가 설정되지 않았습니다: ${missing.join(', ')}`);
  }
}

// 설정 검증
validateEnv();

// 통합 설정 객체
export const config = {
  // 환경 변수
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    groupChatId: process.env.TELEGRAM_GROUP_CHAT_ID,
    adminUserIds: process.env.ADMIN_USER_IDS 
      ? process.env.ADMIN_USER_IDS.split(',').map(id => parseInt(id.trim()))
      : []
  },
  
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
    s3BucketName: process.env.S3_BUCKET_NAME
  },
  
  // default.json 설정
  ...defaultConfig,
  
  // 추가 설정
  env: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production'
};

/**
 * 설정 파일 업데이트
 * @param {Object} updates - 업데이트할 설정 객체
 */
export async function updateConfig(updates) {
  const { writeFileSync } = await import('fs');
  
  // 현재 설정을 읽어서 병합
  const updatedConfig = {
    ...defaultConfig,
    ...updates
  };
  
  // config/default.json 파일에 저장
  writeFileSync(
    configPath,
    JSON.stringify(updatedConfig, null, 2),
    'utf-8'
  );
  
  // 메모리의 config 객체도 업데이트
  Object.assign(config, updates);
}

export default config;

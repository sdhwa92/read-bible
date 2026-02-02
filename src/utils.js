import { config } from './config.js';

/**
 * 오늘 날짜를 YYYY-MM-DD 형식으로 반환
 * @param {Date} date - 날짜 객체 (선택사항)
 * @returns {string} YYYY-MM-DD 형식의 날짜 문자열
 */
export function getTodayDate(date = new Date()) {
  // 브리즈번 시간대로 변환
  const options = { timeZone: config.timezone };
  const brisbaneDate = new Date(date.toLocaleString('en-US', options));
  
  const year = brisbaneDate.getFullYear();
  const month = String(brisbaneDate.getMonth() + 1).padStart(2, '0');
  const day = String(brisbaneDate.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * 날짜를 YYYY-MM-DD HH:mm:ss 형식으로 포맷
 * @param {Date|string} date - 날짜 객체 또는 문자열
 * @returns {string} 포맷된 날짜 문자열
 */
export function formatDate(date) {
  if (typeof date === 'string') {
    date = new Date(date);
  }
  
  if (!(date instanceof Date) || isNaN(date)) {
    return 'Invalid Date';
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 날짜를 간단한 형식으로 포맷 (YYYY년 MM월 DD일)
 * @param {Date|string} date - 날짜 객체 또는 문자열
 * @returns {string} 포맷된 날짜 문자열
 */
export function formatDateKorean(date) {
  if (typeof date === 'string') {
    date = new Date(date);
  }
  
  if (!(date instanceof Date) || isNaN(date)) {
    return 'Invalid Date';
  }
  
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  return `${year}년 ${month}월 ${day}일`;
}

/**
 * 현재 시간이 브리즈번 시간대 기준인지 확인
 * @returns {Date} 브리즈번 시간대의 현재 시간
 */
export function getBrisbaneTime() {
  const options = { timeZone: config.timezone };
  return new Date(new Date().toLocaleString('en-US', options));
}

/**
 * 파일명에서 인덱스 추출 (예: "1_창세기1장.jpg" -> 1)
 * @param {string} filename - 파일명
 * @returns {number} 추출된 인덱스 (실패 시 -1)
 */
export function extractIndexFromFilename(filename) {
  const match = filename.match(/^(\d+)_/);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * 숫자를 천 단위로 쉼표 구분
 * @param {number} num - 숫자
 * @returns {string} 포맷된 문자열
 */
export function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 백분율 계산
 * @param {number} part - 부분 값
 * @param {number} total - 전체 값
 * @param {number} decimals - 소수점 자릿수 (기본값: 1)
 * @returns {number} 백분율
 */
export function calculatePercentage(part, total, decimals = 1) {
  if (total === 0) return 0;
  return parseFloat(((part / total) * 100).toFixed(decimals));
}

/**
 * 사용자 ID가 관리자인지 확인
 * @param {number} userId - 텔레그램 사용자 ID
 * @returns {boolean} 관리자 여부
 */
export function isAdmin(userId) {
  return config.telegram.adminUserIds.includes(userId);
}

/**
 * 에러 로깅
 * @param {string} context - 에러 발생 컨텍스트
 * @param {Error} error - 에러 객체
 */
export function logError(context, error) {
  console.error(`[ERROR] ${context}:`, error.message);
  if (config.isDevelopment) {
    console.error(error.stack);
  }
}

/**
 * 정보 로깅
 * @param {string} message - 로그 메시지
 * @param {any} data - 추가 데이터 (선택사항)
 */
export function logInfo(message, data = null) {
  const timestamp = formatDate(new Date());
  console.log(`[INFO] ${timestamp} - ${message}`);
  if (data && config.isDevelopment) {
    console.log(data);
  }
}

/**
 * 디버그 로깅 (개발 환경에서만)
 * @param {string} message - 로그 메시지
 * @param {any} data - 추가 데이터 (선택사항)
 */
export function logDebug(message, data = null) {
  if (config.isDevelopment) {
    const timestamp = formatDate(new Date());
    console.log(`[DEBUG] ${timestamp} - ${message}`);
    if (data) {
      console.log(data);
    }
  }
}

/**
 * 비동기 함수 재시도
 * @param {Function} fn - 재시도할 함수
 * @param {number} retries - 재시도 횟수 (기본값: 3)
 * @param {number} delay - 재시도 간 지연 시간 (ms, 기본값: 1000)
 * @returns {Promise<any>} 함수 실행 결과
 */
export async function retry(fn, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      logDebug(`재시도 ${i + 1}/${retries}...`, { error: error.message });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * 안전한 JSON 파싱
 * @param {string} str - JSON 문자열
 * @param {any} defaultValue - 파싱 실패 시 기본값
 * @returns {any} 파싱된 객체 또는 기본값
 */
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (error) {
    logDebug('JSON 파싱 실패', { str, error: error.message });
    return defaultValue;
  }
}

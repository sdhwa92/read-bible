import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync } from "fs";
import { getTodayDate, logInfo, logError } from "./utils.js";
import { config } from "./config.js";

// __dirname 설정 (ESM 환경)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 데이터베이스 경로
const dbPath = join(__dirname, "..", "data", "bible_reading.db");

// data 디렉토리 생성
const dataDir = join(__dirname, "..", "data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// 데이터베이스 연결
const db = new Database(dbPath);
db.pragma("journal_mode = WAL"); // 성능 향상

/**
 * 데이터베이스 초기화 - 테이블 생성
 */
export function initializeDatabase() {
  logInfo("데이터베이스 초기화 시작...");

  // 진행 상황 추적 테이블 (각 레코드 = 하나의 통독 세션)
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      current_index INTEGER DEFAULT 0,
      last_sent_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 완독 기록 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT,
      first_name TEXT,
      date TEXT NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 일일 통계 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT UNIQUE NOT NULL,
      total_members INTEGER,
      completed_count INTEGER,
      completion_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 월간 통계 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      total_days INTEGER,
      reading_days INTEGER,
      total_completions INTEGER,
      average_rate REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year, month)
    )
  `);

  // 전체 통독 기록 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS overall_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_date TEXT,
      end_date TEXT,
      total_days INTEGER,
      total_readings INTEGER,
      total_completions INTEGER,
      average_rate REAL,
      top_participants TEXT,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 초기 진행 상황 레코드 생성 (없으면)
  const progressExists = db
    .prepare("SELECT COUNT(*) as count FROM progress")
    .get();
  if (progressExists.count === 0) {
    const startIndex = config.startIndex || 0;
    db.prepare(
      "INSERT INTO progress (current_index, last_sent_date) VALUES (?, NULL)"
    ).run(startIndex);
    logInfo(`초기 진행 상황 레코드 생성 완료 (시작 인덱스: ${startIndex})`);
  }

  logInfo("데이터베이스 초기화 완료");
}

// ==================== 진행 상황 관리 ====================

/**
 * 현재 진행 상황 조회 (최신 세션)
 */
export function getProgress() {
  return db.prepare("SELECT * FROM progress ORDER BY id DESC LIMIT 1").get();
}

/**
 * 현재 인덱스 조회
 */
export function getCurrentIndex() {
  const progress = getProgress();
  return progress ? progress.current_index : 0;
}

/**
 * 진행 상황 업데이트 (최신 세션)
 */
export function updateProgress(newIndex) {
  const today = getTodayDate();
  const currentProgress = getProgress();
  if (currentProgress) {
    db.prepare(
      "UPDATE progress SET current_index = ?, last_sent_date = ? WHERE id = ?"
    ).run(newIndex, today, currentProgress.id);
    logInfo(`진행 상황 업데이트: ${newIndex}`);
  }
}

/**
 * 진행 상황 초기화 (새로운 세션 생성)
 */
export function resetProgress(newIndex = 0) {
  db.prepare(
    "INSERT INTO progress (current_index, last_sent_date) VALUES (?, NULL)"
  ).run(newIndex);
  logInfo(`새로운 통독 세션 시작: 인덱스 ${newIndex}`);
  return db.prepare("SELECT last_insert_rowid() as id").get().id;
}

/**
 * 모든 데이터 완전 초기화 (통계 포함)
 * 주의: 모든 완독 기록과 통계가 삭제됩니다!
 */
export function hardResetAllData(newIndex = 0) {
  try {
    logInfo("⚠️  전체 데이터 초기화 시작...");

    // 트랜잭션으로 안전하게 처리
    const deleteAll = db.transaction(() => {
      // 모든 테이블 데이터 삭제
      db.prepare("DELETE FROM completions").run();
      db.prepare("DELETE FROM daily_stats").run();
      db.prepare("DELETE FROM monthly_stats").run();
      db.prepare("DELETE FROM overall_stats").run();

      // 모든 progress 레코드 삭제 후 새로 생성
      db.prepare("DELETE FROM progress").run();
      db.prepare(
        "INSERT INTO progress (current_index, last_sent_date) VALUES (?, NULL)"
      ).run(newIndex);

      logInfo("✅ 모든 테이블 데이터 삭제 완료");
    });

    deleteAll();

    logInfo(`✅ 전체 데이터 초기화 완료 (시작 인덱스: ${newIndex})`);
    return true;
  } catch (error) {
    logError("전체 데이터 초기화 실패", error);
    return false;
  }
}

// ==================== 완독 기록 관리 ====================

/**
 * 완독 기록 저장
 */
export function recordCompletion(
  userId,
  username,
  firstName,
  date = getTodayDate()
) {
  try {
    // 중복 체크
    const existing = db
      .prepare("SELECT id FROM completions WHERE user_id = ? AND date = ?")
      .get(userId, date);

    if (existing) {
      logInfo(`이미 완독 기록이 있습니다: 사용자 ${userId}, 날짜 ${date}`);
      return false;
    }

    // 새 기록 추가
    db.prepare(
      "INSERT INTO completions (user_id, username, first_name, date) VALUES (?, ?, ?, ?)"
    ).run(userId, username, firstName, date);

    logInfo(`완독 기록 저장: 사용자 ${username || userId}, 날짜 ${date}`);
    return true;
  } catch (error) {
    logError("완독 기록 저장 실패", error);
    return false;
  }
}

/**
 * 특정 날짜의 완독 횟수 조회
 */
export function getCompletionCount(date) {
  const result = db
    .prepare("SELECT COUNT(*) as count FROM completions WHERE date = ?")
    .get(date);
  return result ? result.count : 0;
}

/**
 * 특정 날짜의 완독자 목록 조회
 */
export function getCompletionsByDate(date) {
  return db
    .prepare("SELECT * FROM completions WHERE date = ? ORDER BY completed_at")
    .all(date);
}

/**
 * 상위 참여자 조회 (완독 횟수 순, 현재 세션 기준)
 */
export function getTopParticipants(limit = 5) {
  const currentProgress = getProgress();
  if (!currentProgress || !currentProgress.created_at) {
    return db
      .prepare(
        `
      SELECT 
        user_id,
        username,
        first_name,
        COUNT(*) as count
      FROM completions
      GROUP BY user_id
      ORDER BY count DESC
      LIMIT ?
    `
      )
      .all(limit);
  }
  
  // 현재 세션의 created_at 이후 완독 기록만 집계
  const sessionStartDate = currentProgress.created_at.split(' ')[0];
  return db
    .prepare(
      `
    SELECT 
      user_id,
      username,
      first_name,
      COUNT(*) as count
    FROM completions
    WHERE date >= ?
    GROUP BY user_id
    ORDER BY count DESC
    LIMIT ?
  `
    )
    .all(sessionStartDate, limit);
}

/**
 * 특정 사용자의 완독 횟수 조회 (현재 세션 기준)
 */
export function getUserCompletionCount(userId) {
  const currentProgress = getProgress();
  if (!currentProgress || !currentProgress.created_at) {
    const result = db
      .prepare("SELECT COUNT(*) as count FROM completions WHERE user_id = ?")
      .get(userId);
    return result ? result.count : 0;
  }
  
  // 현재 세션의 created_at 이후 완독 기록만 집계
  const sessionStartDate = currentProgress.created_at.split(' ')[0];
  const result = db
    .prepare(
      "SELECT COUNT(*) as count FROM completions WHERE user_id = ? AND date >= ?"
    )
    .get(userId, sessionStartDate);
  return result ? result.count : 0;
}

// ==================== 일일 통계 관리 ====================

/**
 * 일일 통계 저장
 */
export function saveDailyStats(
  date,
  totalMembers,
  completedCount,
  completionRate
) {
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO daily_stats (date, total_members, completed_count, completion_rate)
      VALUES (?, ?, ?, ?)
    `
    ).run(date, totalMembers, completedCount, completionRate);

    logInfo(`일일 통계 저장: ${date}, 완독률 ${completionRate}%`);
    return true;
  } catch (error) {
    logError("일일 통계 저장 실패", error);
    return false;
  }
}

/**
 * 특정 날짜의 통계 조회
 */
export function getDailyStats(date) {
  return db.prepare("SELECT * FROM daily_stats WHERE date = ?").get(date);
}

/**
 * 최근 N일의 통계 조회 (현재 세션 기준)
 */
export function getRecentDailyStats(days = 7) {
  const currentProgress = getProgress();
  if (!currentProgress || !currentProgress.created_at) {
    return db
      .prepare(
        `
      SELECT * FROM daily_stats 
      ORDER BY date DESC 
      LIMIT ?
    `
      )
      .all(days);
  }
  
  // 현재 세션의 created_at 이후 통계만 조회하되, 최근 N일로 제한
  const sessionStartDate = currentProgress.created_at.split(' ')[0];
  return db
    .prepare(
      `
    SELECT * FROM daily_stats 
    WHERE date >= ?
    ORDER BY date DESC 
    LIMIT ?
  `
    )
    .all(sessionStartDate, days);
}

/**
 * 전체 일일 통계 조회 (현재 세션 기준)
 */
export function getAllDailyStats() {
  const currentProgress = getProgress();
  if (!currentProgress || !currentProgress.created_at) {
    return db.prepare("SELECT * FROM daily_stats ORDER BY date").all();
  }
  
  // 현재 세션의 created_at 이후 통계만 조회
  const sessionStartDate = currentProgress.created_at.split(' ')[0]; // 'YYYY-MM-DD HH:MM:SS'에서 날짜만 추출
  return db
    .prepare("SELECT * FROM daily_stats WHERE date >= ? ORDER BY date")
    .all(sessionStartDate);
}

// ==================== 월간 통계 관리 ====================

/**
 * 월간 통계 계산 (현재 세션 기준)
 */
export function calculateMonthlyStats(year, month) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const currentProgress = getProgress();
  const sessionStartDate = currentProgress?.created_at?.split(' ')[0];

  let stats;
  
  if (sessionStartDate) {
    // 현재 세션 시작일과 월간 기간의 더 늦은 날짜를 시작점으로 사용
    const effectiveStartDate = startDate > sessionStartDate ? startDate : sessionStartDate;
    
    stats = db
      .prepare(
        `
      SELECT 
        COUNT(*) as reading_days,
        SUM(completed_count) as total_completions,
        AVG(completion_rate) as average_rate
      FROM daily_stats
      WHERE date >= ? AND date < ?
    `
      )
      .get(effectiveStartDate, endDate);
  } else {
    // 세션 정보가 없으면 기존 방식대로
    stats = db
      .prepare(
        `
      SELECT 
        COUNT(*) as reading_days,
        SUM(completed_count) as total_completions,
        AVG(completion_rate) as average_rate
      FROM daily_stats
      WHERE date >= ? AND date < ?
    `
      )
      .get(startDate, endDate);
  }

  if (!stats || stats.reading_days === 0) {
    return null;
  }

  // 해당 월의 총 일수 계산
  const daysInMonth = new Date(year, month, 0).getDate();

  return {
    reading_days: stats.reading_days,
    total_days: daysInMonth,
    total_completions: stats.total_completions || 0,
    average_rate: stats.average_rate
      ? parseFloat(stats.average_rate.toFixed(1))
      : 0,
  };
}

/**
 * 월간 통계 저장
 */
export function saveMonthlyStats(year, month, stats) {
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO monthly_stats 
      (year, month, total_days, reading_days, total_completions, average_rate)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      year,
      month,
      stats.total_days,
      stats.reading_days,
      stats.total_completions,
      stats.average_rate
    );

    logInfo(`월간 통계 저장: ${year}년 ${month}월`);
    return true;
  } catch (error) {
    logError("월간 통계 저장 실패", error);
    return false;
  }
}

/**
 * 월간 통계 조회
 */
export function getMonthlyStats(year, month) {
  return db
    .prepare("SELECT * FROM monthly_stats WHERE year = ? AND month = ?")
    .get(year, month);
}

/**
 * 전체 월간 통계 조회
 */
export function getAllMonthlyStats() {
  return db.prepare("SELECT * FROM monthly_stats ORDER BY year, month").all();
}

// ==================== 전체 통독 통계 관리 ====================

/**
 * 전체 통독 통계 저장
 */
export function saveOverallStats(stats) {
  try {
    db.prepare(
      `
      INSERT INTO overall_stats 
      (start_date, end_date, total_days, total_readings, total_completions, average_rate, top_participants)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      stats.start_date,
      stats.end_date,
      stats.total_days,
      stats.total_readings,
      stats.total_completions,
      stats.average_rate,
      stats.top_participants
    );

    logInfo("전체 통독 통계 저장 완료");
    return true;
  } catch (error) {
    logError("전체 통독 통계 저장 실패", error);
    return false;
  }
}

/**
 * 가장 최근 전체 통독 통계 조회
 */
export function getLatestOverallStats() {
  return db
    .prepare("SELECT * FROM overall_stats ORDER BY id DESC LIMIT 1")
    .get();
}

/**
 * 전체 통독 통계 목록 조회
 */
export function getAllOverallStats() {
  return db
    .prepare("SELECT * FROM overall_stats ORDER BY completed_at DESC")
    .all();
}

// ==================== 유틸리티 ====================

/**
 * 데이터베이스 연결 종료
 */
export function closeDatabase() {
  db.close();
  logInfo("데이터베이스 연결 종료");
}

/**
 * 데이터베이스 객체 반환 (고급 사용)
 */
export function getDatabase() {
  return db;
}

// 초기화 실행
initializeDatabase();

export default {
  initializeDatabase,
  getProgress,
  getCurrentIndex,
  updateProgress,
  resetProgress,
  recordCompletion,
  getCompletionCount,
  getCompletionsByDate,
  getTopParticipants,
  getUserCompletionCount,
  saveDailyStats,
  getDailyStats,
  getRecentDailyStats,
  getAllDailyStats,
  calculateMonthlyStats,
  saveMonthlyStats,
  getMonthlyStats,
  getAllMonthlyStats,
  saveOverallStats,
  getLatestOverallStats,
  getAllOverallStats,
  closeDatabase,
  getDatabase,
};

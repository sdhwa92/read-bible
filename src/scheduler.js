import cron from "node-cron";
import { config } from "./config.js";
import {
  getCurrentIndex,
  updateProgress,
  getCompletionCount,
  saveDailyStats,
  calculateMonthlyStats,
  saveMonthlyStats,
  getAllDailyStats,
  getTopParticipants,
  saveOverallStats,
  getProgress,
} from "./database.js";
import { getTotalImageCount, downloadImageByIndex } from "./s3Service.js";
import {
  getTodayDate,
  formatDateKorean,
  formatNumber,
  logInfo,
  logError,
} from "./utils.js";

let bot = null;
let schedules = {
  dailyReading: null,
  dailyReport: null,
  monthlyReport: null,
};

/**
 * 봇 인스턴스 설정
 * @param {Object} botInstance - Telegraf 봇 인스턴스
 */
export function setBot(botInstance) {
  bot = botInstance;
  logInfo("스케줄러에 봇 인스턴스 설정 완료");
}

/**
 * 일일 성경 구절 전송 스케줄
 * 월-토 오전 5시 (일요일 제외)
 */
export function scheduleDailyReading() {
  const [hour, minute] = config.sendTime.split(":");
  const cronExpression = `${minute} ${hour} * * 1-6`; // 월-토요일

  logInfo(`[스케줄러] 일일 성경 구절 전송 스케줄 등록`);
  logInfo(`  - 시간: ${config.sendTime} (월-토요일)`);
  logInfo(`  - Cron 표현식: ${cronExpression}`);
  logInfo(`  - 타임존: ${config.timezone}`);

  schedules.dailyReading = cron.schedule(
    cronExpression,
    async () => {
      try {
        const now = new Date();
        const nowStr = now.toLocaleString("ko-KR", {
          timeZone: config.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          weekday: "long",
        });

        logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        logInfo(`[일일 전송] 작업 시작 - ${nowStr}`);
        logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        // 시작 날짜 체크
        if (config.startDate) {
          const today = getTodayDate();
          const startDate = config.startDate;

          if (today < startDate) {
            logInfo(
              `⏳ 아직 시작일이 아닙니다. 시작일: ${startDate}, 현재: ${today}`
            );
            return;
          }
        }

        const currentIndex = getCurrentIndex();
        const totalCount = await getTotalImageCount();
        const nextIndex = currentIndex + 1;

        logInfo(
          `📊 현재 진행: ${currentIndex}/${totalCount} (다음: ${nextIndex})`
        );

        // 이미 모든 구절을 전송한 경우
        if (currentIndex >= totalCount) {
          logInfo("✅ 모든 성경 구절 전송 완료");
          return;
        }

        // 다음 이미지 다운로드
        logInfo(`⬇️  인덱스 ${nextIndex} 이미지 다운로드 중...`);
        const imageData = await downloadImageByIndex(nextIndex);

        if (!imageData) {
          logError(
            "❌ 이미지 다운로드 실패",
            new Error(`인덱스 ${nextIndex}의 이미지를 찾을 수 없습니다.`)
          );
          return;
        }

        // 텔레그램으로 사진 전송
        logInfo(`📤 텔레그램으로 이미지 전송 중...`);
        await bot.telegram.sendPhoto(
          config.telegram.groupChatId,
          { source: imageData.buffer },
          {
            caption: `📖 오늘의 말씀 (${nextIndex}/${totalCount})\n\n${getTodayDate()}`,
          }
        );

        // 진행 상황 업데이트
        updateProgress(nextIndex);

        logInfo(`✅ 성경 구절 ${nextIndex}/${totalCount} 전송 완료!`);

        // 마지막 구절인 경우 전체 통독 완료 처리
        if (nextIndex === totalCount) {
          logInfo("🎊 전체 성경통독 완료! 통계 생성 예약");
          // 다음 날 전체 통계 보고
          setTimeout(() => generateAndSendOverallStats(), 1000 * 60 * 60 * 24); // 24시간 후
        }

        logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      } catch (error) {
        logError("❌ [일일 전송] 작업 실패", error);
      }
    },
    {
      timezone: config.timezone,
    }
  );
}

/**
 * 일일 완독률 보고 스케줄
 * 매일 23:59
 */
export function scheduleDailyReport() {
  const [hour, minute] = config.completionReportTime.split(":");
  const cronExpression = `${minute} ${hour} * * *`; // 매일

  logInfo(`[스케줄러] 일일 완독률 보고 스케줄 등록`);
  logInfo(`  - 시간: ${config.completionReportTime} (매일)`);
  logInfo(`  - Cron 표현식: ${cronExpression}`);
  logInfo(`  - 타임존: ${config.timezone}`);

  schedules.dailyReport = cron.schedule(
    cronExpression,
    async () => {
      try {
        const now = new Date();
        const nowStr = now.toLocaleString("ko-KR", {
          timeZone: config.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        logInfo(`[일일 보고] 작업 시작 - ${nowStr}`);
        logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        const today = getTodayDate();

        // 그룹 멤버 수 조회
        let totalMembers = 0;
        try {
          const chatMemberCount = await bot.telegram.getChatMemberCount(
            config.telegram.groupChatId
          );
          totalMembers = chatMemberCount - 1; // 봇 제외
        } catch (error) {
          logError("그룹 멤버 수 조회 실패", error);
          totalMembers = 0;
        }

        // 오늘의 완독 횟수
        const completedCount = getCompletionCount(today);

        // 완독률 계산
        const completionRate =
          totalMembers > 0
            ? ((completedCount / totalMembers) * 100).toFixed(1)
            : 0;

        // 통계 저장
        saveDailyStats(today, totalMembers, completedCount, completionRate);

        // 그룹에 보고
        const message =
          `📊 오늘의 통독 결과\n\n` +
          `날짜: ${today}\n` +
          `완독: ${completedCount}명 / ${totalMembers}명\n` +
          `완독률: ${completionRate}%`;

        await bot.telegram.sendMessage(config.telegram.groupChatId, message);

        logInfo(`✅ 일일 완독률 보고 완료: ${completionRate}%`);
        logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      } catch (error) {
        logError("❌ [일일 보고] 작업 실패", error);
      }
    },
    {
      timezone: config.timezone,
    }
  );
}

/**
 * 월간 통계 보고 스케줄
 * 매월 말일 23:55
 */
export function scheduleMonthlyReport() {
  // 매월 28-31일 23:55에 실행 (내일이 1일이면 월말)
  const cronExpression = "59 23 28-31 * *";

  logInfo(`[스케줄러] 월간 통계 보고 스케줄 등록`);
  logInfo(`  - 시간: 매월 말일 23:59`);
  logInfo(`  - Cron 표현식: ${cronExpression}`);
  logInfo(`  - 타임존: ${config.timezone}`);

  schedules.monthlyReport = cron.schedule(
    cronExpression,
    async () => {
      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        // 내일이 1일이면 오늘이 월말
        if (tomorrow.getDate() === 1) {
          const now = new Date();
          const nowStr = now.toLocaleString("ko-KR", {
            timeZone: config.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });

          logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          logInfo(`[월간 보고] 작업 시작 - ${nowStr}`);
          logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

          const today = new Date();
          const year = today.getFullYear();
          const month = today.getMonth() + 1;

          // 월간 통계 계산
          const stats = calculateMonthlyStats(year, month);

          if (!stats) {
            logInfo(`${year}년 ${month}월 통계 데이터가 없습니다.`);
            return;
          }

          // 통계 저장
          saveMonthlyStats(year, month, stats);

          // 그룹에 보고
          const message =
            `📅 ${year}년 ${month}월 통독 결과\n\n` +
            `총 통독일: ${stats.reading_days}일\n` +
            `총 완독 횟수: ${formatNumber(stats.total_completions)}회\n` +
            `평균 완독률: ${stats.average_rate}%\n\n` +
            `🎉 ${month}월 수고하셨습니다!`;

          await bot.telegram.sendMessage(config.telegram.groupChatId, message);

          logInfo(`✅ 월간 통계 보고 완료: ${year}년 ${month}월`);
          logInfo(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        }
      } catch (error) {
        logError("❌ [월간 보고] 작업 실패", error);
      }
    },
    {
      timezone: config.timezone,
    }
  );
}

/**
 * 전체 통독 완료 통계 생성 및 전송
 */
export async function generateAndSendOverallStats() {
  try {
    logInfo("전체 통독 통계 생성 시작");

    const progress = getProgress();
    const startDate = progress.created_at || getTodayDate();
    const endDate = getTodayDate();

    // 전체 기간 통계 계산
    const allDailyStats = getAllDailyStats();
    const totalDays = allDailyStats.length;
    const totalReadings = await getTotalImageCount();
    const totalCompletions = allDailyStats.reduce(
      (sum, stat) => sum + stat.completed_count,
      0
    );
    const averageRate =
      totalDays > 0
        ? (
            allDailyStats.reduce((sum, stat) => sum + stat.completion_rate, 0) /
            totalDays
          ).toFixed(1)
        : 0;

    // 상위 참여자 조회 (완독 횟수 TOP 5)
    const topParticipants = getTopParticipants(5);
    const topList = topParticipants
      .map((p, idx) => {
        const name = p.first_name || p.username || `사용자${p.user_id}`;
        return `${idx + 1}. ${name}: ${p.count}회`;
      })
      .join("\n");

    // 전체 통계 메시지 전송
    const message =
      `🎊 축하합니다! 전체 성경통독을 완료하셨습니다! 🎊\n\n` +
      `📖 통독 기간\n` +
      `시작: ${formatDateKorean(startDate)}\n` +
      `종료: ${formatDateKorean(endDate)}\n` +
      `총 ${totalDays}일\n\n` +
      `📊 전체 통계\n` +
      `총 말씀 구절: ${formatNumber(totalReadings)}개\n` +
      `총 완독 횟수: ${formatNumber(totalCompletions)}회\n` +
      `평균 완독률: ${averageRate}%\n\n` +
      `🏆 완독왕 TOP 5\n${topList}\n\n` +
      `💝 모두 수고 많으셨습니다!`;

    await bot.telegram.sendMessage(config.telegram.groupChatId, message);

    // DB에 전체 통계 저장
    saveOverallStats({
      start_date: startDate,
      end_date: endDate,
      total_days: totalDays,
      total_readings: totalReadings,
      total_completions: totalCompletions,
      average_rate: parseFloat(averageRate),
      top_participants: JSON.stringify(topParticipants),
    });

    logInfo("전체 통독 통계 전송 완료");
  } catch (error) {
    logError("전체 통독 통계 생성 실패", error);
  }
}

/**
 * 스케줄러 정보 조회
 */
export function getScheduleInfo() {
  const now = new Date();
  const timezone = config.timezone;

  // 현재 시간 정보
  const currentTime = now.toLocaleString("ko-KR", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
  });

  const dayOfWeek = now.toLocaleDateString("ko-KR", {
    timeZone: timezone,
    weekday: "long",
  });

  // 스케줄 정보
  const [readingHour, readingMinute] = config.sendTime.split(":");
  const [reportHour, reportMinute] = config.completionReportTime.split(":");

  return {
    currentTime,
    timezone,
    dayOfWeek,
    schedules: {
      dailyReading: {
        time: config.sendTime,
        cronExpression: `${readingMinute} ${readingHour} * * 1-6`,
        days: "월-토요일",
        active: schedules.dailyReading !== null,
        startDate: config.startDate || "즉시 시작",
      },
      dailyReport: {
        time: config.completionReportTime,
        cronExpression: `${reportMinute} ${reportHour} * * *`,
        days: "매일",
        active: schedules.dailyReport !== null,
      },
      monthlyReport: {
        time: "23:59",
        cronExpression: "59 23 28-31 * *",
        days: "매월 말일",
        active: schedules.monthlyReport !== null,
      },
    },
  };
}

/**
 * 모든 스케줄 시작
 */
export function startAllSchedules() {
  logInfo("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  logInfo("📅 모든 스케줄러 시작");
  logInfo("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  scheduleDailyReading();
  scheduleDailyReport();
  scheduleMonthlyReport();

  const info = getScheduleInfo();
  logInfo(`⏰ 현재 시간: ${info.currentTime}`);
  logInfo(`🌏 타임존: ${info.timezone}`);
  logInfo("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

export default {
  setBot,
  scheduleDailyReading,
  scheduleDailyReport,
  scheduleMonthlyReport,
  generateAndSendOverallStats,
  startAllSchedules,
  getScheduleInfo,
};

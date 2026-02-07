import { Telegraf } from "telegraf";
import { config, updateConfig } from "./config.js";
import {
  getCurrentIndex,
  updateProgress,
  resetProgress,
  hardResetAllData,
  recordCompletion,
  getProgress,
  getRecentDailyStats,
  getMonthlyStats,
  getLatestOverallStats,
  getUserCompletionCount,
} from "./database.js";
import {
  getTotalImageCount,
  downloadImageByIndex,
  validateIndex,
  testS3Connection,
} from "./s3Service.js";
import {
  getTodayDate,
  isAdmin,
  formatNumber,
  logInfo,
  logError,
} from "./utils.js";
import {
  setBot,
  startAllSchedules,
  restartAllSchedules,
  getScheduleInfo,
} from "./scheduler.js";

// 봇 인스턴스 생성
const bot = new Telegraf(config.telegram.botToken);

// 스케줄러에 봇 인스턴스 전달
setBot(bot);

// ==================== 명령어 핸들러 ====================

/**
 * /start - 봇 소개 및 사용법
 */
bot.command("start", async (ctx) => {
  try {
    let message =
      `📖 성경통독 봇에 오신 것을 환영합니다!\n\n` +
      `이 봇은 매일 성경 구절을 자동으로 전송하고\n` +
      `여러분의 통독 현황을 추적합니다.\n\n` +
      `📌 사용법:\n` +
      `• 매일 통독후 "완독" 이라고 메세지를 올려주시면 완독으로 기록됩니다\n` +
      `• 매일 ${config.completionReportTime}에 완독률이 발표됩니다\n\n` +
      `💡 명령어:\n` +
      `/status - 현재 진행 상황\n` +
      `/stats - 최근 통독 통계\n` +
      `/monthly [년] [월] - 월간 통계\n` +
      `/overall - 전체 통독 통계\n` +
      `/mycount - 내 완독 횟수\n\n`;

    // 관리자에게만 관리자 명령어 안내
    if (isAdmin(ctx.from.id)) {
      message +=
        `🔧 관리자 명령어:\n` +
        `/reset [인덱스] - 진행 상황 초기화 (통계 보존)\n` +
        `/hardreset CONFIRM [인덱스] - 모든 데이터 완전 초기화\n` +
        `/skip - 하루 건너뛰기\n` +
        `/send [인덱스] - 특정 구절 즉시 전송\n` +
        `/setstart [날짜] [시간] [인덱스] - 시작일/시간/인덱스 설정\n` +
        `/test - S3 연결 테스트\n` +
        `/scheduleinfo - 스케줄러 정보 조회\n\n`;
    }

    message += `🙏 함께 성경통독을 완주해요!`;

    await ctx.reply(message);
    logInfo(`/start 명령어 실행: 사용자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/start 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다. 나중에 다시 시도해주세요.");
  }
});

/**
 * /status - 현재 진행 상황
 */
bot.command("status", async (ctx) => {
  try {
    const currentIndex = getCurrentIndex();
    const totalCount = await getTotalImageCount();
    const progress = getProgress();
    const percentage =
      totalCount > 0 ? ((currentIndex / totalCount) * 100).toFixed(1) : 0;

    let message = `📊 현재 진행 상황\n\n`;

    // 시작일 정보 표시
    if (config.startDate) {
      const today = getTodayDate();
      const startDate = config.startDate;

      if (today < startDate) {
        message += `⏰ 시작 예정일: ${startDate}\n`;
        message += `시작 인덱스: ${config.startIndex || 0}\n`;
        message += `상태: 시작 대기 중\n\n`;
      } else {
        message += `시작일: ${startDate}\n\n`;
      }
    }

    message += `진행: ${currentIndex} / ${totalCount} (${percentage}%)\n`;
    message += `마지막 전송일: ${progress.last_sent_date || "없음"}\n`;
    message += `남은 구절: ${totalCount - currentIndex}개`;

    await ctx.reply(message);
    logInfo(`/status 명령어 실행: 사용자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/status 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /stats - 최근 7일 완독률 통계
 */
bot.command("stats", async (ctx) => {
  try {
    const recentStats = getRecentDailyStats(7);

    if (recentStats.length === 0) {
      await ctx.reply("아직 통계 데이터가 없습니다.");
      return;
    }

    let message = `📈 최근 ${recentStats.length}일 통독 통계\n\n`;

    recentStats.reverse().forEach((stat) => {
      message += `${stat.date}: ${stat.completion_rate}% (${stat.completed_count}/${stat.total_members}명)\n`;
    });

    const avgRate = (
      recentStats.reduce((sum, s) => sum + s.completion_rate, 0) /
      recentStats.length
    ).toFixed(1);
    message += `\n평균 완독률: ${avgRate}%`;

    await ctx.reply(message);
    logInfo(`/stats 명령어 실행: 사용자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/stats 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /monthly - 월간 통계 조회
 */
bot.command("monthly", async (ctx) => {
  try {
    const args = ctx.message.text.split(" ").slice(1);
    const year = args[0] ? parseInt(args[0]) : new Date().getFullYear();
    const month = args[1] ? parseInt(args[1]) : new Date().getMonth() + 1;

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      await ctx.reply("올바른 형식으로 입력해주세요.\n예: /monthly 2024 12");
      return;
    }

    const stats = getMonthlyStats(year, month);

    if (!stats) {
      await ctx.reply(`${year}년 ${month}월 통계가 없습니다.`);
      return;
    }

    const message =
      `📅 ${year}년 ${month}월 통독 통계\n\n` +
      `총 통독일: ${stats.reading_days}일\n` +
      `총 완독 횟수: ${formatNumber(stats.total_completions)}회\n` +
      `평균 완독률: ${stats.average_rate}%`;

    await ctx.reply(message);
    logInfo(`/monthly 명령어 실행: 사용자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/monthly 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /overall - 전체 통독 통계 조회
 */
bot.command("overall", async (ctx) => {
  try {
    const stats = getLatestOverallStats();

    if (!stats) {
      await ctx.reply("아직 전체 통독을 완료하지 않았습니다.");
      return;
    }

    const topParticipants = JSON.parse(stats.top_participants);
    const topList = topParticipants
      .map((p, idx) => {
        const name = p.first_name || p.username || `사용자${p.user_id}`;
        return `${idx + 1}. ${name}: ${p.count}회`;
      })
      .join("\n");

    const message =
      `🎊 전체 성경통독 통계\n\n` +
      `📖 통독 기간\n` +
      `시작: ${stats.start_date}\n` +
      `종료: ${stats.end_date}\n` +
      `총 ${stats.total_days}일\n\n` +
      `📊 전체 통계\n` +
      `총 말씀 구절: ${formatNumber(stats.total_readings)}개\n` +
      `총 완독 횟수: ${formatNumber(stats.total_completions)}회\n` +
      `평균 완독률: ${stats.average_rate}%\n\n` +
      `🏆 완독왕 TOP 5\n${topList}`;

    await ctx.reply(message);
    logInfo(`/overall 명령어 실행: 사용자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/overall 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /mycount - 내 완독 횟수 조회
 */
bot.command("mycount", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const count = getUserCompletionCount(userId);
    const name = ctx.from.first_name || ctx.from.username || "님";

    await ctx.reply(`${name}의 완독 횟수: ${count}회`);
    logInfo(`/mycount 명령어 실행: 사용자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/mycount 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

// ==================== 관리자 명령어 ====================

/**
 * /reset - 진행 상황 초기화 (관리자 전용)
 */
bot.command("reset", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    const args = ctx.message.text.split(" ").slice(1);
    const newIndex = args[0] ? parseInt(args[0]) : 0;

    if (isNaN(newIndex) || newIndex < 0) {
      await ctx.reply("올바른 인덱스를 입력해주세요.\n예: /reset 0");
      return;
    }

    resetProgress(newIndex);
    await ctx.reply(
      `✅ 진행 상황이 ${newIndex}번으로 초기화되었습니다.\n\n💡 통계는 보존됩니다.`
    );
    logInfo(
      `/reset 명령어 실행: 관리자 ${
        ctx.from.username || ctx.from.id
      }, 인덱스 ${newIndex}`
    );
  } catch (error) {
    logError("/reset 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /hardreset - 모든 데이터 완전 초기화 (관리자 전용)
 * 주의: 모든 완독 기록과 통계가 삭제됩니다!
 */
bot.command("hardreset", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    const args = ctx.message.text.split(" ").slice(1);

    // 확인 단계: "CONFIRM"을 입력해야 실행
    if (args[0] !== "CONFIRM") {
      await ctx.reply(
        `⚠️  경고: 전체 데이터 초기화\n\n` +
          `이 명령어는 다음 데이터를 모두 삭제합니다:\n` +
          `• 모든 완독 기록\n` +
          `• 일일 통계\n` +
          `• 월간 통계\n` +
          `• 전체 통독 통계\n` +
          `• 진행 상황\n\n` +
          `정말로 실행하시려면:\n` +
          `/hardreset CONFIRM [인덱스]\n\n` +
          `예: /hardreset CONFIRM 0`
      );
      return;
    }

    const newIndex = args[1] ? parseInt(args[1]) : 0;

    if (isNaN(newIndex) || newIndex < 0) {
      await ctx.reply(
        "올바른 인덱스를 입력해주세요.\n예: /hardreset CONFIRM 0"
      );
      return;
    }

    // 전체 데이터 초기화 실행
    const success = hardResetAllData(newIndex);

    if (success) {
      await ctx.reply(
        `✅ 전체 데이터가 완전히 초기화되었습니다.\n\n` +
          `시작 인덱스: ${newIndex}\n` +
          `모든 통계가 삭제되었습니다.`
      );
      logInfo(
        `/hardreset 명령어 실행: 관리자 ${
          ctx.from.username || ctx.from.id
        }, 인덱스 ${newIndex}`
      );
    } else {
      await ctx.reply("❌ 데이터 초기화 중 오류가 발생했습니다.");
    }
  } catch (error) {
    logError("/hardreset 명령어 실패", error);
    await ctx.reply("❌ 오류가 발생했습니다.");
  }
});

/**
 * /skip - 현재 인덱스 건너뛰기 (관리자 전용)
 */
bot.command("skip", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    const currentIndex = getCurrentIndex();
    const newIndex = currentIndex + 1;

    updateProgress(newIndex);
    await ctx.reply(
      `✅ ${currentIndex}번 구절을 건너뛰고 ${newIndex}번으로 이동했습니다.`
    );
    logInfo(`/skip 명령어 실행: 관리자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/skip 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /setstart - 시작일, 전송 시간, 시작 인덱스 설정 (관리자 전용)
 */
bot.command("setstart", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    const args = ctx.message.text.split(" ").slice(1);

    if (args.length === 0) {
      await ctx.reply(
        "사용법:\n" +
          "/setstart [날짜] [시간] [인덱스]\n\n" +
          "예시:\n" +
          "/setstart 2026-02-10 05:00 1  - 2026년 2월 10일 오전 5시부터 1번 구절부터\n" +
          "/setstart 2026-02-10 05:00    - 2026년 2월 10일 오전 5시부터 (현재 인덱스 유지)\n" +
          "/setstart 2026-02-10          - 2026년 2월 10일부터 (현재 시간, 인덱스 유지)\n" +
          "/setstart null 08:00 50       - 즉시 시작, 오전 8시 전송, 50번 구절부터\n" +
          "/setstart null 08:00          - 시간만 변경 (즉시 시작)\n\n" +
          `현재 설정:\n` +
          `- 시작일: ${config.startDate || "즉시 시작"}\n` +
          `- 전송 시간: ${config.sendTime}\n` +
          `- 인덱스: ${config.startIndex || 0}`
      );
      return;
    }

    let startDate = args[0];
    let sendTime = args[1];
    let startIndex = args[2] ? parseInt(args[2]) : undefined;

    // 날짜 검증
    if (startDate === "null") {
      startDate = null;
    } else if (startDate) {
      // YYYY-MM-DD 형식 검증
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate)) {
        await ctx.reply(
          "❌ 날짜 형식이 올바르지 않습니다. YYYY-MM-DD 형식으로 입력해주세요.\n예: 2026-02-10"
        );
        return;
      }

      // 유효한 날짜인지 확인
      const date = new Date(startDate);
      if (isNaN(date.getTime())) {
        await ctx.reply("❌ 유효하지 않은 날짜입니다.");
        return;
      }
    }

    // 시간 검증
    if (sendTime && sendTime !== "null") {
      const timeRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
      if (!timeRegex.test(sendTime)) {
        await ctx.reply(
          "❌ 시간 형식이 올바르지 않습니다. HH:MM 형식으로 입력해주세요.\n예: 05:00, 08:30"
        );
        return;
      }
    } else if (sendTime === "null") {
      sendTime = undefined;
    }

    // 인덱스 검증
    if (args[2] === "null") {
      startIndex = undefined;
    } else if (startIndex !== undefined) {
      if (isNaN(startIndex) || startIndex < 0) {
        await ctx.reply("❌ 시작 인덱스는 0 이상의 숫자여야 합니다.");
        return;
      }
    }

    // 설정 업데이트
    const updates = {};
    if (startDate !== undefined) {
      updates.startDate = startDate;
    }
    if (startIndex !== undefined) {
      updates.startIndex = startIndex;
    }
    if (sendTime) {
      updates.sendTime = sendTime;
    }

    await updateConfig(updates);

    // 시작 인덱스가 설정되었으면 데이터베이스도 업데이트
    if (startIndex !== undefined) {
      updateProgress(startIndex);
      logInfo(`데이터베이스 진행 상황 업데이트: 인덱스 ${startIndex}`);
    }

    // 시간이 변경되었으면 스케줄러 재시작
    let needsRestart = false;
    if (sendTime) {
      needsRestart = true;
    }

    let message = "✅ 설정이 업데이트되었습니다.\n\n";
    if (startDate !== undefined) {
      message += `시작일: ${startDate || "즉시 시작"}\n`;
    }
    if (sendTime) {
      message += `전송 시간: ${sendTime} (월-토요일)\n`;
    }
    if (startIndex !== undefined) {
      message += `시작 인덱스: ${startIndex}\n`;
      message += `데이터베이스도 업데이트되었습니다.\n`;
    }

    if (needsRestart) {
      message += "\n⏳ 스케줄러를 재시작하는 중...";
      await ctx.reply(message);

      restartAllSchedules();

      await ctx.reply(
        "✅ 스케줄러가 재시작되어 변경사항이 즉시 적용되었습니다."
      );
    } else {
      message += "\n변경사항은 다음 스케줄부터 적용됩니다.";
      await ctx.reply(message);
    }

    logInfo(
      `/setstart 명령어 실행: 관리자 ${
        ctx.from.username || ctx.from.id
      }, 날짜=${startDate}, 시간=${sendTime}, 인덱스=${startIndex}`
    );
  } catch (error) {
    logError("/setstart 명령어 실패", error);
    await ctx.reply("❌ 설정 업데이트 중 오류가 발생했습니다.");
  }
});

/**
 * /send - 특정 인덱스의 사진 즉시 전송 (관리자 전용)
 */
bot.command("send", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    const args = ctx.message.text.split(" ").slice(1);
    const index = args[0] ? parseInt(args[0]) : null;

    if (!index || isNaN(index)) {
      await ctx.reply("인덱스를 입력해주세요.\n예: /send 1");
      return;
    }

    // 인덱스 검증
    const validation = await validateIndex(index);
    if (!validation.valid) {
      await ctx.reply(`❌ ${validation.message}`);
      return;
    }

    await ctx.reply(`⏳ 인덱스 ${index} 이미지를 다운로드 중...`);

    // 이미지 다운로드
    const imageData = await downloadImageByIndex(index);

    if (!imageData) {
      await ctx.reply(`❌ 인덱스 ${index}의 이미지를 찾을 수 없습니다.`);
      return;
    }

    // 사진 전송
    await ctx.replyWithPhoto(
      { source: imageData.buffer },
      { caption: `📖 테스트 전송: ${index}번 구절` }
    );

    logInfo(
      `/send 명령어 실행: 관리자 ${
        ctx.from.username || ctx.from.id
      }, 인덱스 ${index}`
    );
  } catch (error) {
    logError("/send 명령어 실패", error);
    await ctx.reply("오류가 발생했습니다.");
  }
});

/**
 * /test - S3 연결 테스트 (관리자 전용)
 */
bot.command("test", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    await ctx.reply("⏳ S3 연결을 테스트 중...");

    const success = await testS3Connection();

    if (success) {
      const totalCount = await getTotalImageCount();
      await ctx.reply(`✅ S3 연결 성공!\n📸 총 이미지: ${totalCount}개`);
    } else {
      await ctx.reply("❌ S3 연결 실패. 설정을 확인해주세요.");
    }

    logInfo(`/test 명령어 실행: 관리자 ${ctx.from.username || ctx.from.id}`);
  } catch (error) {
    logError("/test 명령어 실패", error);
    await ctx.reply("❌ 테스트 중 오류가 발생했습니다.");
  }
});

/**
 * /scheduleinfo - 스케줄러 정보 조회 (관리자 전용)
 */
bot.command("scheduleinfo", async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.reply("⛔ 관리자만 사용할 수 있는 명령어입니다.");
      return;
    }

    const info = getScheduleInfo();

    let message = `📅 스케줄러 정보\n\n`;
    message += `🕐 현재 서버 시간\n`;
    message += `${info.currentTime}\n`;
    message += `타임존: ${info.timezone}\n`;
    message += `요일: ${info.dayOfWeek}\n\n`;

    message += `📋 등록된 스케줄\n\n`;

    // 일일 말씀 전송
    const dr = info.schedules.dailyReading;
    message += `1️⃣ 일일 말씀 전송\n`;
    message += `   시간: ${dr.time} (${dr.days})\n`;
    message += `   상태: ${dr.active ? "✅ 활성" : "❌ 비활성"}\n`;
    message += `   시작일: ${dr.startDate}\n`;
    message += `   Cron: ${dr.cronExpression}\n\n`;

    // 일일 완독률 보고
    const drep = info.schedules.dailyReport;
    message += `2️⃣ 일일 완독률 보고\n`;
    message += `   시간: ${drep.time} (${drep.days})\n`;
    message += `   상태: ${drep.active ? "✅ 활성" : "❌ 비활성"}\n`;
    message += `   Cron: ${drep.cronExpression}\n\n`;

    // 월간 통계 보고
    const mr = info.schedules.monthlyReport;
    message += `3️⃣ 월간 통계 보고\n`;
    message += `   시간: ${mr.time} (${mr.days})\n`;
    message += `   상태: ${mr.active ? "✅ 활성" : "❌ 비활성"}\n`;
    message += `   Cron: ${mr.cronExpression}\n\n`;

    message += `💡 TIP: Docker 로그를 확인하여 스케줄러 실행 여부를 확인할 수 있습니다.`;

    await ctx.reply(message);
    logInfo(
      `/scheduleinfo 명령어 실행: 관리자 ${ctx.from.username || ctx.from.id}`
    );
  } catch (error) {
    logError("/scheduleinfo 명령어 실패", error);
    await ctx.reply("❌ 스케줄러 정보 조회 중 오류가 발생했습니다.");
  }
});

// ==================== 텍스트 메시지 핸들러 ====================

/**
 * 완독 키워드 감지
 */
bot.on("text", async (ctx) => {
  try {
    const text = ctx.message.text.trim();

    // 명령어는 무시
    if (text.startsWith("/")) {
      return;
    }

    // 완독 키워드 체크
    if (config.completionKeywords.includes(text)) {
      const userId = ctx.from.id;
      const username = ctx.from.username || null;
      const firstName = ctx.from.first_name || null;
      const today = getTodayDate();

      const recorded = recordCompletion(userId, username, firstName, today);

      if (recorded) {
        logInfo(`완독 기록: 사용자 ${username || userId}, 날짜 ${today}`);
        // 조용히 기록만 함 (응답 없음)
      }
    }
  } catch (error) {
    logError("텍스트 메시지 처리 실패", error);
  }
});

// ==================== 에러 핸들러 ====================

bot.catch((error, ctx) => {
  logError("봇 에러", error);
  console.error("Telegram API Error:", error);
});

// ==================== 봇 시작 ====================

async function startBot() {
  try {
    logInfo("봇 시작 중...");

    // S3 연결 테스트
    const s3Connected = await testS3Connection();
    if (!s3Connected) {
      logError("S3 연결 실패", new Error("S3 설정을 확인해주세요."));
      process.exit(1);
    }

    // 스케줄러 시작
    startAllSchedules();

    // 봇 실행 (Polling 방식)
    await bot.launch();

    logInfo("✅ 봇이 성공적으로 시작되었습니다!");
    logInfo(`봇 이름: @${bot.botInfo.username}`);
    logInfo(`그룹 Chat ID: ${config.telegram.groupChatId}`);

    // Graceful shutdown
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (error) {
    logError("봇 시작 실패", error);
    process.exit(1);
  }
}

// 봇 시작
startBot();

export default bot;

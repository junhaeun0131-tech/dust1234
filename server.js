/**
 * 로컬 개발 전용 서버 — Vercel CLI 없이 api/dust.js와 정적 파일을 함께 서빙한다
 * .env.local 파일에서 환경변수를 읽어 실제 Vercel 서버리스 함수와 동일하게 동작한다
 * 실행: node server.js  →  http://localhost:3000 으로 접속
 */

// Node.js 내장 모듈만 사용 (외부 패키지 설치 불필요)
const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── .env.local 파일을 직접 파싱해 환경변수에 주입 ──────────────────────
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8")
    .split("\n")
    .forEach((line) => {
      // 주석(#)과 빈 줄 건너뜀
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) return;
      // KEY=VALUE 형식으로 process.env에 등록
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    });
  console.log(".env.local 환경변수 로드 완료");
} else {
  console.warn(".env.local 파일을 찾지 못했습니다. AIRKOREA_KEY 환경변수를 직접 설정해주세요.");
}

// ── MIME 타입 매핑 (정적 파일 서빙용) ──────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
};

// ── 에어코리아 API 호출 헬퍼 (Promise 래퍼) ────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end",  () => resolve(body));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ── JSON 응답 헬퍼 ─────────────────────────────────────────────────────
function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

// ── /api/dust 핸들러 (api/dust.js 서버리스 함수와 동일한 로직) ──────────
async function handleApiDust(req, res) {
  // 쿼리스트링에서 sido 파싱
  const url  = new URL(req.url, "http://localhost");
  const sido = url.searchParams.get("sido") || "서울";

  // 환경변수에서 인증키 읽기
  const serviceKey = process.env.AIRKOREA_KEY;
  if (!serviceKey || serviceKey.includes("여기에_")) {
    return sendJson(res, 500, {
      error: true,
      message: ".env.local 의 AIRKOREA_KEY에 실제 인증키를 입력해주세요.",
    });
  }

  // API URL 조합 (디코딩 키를 encodeURIComponent로 감쌈)
  const apiUrl =
    "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty" +
    `?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&returnType=json` +
    `&sidoName=${encodeURIComponent(sido)}` +
    `&numOfRows=100&pageNo=1&ver=1.3`;

  try {
    const rawBody = await httpsGet(apiUrl);
    const trimmed = rawBody.trim();

    // XML 응답이면 인증키/요청값 오류
    if (trimmed.startsWith("<") || trimmed.startsWith("<?xml")) {
      return sendJson(res, 502, {
        error: true,
        message: "인증키 또는 요청값을 확인해주세요.",
        detail: trimmed.substring(0, 300),
      });
    }

    // JSON 파싱
    let parsed;
    try { parsed = JSON.parse(rawBody); }
    catch { return sendJson(res, 502, { error: true, message: "API 응답을 파싱할 수 없습니다." }); }

    // resultCode 확인 ('00' = 성공)
    const resultCode = parsed?.response?.header?.resultCode;
    if (resultCode !== "00") {
      const resultMsg = parsed?.response?.header?.resultMsg || "알 수 없는 오류";
      return sendJson(res, 502, { error: true, message: `API 오류: ${resultMsg} (코드: ${resultCode})` });
    }

    // 성공 — items 반환
    const items = parsed?.response?.body?.items || [];
    return sendJson(res, 200, { error: false, items });

  } catch (err) {
    return sendJson(res, 500, { error: true, message: `서버 내부 오류: ${err.message}` });
  }
}

// ── 정적 파일 핸들러 ───────────────────────────────────────────────────
function handleStatic(req, res) {
  // URL에서 경로만 추출 (쿼리스트링 제거)
  let urlPath = new URL(req.url, "http://localhost").pathname;

  // 루트("/") 요청은 index.html로 매핑
  if (urlPath === "/") urlPath = "/index.html";

  // 프로젝트 폴더 기준 절대경로 생성
  const filePath = path.join(__dirname, urlPath);

  // 파일 존재 여부 확인
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("404 Not Found");
  }

  // 확장자로 MIME 타입 결정
  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  // 파일을 읽어 응답
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": mime });
  res.end(content);
}

// ── HTTP 서버 생성 및 라우팅 ───────────────────────────────────────────
const PORT = 3000;
const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url, "http://localhost").pathname;
  console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ${req.method} ${req.url}`);

  // /api/dust 요청은 서버리스 핸들러로 위임
  if (urlPath === "/api/dust") {
    await handleApiDust(req, res);
  } else {
    // 그 외는 정적 파일 서빙
    handleStatic(req, res);
  }
});

// 서버 시작
server.listen(PORT, () => {
  console.log("──────────────────────────────────────────");
  console.log(`  🌫️  대기오염 정보 앱 로컬 서버 시작`);
  console.log(`  👉 http://localhost:${PORT}`);
  console.log("  종료: Ctrl+C");
  console.log("──────────────────────────────────────────");
});


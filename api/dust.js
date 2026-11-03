// Vercel 서버리스 함수 — 에어코리아 API를 서버에서 호출하고 결과를 클라이언트에 전달한다
// 인증키는 환경변수에서만 읽으며 코드에 절대 노출하지 않는다
// XML 오류 응답과 API 자체 오류 코드를 모두 한국어 메시지로 처리한다

// Node.js 내장 https 모듈로 외부 API 호출 (fetch 대신 — Vercel Node 런타임 호환)
const https = require("https");

// 에어코리아 측정밀도 조회 API 경로 (호스트 제외)
const API_PATH =
  "/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";

// 에어코리아 API 호스트
const API_HOST = "apis.data.go.kr";

/**
 * Node.js https 모듈을 Promise로 감싸 응답 본문 문자열을 반환하는 헬퍼 함수
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    // URL 객체로 파싱하여 https.get에 전달
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
    };

    const req = https.request(options, (res) => {
      let body = "";
      // 데이터 청크를 문자열로 누적
      res.on("data", (chunk) => { body += chunk; });
      // 응답 완료 시 누적된 본문 반환
      res.on("end", () => resolve(body));
    });

    // 네트워크 오류 발생 시 reject
    req.on("error", reject);
    req.end();
  });
}

/**
 * Vercel 서버리스 핸들러 함수 — GET /api/dust?sido=서울
 */
module.exports = async function handler(req, res) {
  // 쿼리 파라미터에서 sido를 읽고, 없으면 기본값 '서울' 사용
  const sido = req.query.sido || "서울";

  // 환경변수에서 인증키(디코딩 키) 읽기
  const serviceKey = process.env.AIRKOREA_KEY;

  // 환경변수가 설정되지 않은 경우 즉시 오류 반환
  if (!serviceKey) {
    return res.status(500).json({
      error: true,
      message: "서버 환경변수(AIRKOREA_KEY)가 설정되지 않았습니다.",
    });
  }

  // 디코딩 키를 URL에 포함할 때 encodeURIComponent로 인코딩
  const encodedKey = encodeURIComponent(serviceKey);

  // 시도 이름도 URL 인코딩 (한글 깨짐 방지)
  const encodedSido = encodeURIComponent(sido);

  // 최종 요청 URL 조합
  const apiUrl =
    `https://${API_HOST}${API_PATH}` +
    `?serviceKey=${encodedKey}` +
    `&returnType=json` +
    `&sidoName=${encodedSido}` +
    `&numOfRows=100` +
    `&pageNo=1` +
    `&ver=1.3`;

  try {
    // 외부 에어코리아 API 호출
    const rawBody = await httpsGet(apiUrl);

    // 응답이 XML로 시작하면 인증키/요청값 오류로 판단
    const trimmed = rawBody.trim();
    if (trimmed.startsWith("<") || trimmed.startsWith("<?xml")) {
      return res.status(502).json({
        error: true,
        message: "인증키 또는 요청값을 확인해주세요.",
        detail: trimmed.substring(0, 300), // 디버깅용 일부만 포함
      });
    }

    // JSON 파싱 시도
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      // JSON 파싱 실패 시 오류 반환
      return res.status(502).json({
        error: true,
        message: "API 응답을 파싱할 수 없습니다.",
      });
    }

    // API 내부 resultCode 확인 ('00'이 성공)
    const resultCode = parsed?.response?.header?.resultCode;
    if (resultCode !== "00") {
      const resultMsg = parsed?.response?.header?.resultMsg || "알 수 없는 오류";
      return res.status(502).json({
        error: true,
        message: `API 오류: ${resultMsg} (코드: ${resultCode})`,
      });
    }

    // 성공 — 측정소 데이터를 그대로 클라이언트에 전달
    const items = parsed?.response?.body?.items || [];
    return res.status(200).json({ error: false, items });

  } catch (err) {
    // 네트워크 오류 등 예기치 못한 예외 처리
    return res.status(500).json({
      error: true,
      message: `서버 내부 오류: ${err.message}`,
    });
  }
};


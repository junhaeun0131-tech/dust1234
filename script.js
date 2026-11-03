/* =============================================
   공기 신호등 — 프론트엔드 스크립트
   ============================================= */

// 서버리스 함수 엔드포인트 (인증키는 서버에서 관리)
const API_BASE_URL = "/api/dust";

/* ── 등급 메타데이터 ─────────────────────────────
   숫자 키: 1=좋음 / 2=보통 / 3=나쁨 / 4=매우나쁨 / 0=정보없음
   ─────────────────────────────────────────────── */
const GRADE_META = {
  1: { emoji: "🔵", label: "좋음",    css: "good",     guide: "" },
  2: { emoji: "🟢", label: "보통",    css: "normal",   guide: "" },
  3: { emoji: "🟠", label: "나쁨",    css: "bad",      guide: "외출 시 마스크를 챙기세요." },
  4: { emoji: "🔴", label: "매우나쁨", css: "very-bad", guide: "외출 시 마스크를 챙기세요." },
  0: { emoji: "⚪", label: "정보없음", css: "unknown",  guide: "" },
};

/* ── DOM 요소 참조 ──────────────────────────── */
// 지역 선택 드롭다운
const sidoSelect  = document.getElementById("sido-select");
// 공기 신호등 히어로 섹션
const heroSection = document.getElementById("hero-section");
// 히어로 이모지
const heroEmoji   = document.getElementById("hero-emoji");
// 히어로 등급 텍스트
const heroStatus  = document.getElementById("hero-status");
// 히어로 PM10 평균 수치
const heroPm10    = document.getElementById("hero-pm10");
// 히어로 안내 문구
const heroGuide   = document.getElementById("hero-guide");
// 측정소 카드 그리드
const cardsGrid   = document.getElementById("cards-grid");
// 로딩 래퍼
const loadingWrap = document.getElementById("loading-wrap");
// 오류 박스
const errorBox    = document.getElementById("error-box");
// 오류 메시지 텍스트
const errorMsg    = document.getElementById("error-message");

/* ── 유틸리티 함수 ───────────────────────────── */

/**
 * 측정값이 유효한 숫자인지 확인하는 함수
 * "-", 빈 값, null 등은 false 반환
 */
function isValidValue(val) {
  if (val === null || val === undefined || val === "" || val === "-") return false;
  return !isNaN(Number(val));
}

/**
 * 측정값을 화면 표시용 문자열로 변환하는 함수
 * 유효하지 않으면 "측정 안 됨" 반환
 */
function formatValue(val) {
  return isValidValue(val) ? String(val) : "측정 안 됨";
}

/**
 * 유효한 수치만 골라 평균을 계산하는 함수
 * 유효값이 하나도 없으면 "-" 반환
 */
function calcAverage(items, key) {
  const nums = items
    .map((it) => it[key])
    .filter((v) => isValidValue(v))
    .map(Number);
  if (nums.length === 0) return "-";
  return (nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(1);
}

/**
 * PM10 평균 수치로 대표 등급(1~4)을 계산하는 함수
 * 평균이 없으면 0(정보없음) 반환
 */
function gradeFromAvgPm10(avgStr) {
  if (avgStr === "-" || isNaN(avgStr)) return 0;
  const n = Number(avgStr);
  if (n <= 30)  return 1; // 좋음
  if (n <= 80)  return 2; // 보통
  if (n <= 150) return 3; // 나쁨
  return 4;               // 매우나쁨
}

/**
 * 등급 숫자로 카드 CSS 클래스명을 반환하는 함수
 * 알 수 없는 등급은 "unknown" 반환
 */
function gradeClass(grade) {
  return GRADE_META[Number(grade)]?.css ?? "unknown";
}

/**
 * 등급 숫자를 한글 레이블로 반환하는 함수
 */
function gradeLabel(grade) {
  return GRADE_META[Number(grade)]?.label ?? "정보없음";
}

/**
 * API 응답 dataTime 문자열을 한국어로 변환하는 함수
 * 입력: "2026-10-28 16:00"
 * 출력: "2026년 10월 28일 16시 기준"
 */
function formatDataTime(dateStr) {
  // 값이 없으면 빈 문자열 반환
  if (!dateStr) return "";
  const parts = dateStr.split(" ");
  if (parts.length < 2) return dateStr;
  // 날짜 부분 분리
  const [year, month, day] = parts[0].split("-").map(Number);
  // 시간 부분에서 시(hour)만 추출 (분은 생략)
  const hour = Number(parts[1].split(":")[0]);
  return `${year}년 ${month}월 ${day}일 ${hour}시 기준`;
}

/* ── UI 상태 제어 ────────────────────────────── */

/**
 * 로딩 스피너를 표시하거나 숨기는 함수
 */
function setLoading(visible) {
  loadingWrap.style.display = visible ? "flex" : "none";
}

/**
 * 오류 메시지를 표시하거나 숨기는 함수
 */
function setError(msg) {
  if (msg) {
    errorMsg.textContent = msg;
    errorBox.style.display = "flex";
  } else {
    errorBox.style.display = "none";
  }
}

/**
 * 히어로 섹션을 숨기고 카드 그리드를 초기화하는 함수
 */
function clearUI() {
  heroSection.style.display = "none";
  // 히어로 배경 클래스 모두 제거
  heroSection.className = "hero-section";
  cardsGrid.innerHTML = "";
}

/* ── 히어로 섹션 렌더링 ──────────────────────── */

/**
 * 지역 대표 등급과 평균 수치를 히어로 섹션에 채우는 함수
 */
function renderHero(grade, avgPm10) {
  const meta = GRADE_META[grade] ?? GRADE_META[0];

  // 이모지 삽입
  heroEmoji.textContent = meta.emoji;
  // 등급 텍스트 삽입
  heroStatus.textContent = meta.label;
  // 평균 수치 삽입 (없으면 "-")
  heroPm10.textContent = avgPm10 === "-" ? "-" : avgPm10;
  // 안내 문구 (나쁨·매우나쁨이면 마스크 안내, 나머지는 빈 문자열)
  heroGuide.textContent = meta.guide;

  // 등급별 배경 클래스 적용
  heroSection.className = `hero-section hero-${meta.css}`;
  heroSection.style.display = "block";
}

/* ── 카드 생성 ───────────────────────────────── */

/**
 * 측정소 데이터 하나로 카드 DOM 요소를 만들어 반환하는 함수
 */
function createStationCard(item) {
  // 등급 CSS 클래스 및 배지 정보 결정
  const gCss   = gradeClass(item.pm10Grade);
  const gLabel = gradeLabel(item.pm10Grade);

  // PM10 · PM2.5 표시 텍스트 결정
  const pm10Text = formatValue(item.pm10Value);
  const pm25Text = formatValue(item.pm25Value);

  // 측정 안 됨일 때 숫자 스타일 대신 회색 안내 텍스트 스타일 적용
  const pm10Class = isValidValue(item.pm10Value) ? "card-value-number" : "not-measured";
  const pm25Class = isValidValue(item.pm25Value) ? "card-value-number" : "not-measured";

  // 측정 시각을 한국어로 변환
  const timeStr = formatDataTime(item.dataTime);

  // 카드 div 생성
  const card = document.createElement("div");
  card.className = `station-card card-${gCss}`;

  // 카드 내부 HTML 구성
  card.innerHTML = `
    <!-- 카드 상단: 측정소 이름 + 등급 배지 -->
    <div class="card-header">
      <p class="card-station-name">${item.stationName}</p>
      <span class="card-grade-badge badge-${gCss}">${gLabel}</span>
    </div>

    <!-- 측정 시각 (한국어 형식) -->
    <p class="card-time">🕐 ${timeStr || "시각 정보 없음"}</p>

    <!-- 미세먼지 · 초미세먼지 수치 박스 -->
    <div class="card-values">
      <!-- PM10 수치 -->
      <div class="card-value-item">
        <p class="card-value-label">미세먼지 PM10</p>
        <p class="${pm10Class}">
          ${pm10Text}
          ${isValidValue(item.pm10Value) ? '<span class="card-value-unit"> ㎍/㎥</span>' : ""}
        </p>
      </div>
      <!-- PM2.5 수치 -->
      <div class="card-value-item">
        <p class="card-value-label">초미세먼지 PM2.5</p>
        <p class="${pm25Class}">
          ${pm25Text}
          ${isValidValue(item.pm25Value) ? '<span class="card-value-unit"> ㎍/㎥</span>' : ""}
        </p>
      </div>
    </div>
  `;

  return card;
}

/* ── API 호출 및 렌더링 메인 함수 ─────────────── */

/**
 * 선택된 시도로 /api/dust 를 호출하고 화면을 갱신하는 비동기 함수
 */
async function fetchAndRender(sidoName) {
  // 이전 화면 초기화 후 로딩 시작
  clearUI();
  setError(null);
  setLoading(true);

  // 시도 이름을 쿼리 파라미터로 전달 (인증키는 서버에서 처리)
  const params = new URLSearchParams({ sido: sidoName });

  try {
    // 서버리스 함수 호출
    const response = await fetch(`${API_BASE_URL}?${params.toString()}`);

    // HTTP 오류 처리 — 서버 JSON 메시지 우선 사용
    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      throw new Error(errData?.message || `HTTP 오류: ${response.status}`);
    }

    // JSON 파싱
    const data = await response.json();

    // 서버리스 함수에서 error 플래그가 세워진 경우
    if (data.error) {
      setError(data.message || "알 수 없는 오류가 발생했습니다.");
      return;
    }

    const items = data.items;

    // 데이터가 아예 없는 경우
    if (!items || items.length === 0) {
      setError("해당 지역의 측정 데이터가 없습니다.");
      return;
    }

    // PM10 평균 계산
    const avgPm10 = calcAverage(items, "pm10Value");

    // 평균값으로 지역 대표 등급 도출
    const repGrade = gradeFromAvgPm10(avgPm10);

    // 히어로 섹션 렌더링 (이모지 + 등급 + 수치 + 안내문)
    renderHero(repGrade, avgPm10);

    // 측정소 카드 목록 렌더링
    items.forEach((item) => {
      cardsGrid.appendChild(createStationCard(item));
    });

  } catch (err) {
    // 예외 발생 시 오류 메시지 표시
    console.error("API 호출 오류:", err);
    setError(`데이터를 불러오지 못했습니다. (${err.message})`);
  } finally {
    // 성공·실패 무관하게 로딩 스피너 숨김
    setLoading(false);
  }
}

/* ── 이벤트 바인딩 & 초기 실행 ───────────────── */

// 드롭다운 변경 시 해당 시도 데이터 재조회
sidoSelect.addEventListener("change", function () {
  fetchAndRender(this.value);
});

// 페이지 로드 즉시 기본 선택값으로 조회 시작
fetchAndRender(sidoSelect.value);

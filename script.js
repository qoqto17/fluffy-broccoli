/* =========================================================
   저메탄 사료 비교 진단 MVP (v2)
   - PRD 구현 범위: 농가 조건 입력 / 비용·영양·저감 근거 비교 / AI 맞춤 판단 리포트 / 피드백
   - 원칙: 근거 없는 수치는 만들어내지 않고 '확인 필요'로 표시,
           가설적 해석(장기 투자 관점)은 항상 '[미검증 가설/추가 검증 필요]'로 표시
   - 제외: 실제 사료 주문/결제, 실시간 메탄측정, 완전자동 배합비 확정,
           생산성 예측, 전국 농가 데이터 플랫폼
   ========================================================= */

// ------------------------------------------------------------
// [Google Sheets 연동 자리] - 선택 사용
// Apps Script 웹앱 URL을 채우면 입력값·결과·피드백이 시트에 저장됩니다.
// 비워두면 브라우저 데모로만 정상 동작합니다.
// ------------------------------------------------------------
const SHEETS_WEBAPP_URL = ""; // 예: "https://script.google.com/macros/s/xxxxx/exec"

function sendToSheets(payload) {
  if (!SHEETS_WEBAPP_URL) return;
  fetch(SHEETS_WEBAPP_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn("Sheets 저장 실패(데모 진행에는 영향 없음):", err);
  });
}

// ------------------------------------------------------------
// 화면 전환 유틸
// ------------------------------------------------------------
const screens = {
  landing: document.getElementById("screen-landing"),
  input: document.getElementById("screen-input"),
  result: document.getElementById("screen-result"),
  feedback: document.getElementById("screen-feedback"),
  done: document.getElementById("screen-done"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let sessionData = {};

// ------------------------------------------------------------
// 화면1: 축종 선택 → 화면2 입력 (사육단계 옵션 동적 구성)
// ------------------------------------------------------------
const STAGE_OPTIONS = {
  hanwoo: [
    { value: "growing", label: "육성기" },
    { value: "early_fattening", label: "비육 전기" },
    { value: "late_fattening", label: "비육 후기" },
  ],
  dairy: [
    { value: "lactating", label: "착유우" },
    { value: "dry", label: "건유우" },
    { value: "heifer", label: "미경산우" },
  ],
};

document.querySelectorAll(".species-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    sessionData.species = btn.dataset.species;
    const label = sessionData.species === "hanwoo" ? "한우 비육" : "젖소 착유";
    document.getElementById(
      "species-echo"
    ).textContent = `선택하신 축종: ${label}`;

    const stageSelect = document.getElementById("stage");
    stageSelect.innerHTML = '<option value="">선택해주세요</option>';
    STAGE_OPTIONS[sessionData.species].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      stageSelect.appendChild(o);
    });

    showScreen("input");
  });
});

// ------------------------------------------------------------
// 화면2: 후보 "기타" 선택 시 직접입력 필드 노출
// ------------------------------------------------------------
document.getElementById("candidate").addEventListener("change", (e) => {
  const wrap = document.getElementById("candidate-etc-wrap");
  if (e.target.value === "etc") {
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }
});

// ------------------------------------------------------------
// 화면2: 동의 체크 전 제출 버튼 비활성화
// ------------------------------------------------------------
const consentCheckbox = document.getElementById("consent");
const submitBtn = document.getElementById("btn-submit");

consentCheckbox.addEventListener("change", () => {
  submitBtn.disabled = !consentCheckbox.checked;
});

document.getElementById("farm-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!consentCheckbox.checked) return;

  sessionData.headcount = Number(document.getElementById("headcount").value);
  sessionData.stage = document.getElementById("stage").value;
  sessionData.currentFeed = document.getElementById("currentFeed").value;
  sessionData.feedCostInput = document.getElementById("feedCost").value
    ? Number(document.getElementById("feedCost").value)
    : null;
  sessionData.candidate = document.getElementById("candidate").value;
  sessionData.candidateEtc = document.getElementById("candidateEtc").value.trim();
  sessionData.region = document.getElementById("region").value.trim();
  sessionData.timestamp = new Date().toISOString();

  showScreen("result");
  runDemoComparison();
});

// ------------------------------------------------------------
// 화면3: 규칙 기반 비교 로직 (실제 AI 호출 없음 - 데모)
// 공식자료만 상수로 반영하고, 근거 없는 값은 '확인 필요'로 명시
// ------------------------------------------------------------
const OFFICIAL_DATA = {
  subsidyPerHeadYear2026: 5.5, // 만원/두/년, 농림축산식품부 2026 저메탄사료 급여 직불단가
  avgCompoundFeedPriceKrwPerKg2023: 578, // 원/kg, 배합사료 평균가격(2023)
  tmrCostReductionRateRef: 0.113, // 자가 TMR 시범사업 참고 절감률(농진청, 42개 농가 시범사업)
  reductionResearchNote:
    "국립축산과학원-에스씨바이오 기술이전 저메탄 소재(티아민이인산 계열)는 실험 조건에서 메탄 배출 18.3%~28~34% 감소가 보고됨(농촌진흥청, 2026). 상용 제품 가격·유통은 2026.5월 기준 미확정.",
};

function runDemoComparison() {
  const processingEl = document.getElementById("processing");
  const resultEl = document.getElementById("result-content");

  processingEl.classList.remove("hidden");
  resultEl.classList.add("hidden");

  setTimeout(() => {
    const compareRows = buildCompareRows(sessionData);
    const reportItems = buildAIReport(sessionData, compareRows);

    renderCompareTable(compareRows);
    renderAIReport(reportItems);

    sessionData.compareRows = compareRows;
    sessionData.reportItems = reportItems;

    processingEl.classList.add("hidden");
    resultEl.classList.remove("hidden");

    sendToSheets({ type: "result_viewed", ...sessionData });
  }, 1200);
}

function buildCompareRows(data) {
  // 현재 사료 월 비용: 사용자 입력값 우선, 없으면 공식 평균가 기반 개략 추정
  let currentMonthlyCost;
  let currentCostNote;
  if (data.feedCostInput) {
    currentMonthlyCost = `${data.feedCostInput}만원 (사용자 입력값)`;
    currentCostNote = "";
  } else {
    const estimated = Math.round(data.headcount * 15); // 두당 월 15만원 가정(2023 평균가 기반 개략치, 데모 단순화)
    currentMonthlyCost = `약 ${estimated}만원 (개략 추정)`;
    currentCostNote =
      "※ 실제 사료비를 입력하지 않아 2023년 배합사료 평균가격(578원/kg) 기준 개략 추정한 값입니다.";
  }

  const candidateLabel =
    data.candidate === "thiamin"
      ? "국산 저메탄 소재(티아민이인산 계열, 연구단계)"
      : data.candidateEtc || "직접 입력 후보(제품명 미기재)";

  return [
    {
      item: "예상 월 사료비",
      current: currentMonthlyCost + (currentCostNote ? `<br><span class="small-note">${currentCostNote}</span>` : ""),
      candidate:
        "확인 필요 — 해당 후보의 실제 판매가가 아직 공개되지 않음(연구·양산 준비 단계, 2026.5 기준)",
      candidateIsNA: true,
    },
    {
      item: "정부 지원금 적용 시",
      current: "해당 없음",
      candidate: `두당 연 ${OFFICIAL_DATA.subsidyPerHeadYear2026}만원 지원 가능(2026년 저탄소 농업프로그램 기준). 단, 인증·신청 조건 충족 여부는 확인 필요`,
      candidateIsNA: false,
    },
    {
      item: "영양조건 충족 여부",
      current: "확인 필요 — 현재 급여량 대비 사양표준 대조 자료 없음",
      candidate: "확인 필요 — 후보 제품의 영양성분표가 없어 사양표준 매칭 불가",
      candidateIsNA: true,
    },
    {
      item: "메탄저감 관련 근거",
      current: "해당 없음(일반 사료 기준 저감 근거 없음)",
      candidate: OFFICIAL_DATA.reductionResearchNote,
      candidateIsNA: false,
    },
    {
      item: "비교 후보",
      current: labelCurrentFeed(data.currentFeed),
      candidate: candidateLabel,
      candidateIsNA: false,
    },
  ];
}

function labelCurrentFeed(code) {
  const map = {
    compound: "일반 배합사료",
    tmr: "자가 TMR(섬유질배합사료)",
    mixed: "배합사료+조사료 혼합급여",
  };
  return map[code] || "확인 필요";
}

function renderCompareTable(rows) {
  const tbody = document.getElementById("compare-body");
  tbody.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const naClass = row.candidateIsNA ? ' class="na"' : "";
    tr.innerHTML = `
      <td><b>${row.item}</b></td>
      <td>${row.current}</td>
      <td${naClass}>${row.candidate}</td>
    `;
    tbody.appendChild(tr);
  });
}

function buildAIReport(data, rows) {
  return [
    `<b>① 예상 비용 차이:</b> 확인 필요 — 후보 제품의 판매가가 공개되지 않아 기존 사료 대비 정확한 비용 차이를 계산하지 않았습니다.`,
    `<b>② 영양조건 충족 여부:</b> 확인 필요 — 개별 제품의 영양성분표가 없어 사양표준 기준 충족 여부를 자동 판정하지 않았습니다.`,
    `<b>③ 확인된 저감 관련 근거:</b> ${OFFICIAL_DATA.reductionResearchNote}`,
    `<b>④ 정부 지원 적용 가능성:</b> 2026년 기준 두당 연 ${OFFICIAL_DATA.subsidyPerHeadYear2026}만원 지원 가능성이 있으나, 저탄소 인증·신청 절차 등 세부 조건 충족 여부는 확인이 필요합니다.`,
    `<b>⑤ 추가로 확인해야 할 사항:</b> 후보 제품의 실제 판매가·구매처, 영양성분표, 정책 지원 신청 자격 조건 3가지를 우선 확인하시길 권장합니다.`,
  ];
}

function renderAIReport(items) {
  const ol = document.getElementById("ai-report");
  ol.innerHTML = "";
  items.forEach((text) => {
    const li = document.createElement("li");
    li.innerHTML = text;
    ol.appendChild(li);
  });
}

// ------------------------------------------------------------
// 결과 → 피드백
// ------------------------------------------------------------
document.getElementById("btn-to-feedback").addEventListener("click", () => {
  showScreen("feedback");
});

// ------------------------------------------------------------
// 화면4: 피드백 (도움 정도 4점 + 부족했던 정보 1개)
// ------------------------------------------------------------
let selectedHelpfulness = null;
let selectedMissing = null;
const feedbackBtn = document.getElementById("btn-submit-feedback");

function checkFeedbackReady() {
  feedbackBtn.disabled = !(selectedHelpfulness && selectedMissing);
}

document.querySelectorAll("#choice-group .choice-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("#choice-group .choice-btn")
      .forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedHelpfulness = btn.dataset.value;
    checkFeedbackReady();
  });
});

document.querySelectorAll("#missing-group .choice-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("#missing-group .choice-btn")
      .forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedMissing = btn.dataset.value;
    checkFeedbackReady();
  });
});

feedbackBtn.addEventListener("click", () => {
  const feedbackText = document.getElementById("feedback-text").value.trim();

  const finalPayload = {
    type: "feedback_submitted",
    ...sessionData,
    helpfulness: selectedHelpfulness,
    missingInfo: selectedMissing,
    feedbackText: feedbackText,
    submittedAt: new Date().toISOString(),
  };

  sendToSheets(finalPayload);
  showScreen("done");
});

// ------------------------------------------------------------
// 완료 → 처음으로 (전체 상태 초기화)
// ------------------------------------------------------------
document.getElementById("btn-restart").addEventListener("click", () => {
  document.getElementById("farm-form").reset();
  submitBtn.disabled = true;
  document.getElementById("candidate-etc-wrap").classList.add("hidden");

  selectedHelpfulness = null;
  selectedMissing = null;
  feedbackBtn.disabled = true;
  document.getElementById("feedback-text").value = "";
  document
    .querySelectorAll(".choice-btn")
    .forEach((b) => b.classList.remove("selected"));

  sessionData = {};
  showScreen("landing");
});

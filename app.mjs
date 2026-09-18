const form = document.querySelector("#analyze-form");
const input = document.querySelector("#url-input");
const button = document.querySelector("#analyze-button");
const message = document.querySelector("#form-message");
const emptyState = document.querySelector("#empty-state");
const results = document.querySelector("#results");
const loginPanel = document.querySelector(".login-panel");
const loginButton = document.querySelector("#login-analyze-button");
const loginMessage = document.querySelector("#login-message");
const loggedResults = document.querySelector("#logged-results");
let urlRevision = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatNumber(value, suffix = "") {
  return value == null ? "未取得" : `${Number(value).toLocaleString("ja-JP")}${suffix}`;
}

function formatPercent(value) {
  return value == null ? "未計測" : `${(value * 100).toFixed(1)}%`;
}

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

function hideLoggedInView() {
  loginPanel.hidden = true;
  loggedResults.hidden = true;
}

function resetForNewUrl() {
  hideLoggedInView();
  results.hidden = true;
  emptyState.hidden = false;
  setMessage("");
}

function renderStrategy(strategy) {
  if (!strategy) return;
  const { positioning, portfolio, funnel, decision, actions = [] } = strategy;
  document.querySelector("#strategy-verdict").textContent = strategy.verdict;
  document.querySelector("#positioning-flag").textContent = positioning.flag;
  document.querySelector("#positioning-tribe").textContent = positioning.tribe;
  document.querySelector("#positioning-change").textContent = positioning.change;
  document.querySelector("#positioning-evidence").textContent = `根拠（公開情報）: ${positioning.evidence.join(" / ") || "不足"}`;

  document.querySelector("#portfolio-mix").innerHTML = portfolio.mix.map((item) => `<div class="mix-item"><span>${escapeHtml(item.name)}</span><strong>${formatNumber(item.count, "件")}</strong><small>${escapeHtml(item.meaning)}</small></div>`).join("");
  document.querySelector("#portfolio-observation").textContent = portfolio.observation;
  document.querySelector("#portfolio-interpretation").textContent = portfolio.interpretation;
  document.querySelector("#portfolio-evidence").textContent = `根拠（公開情報）: ${portfolio.evidence.join(" / ") || "不足"}`;

  document.querySelector("#decision-title").textContent = decision.title;
  document.querySelector("#decision-copy").textContent = decision.copy;
  document.querySelector("#decision-evidence").textContent = `根拠（公開情報）: ${decision.evidence.join(" / ")}`;
  document.querySelector("#decision-options").innerHTML = decision.options.map((option) => `<div class="decision-option"><h4>${escapeHtml(option.name)}</h4><p>${escapeHtml(option.detail)}</p><span>見る数字: ${escapeHtml(option.kpi)}</span></div>`).join("");

  document.querySelector("#funnel-hole").textContent = funnel.firstHole;
  document.querySelector("#funnel-why").textContent = funnel.why;
  document.querySelector("#funnel-stages").innerHTML = funnel.stages.map((stage) => `<div class="funnel-stage"><span>${escapeHtml(stage.name)}</span><strong class="${stage.status === "未計測" ? "unknown" : ""}">${stage.status === "未計測" ? "未計測" : formatNumber(stage.value, "")}</strong></div>`).join("");
  document.querySelector("#funnel-measurement").textContent = funnel.nextMeasurement;

  document.querySelector("#actions-list").innerHTML = actions.map((action) => `<article class="action-item">
    <div class="action-rank">${escapeHtml(action.rank)}</div>
    <div class="action-main">
      <h3>${escapeHtml(action.title)}</h3>
      <p>${escapeHtml(action.reason)}</p>
      <div class="action-meta">
        <span><b>根拠</b>${escapeHtml(action.evidence)}</span>
        <span><b>まず見る数字</b>${escapeHtml(action.kpi)}</span>
        <span><b>やり方</b>${escapeHtml(action.measurement)}</span>
        <span><b>見直しの目安</b>${escapeHtml(action.stop)}</span>
      </div>
    </div>
  </article>`).join("");

  document.querySelector("#strategy-guardrail").textContent = strategy.guardrail;
}

function render(data) {
  document.querySelector("#profile-name").textContent = data.profileName || data.pageTitle || "プロフィール";
  document.querySelector("#source-url").textContent = data.sourceUrl;
  document.querySelector("#fetched-at").textContent = `取得: ${new Date(data.fetchedAt).toLocaleString("ja-JP")}`;
  document.querySelector("#sales-total").textContent = formatNumber(data.salesTotal, "件");
  document.querySelector("#rating").textContent = formatNumber(data.rating);
  document.querySelector("#followers").textContent = formatNumber(data.followers, "人");
  document.querySelector("#service-count").textContent = formatNumber(data.serviceCountShown ?? data.services.length, "件");
  document.querySelector("#content-count").textContent = formatNumber(data.contentCountShown ?? data.contents.length, "件");
  document.querySelector("#service-badge").textContent = `${data.services.length}件取得`;
  renderStrategy(data.strategy);

  const body = document.querySelector("#services-body");
  body.innerHTML = data.services.length
    ? data.services.map((service) => `<tr>
        <td><a href="${escapeHtml(service.url)}" target="_blank" rel="noreferrer">${escapeHtml(service.title)}</a></td>
        <td>${formatNumber(service.priceYen, "円")}</td>
        <td>${formatNumber(service.salesCount, "件")}</td>
        <td>${formatNumber(service.rating)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4">公開サービスを取得できませんでした。</td></tr>`;

  document.querySelector("#public-next-step-title").textContent = "実績だけでは、売れ方までは分からない";
  document.querySelector("#public-next-step-copy").textContent = "公開ページで分かるのは、これまでの累計実績が中心です。見られていないのか、気になったけれど購入されていないのかは、ログイン後の数字で確認します。";
  document.querySelector("#public-next-step-number").textContent = "見られた回数・お気に入り・期間内の購入数";
  emptyState.hidden = true;
  results.hidden = false;
  loggedResults.hidden = true;
  loginPanel.hidden = false;
}

function renderLoggedInAnalysis(data) {
  const summary = data.summary || {};
  document.querySelector("#logged-period").textContent = data.period?.begin && data.period?.end
    ? `期間: ${data.period.begin}〜${data.period.end}`
    : `取得: ${new Date(data.capturedAt).toLocaleString("ja-JP")}`;
  document.querySelector("#logged-views").textContent = formatNumber(summary.totalViews, "回");
  document.querySelector("#logged-sales").textContent = formatNumber(summary.totalSales, "件");
  document.querySelector("#logged-favorites").textContent = formatNumber(summary.totalFavorites, "件");
  document.querySelector("#logged-revenue").textContent = formatNumber(summary.totalRevenue, "円");
  const serviceCount = summary.serviceCount ?? data.services.length;
  const measuredServiceCount = summary.measuredServiceCount ?? serviceCount;
  document.querySelector("#logged-service-badge").textContent = measuredServiceCount === serviceCount
    ? `${serviceCount}件`
    : `${measuredServiceCount}/${serviceCount}件の数字`;
  document.querySelector("#logged-diagnosis").textContent = data.diagnosis;
  document.querySelector("#logged-services-body").innerHTML = data.services.map((service) => `<tr>
    <td>${escapeHtml(service.title)}</td>
    <td>${formatNumber(service.views, "回")}</td>
    <td>${formatNumber(service.favorites, "件")}</td>
    <td>${formatNumber(service.sales, "件")}</td>
    <td>${formatPercent(service.cvr)}</td>
    <td><strong class="service-action-label">${escapeHtml(service.nextAction?.title || "確認する")}</strong><small class="service-action-detail">${escapeHtml(service.nextAction?.detail || "数字を確認してから次の変更を決めます。")}</small></td>
  </tr>`).join("");
  document.querySelector("#logged-actions").innerHTML = data.actions.map((action) => `<div class="logged-action"><strong>${escapeHtml(action.rank)}. ${escapeHtml(action.title)}</strong><p>${escapeHtml(action.reason)}</p><small>見る数字: ${escapeHtml(action.kpi)}<br>確認方法: ${escapeHtml(action.measurement)}</small></div>`).join("");
  document.querySelector("#logged-limitations").innerHTML = data.limitations.map((item) => `<div class="limitation">${escapeHtml(item)}</div>`).join("");
  emptyState.hidden = true;
  results.hidden = false;
  loginPanel.hidden = false;
  loggedResults.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = input.value.trim();
  if (!target) return;
  const requestRevision = urlRevision;
  hideLoggedInView();
  button.disabled = true;
  setMessage("公開ページを確認しています…");
  try {
    const response = await fetch(`/api/analyze?url=${encodeURIComponent(target)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "分析に失敗しました。");
    if (requestRevision !== urlRevision || input.value.trim() !== target) return;
    render(payload);
    setMessage("分析が完了しました。");
  } catch (error) {
    loginPanel.hidden = false;
    const friendlyMessage = error.message === "fetch failed"
      ? "ページを取得できませんでした。ネットワーク接続またはココナラ側の制限を確認してください。"
      : (error.message || "分析に失敗しました。");
    setMessage(friendlyMessage, "error");
  } finally {
    button.disabled = false;
  }
});

input.addEventListener("input", () => {
  urlRevision += 1;
  resetForNewUrl();
});

loginButton.addEventListener("click", async () => {
  const requestRevision = urlRevision;
  loginButton.disabled = true;
  loginMessage.className = "form-message";
    loginMessage.textContent = "ログイン後にしか見えない数字を確認しています…（20サービス前後で数分かかる場合があります）";
  try {
    const response = await fetch("/api/login-analyze", { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "ログイン後分析に失敗しました。");
    if (requestRevision !== urlRevision) return;
    renderLoggedInAnalysis(payload);
    loginMessage.textContent = "公開ページでは分からない数字の分析が完了しました。";
  } catch (error) {
    loginMessage.className = "form-message error";
    loginMessage.textContent = error.message === "fetch failed"
      ? "ログイン用ブラウザに接続できません。起動.cmd を実行してから、もう一度お試しください。"
      : (error.message || "ログイン後分析に失敗しました。");
  } finally {
    loginButton.disabled = false;
  }
});

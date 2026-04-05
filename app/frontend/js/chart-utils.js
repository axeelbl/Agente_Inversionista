const CHART_WIDTH = 1000;
const CHART_HEIGHT = 360;
const CHART_PADDING_X = 26;
const CHART_PADDING_Y = 26;
const FAST_SMA_PERIOD = 20;
const SLOW_SMA_PERIOD = 50;
const RSI_PERIOD = 14;

export function formatCurrency(value, currency, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "Dato no disponible";
    }

    const options = {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits > 0 ? Math.min(2, digits) : 0,
    };

    if (currency && /^[A-Z]{3}$/.test(currency)) {
        options.style = "currency";
        options.currency = currency;
    }

    return new Intl.NumberFormat("es-ES", options).format(Number(value));
}

export function formatPercent(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "Dato no disponible";
    }

    const numeric = Number(value);
    const prefix = numeric > 0 ? "+" : "";
    return `${prefix}${numeric.toFixed(digits)}%`;
}

export function formatCompactNumber(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return "Dato no disponible";
    }

    return new Intl.NumberFormat("es-ES", {
        notation: "compact",
        maximumFractionDigits: 1,
    }).format(Number(value));
}

export function getChartDirection(chart) {
    const change = chart?.summary?.change_percent ?? 0;
    if (change > 0) return "up";
    if (change < 0) return "down";
    return "flat";
}

export function getTechnicalSnapshot(chart) {
    const points = getNumericPoints(chart);
    if (points.length < 2) {
        return null;
    }

    const values = points.map((point) => Number(point.value));
    const recentPoints = points.slice(-Math.min(points.length, 20));
    const recentValues = recentPoints.map((point) => Number(point.value));
    const recentReturns = values
        .slice(1)
        .map((value, index) => {
            const previous = values[index];
            if (!previous) return 0;
            return ((value - previous) / previous) * 100;
        })
        .slice(-16);

    const smaFastSeries = calculateMovingAverage(values, FAST_SMA_PERIOD);
    const smaSlowSeries = calculateMovingAverage(values, SLOW_SMA_PERIOD);
    const smaFast = getLastDefinedValue(smaFastSeries);
    const smaSlow = getLastDefinedValue(smaSlowSeries);
    const lastPrice = values[values.length - 1];
    const firstPrice = values[0];
    const rsi = calculateRsi(values, RSI_PERIOD);
    const support = Math.min(...recentValues);
    const resistance = Math.max(...recentValues);
    const corridor = Math.max(resistance - support, 0.0001);
    const supportDistance = ((lastPrice - support) / lastPrice) * 100;
    const resistanceDistance = ((resistance - lastPrice) / lastPrice) * 100;
    const volatility = chart?.summary?.volatility ?? calculateVolatility(recentReturns);
    const trendScore = calculateTrendScore({
        lastPrice,
        firstPrice,
        smaFast,
        smaSlow,
        rsi,
        changePercent: chart?.summary?.change_percent ?? 0,
    });

    return {
        lastPrice,
        smaFast,
        smaSlow,
        rsi,
        volatility,
        support,
        resistance,
        supportDistance,
        resistanceDistance,
        pricePositionPercent: ((lastPrice - support) / corridor) * 100,
        trendScore,
        trendLabel: getTrendLabel(trendScore),
        structureLabel: getStructureLabel(lastPrice, smaFast, smaSlow),
        momentumBars: recentReturns,
        smaFastSeries,
        smaSlowSeries,
    };
}

export function buildChartSvg(chart, { compact = false } = {}) {
    const points = getNumericPoints(chart);
    if (points.length < 2) {
        return "";
    }

    const geometry = buildGeometry(points);
    const direction = getChartDirection(chart);
    const currency = chart.currency || chart?.asset?.currency;
    const chartId = sanitizeId(`${chart?.symbol || "chart"}-${chart?.range || "range"}-${compact ? "compact" : "full"}`);
    const snapshot = getTechnicalSnapshot(chart);
    const highLabel = formatCurrency(geometry.max, currency, compact ? 0 : 2);
    const lowLabel = formatCurrency(geometry.min, currency, compact ? 0 : 2);
    const startLabel = geometry.mapped[0]?.label || "";
    const endLabel = geometry.mapped[geometry.mapped.length - 1]?.label || "";
    const mainPath = buildPathFromMapped(geometry.mapped);
    const areaPath = buildAreaPath(geometry.mapped);
    const fastPath = snapshot ? buildIndicatorPath(snapshot.smaFastSeries, geometry) : "";
    const slowPath = snapshot ? buildIndicatorPath(snapshot.smaSlowSeries, geometry) : "";
    const supportY = snapshot ? geometry.yScale(snapshot.support) : null;
    const resistanceY = snapshot ? geometry.yScale(snapshot.resistance) : null;
    const zoneHeight =
        supportY !== null && resistanceY !== null
            ? Math.max(Math.abs(supportY - resistanceY), 2)
            : 0;
    const zoneY =
        supportY !== null && resistanceY !== null
            ? Math.min(supportY, resistanceY)
            : 0;
    const lastMapped = geometry.mapped[geometry.mapped.length - 1];
    const latestValueLabel = formatCurrency(lastMapped.value, currency, compact ? 0 : 2);
    const latestChangeLabel = formatPercent(chart?.summary?.change_percent ?? 0, compact ? 1 : 2);
    const compactHeader = [chart?.symbol, chart?.range].filter(Boolean).join(" | ");
    const compactMeta = [chart?.symbol, chart?.range].filter(Boolean).join(" · ");
    const showArea = !compact;
    const showIndicators = !compact;
    const showZone = !compact && snapshot;
    const showLabels = !compact;
    const compactBadgeWidth = 226;
    const compactBadgeHeight = 92;
    const compactBadgeX = CHART_WIDTH - CHART_PADDING_X - compactBadgeWidth;
    const compactBadgeY = CHART_PADDING_Y + 10;

    return `
        <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Gráfica ${chart.symbol || ""}">
            ${
                showArea
                    ? `<defs>
                        <linearGradient id="chartAreaGradient-${chartId}" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stop-color="${direction === "down" ? "#ff8773" : direction === "flat" ? "#f4c96a" : "#5ce2a1"}" stop-opacity="0.36"></stop>
                            <stop offset="100%" stop-color="${direction === "down" ? "#ff8773" : direction === "flat" ? "#f4c96a" : "#5ce2a1"}" stop-opacity="0.03"></stop>
                        </linearGradient>
                    </defs>`
                    : ""
            }
            <g class="chart-grid">
                <line x1="${CHART_PADDING_X}" y1="${CHART_PADDING_Y}" x2="${CHART_WIDTH - CHART_PADDING_X}" y2="${CHART_PADDING_Y}"></line>
                <line x1="${CHART_PADDING_X}" y1="${CHART_HEIGHT / 2}" x2="${CHART_WIDTH - CHART_PADDING_X}" y2="${CHART_HEIGHT / 2}"></line>
                <line x1="${CHART_PADDING_X}" y1="${CHART_HEIGHT - CHART_PADDING_Y}" x2="${CHART_WIDTH - CHART_PADDING_X}" y2="${CHART_HEIGHT - CHART_PADDING_Y}"></line>
            </g>
            ${
                showZone
                    ? `<rect class="chart-zone" x="${CHART_PADDING_X}" y="${zoneY.toFixed(2)}" width="${(CHART_WIDTH - CHART_PADDING_X * 2).toFixed(2)}" height="${zoneHeight.toFixed(2)}"></rect>`
                    : ""
            }
            ${showArea ? `<path class="chart-area chart-area-${direction}" d="${areaPath}" fill="url(#chartAreaGradient-${chartId})"></path>` : ""}
            <path class="chart-line chart-line-${direction}" d="${mainPath}"></path>
            ${showIndicators && fastPath ? `<path class="chart-ma chart-ma-fast" d="${fastPath}"></path>` : ""}
            ${showIndicators && slowPath ? `<path class="chart-ma chart-ma-slow" d="${slowPath}"></path>` : ""}
            <circle class="chart-last-marker chart-last-marker-${direction}" cx="${lastMapped.x.toFixed(2)}" cy="${lastMapped.y.toFixed(2)}" r="${compact ? 5 : 7}"></circle>
            ${
                showLabels
                    ? `<g class="chart-labels">
                        <text x="${CHART_PADDING_X}" y="18">${highLabel}</text>
                        <text x="${CHART_PADDING_X}" y="${CHART_HEIGHT - 8}">${lowLabel}</text>
                        <text x="${CHART_PADDING_X}" y="${CHART_HEIGHT - 34}">${startLabel}</text>
                        <text x="${CHART_WIDTH - CHART_PADDING_X}" y="${CHART_HEIGHT - 34}" text-anchor="end">${endLabel}</text>
                    </g>`
                    : ""
            }
            ${
                compact
                    ? `<g class="chart-compact-badge" transform="translate(${compactBadgeX}, ${compactBadgeY})">
                        <rect width="${compactBadgeWidth}" height="${compactBadgeHeight}" rx="22"></rect>
                        <text class="chart-compact-badge-meta" x="18" y="28">${compactHeader || compactMeta || "Activo"}</text>
                        <text class="chart-compact-badge-value" x="18" y="58">${latestValueLabel}</text>
                        <text class="chart-compact-badge-change chart-compact-badge-change-${direction}" x="18" y="78">${latestChangeLabel}</text>
                    </g>`
                    : `<g class="chart-legend">
                        <g transform="translate(${CHART_PADDING_X}, ${CHART_HEIGHT - 56})">
                            <line x1="0" y1="0" x2="26" y2="0" class="chart-legend-line chart-line-${direction}"></line>
                            <text x="36" y="5">Precio</text>
                        </g>
                        <g transform="translate(${CHART_PADDING_X + 122}, ${CHART_HEIGHT - 56})">
                            <line x1="0" y1="0" x2="26" y2="0" class="chart-legend-line chart-ma-fast"></line>
                            <text x="36" y="5">SMA20</text>
                        </g>
                        <g transform="translate(${CHART_PADDING_X + 248}, ${CHART_HEIGHT - 56})">
                            <line x1="0" y1="0" x2="26" y2="0" class="chart-legend-line chart-ma-slow"></line>
                            <text x="36" y="5">SMA50</text>
                        </g>
                    </g>`
            }
        </svg>
    `;
}

export function buildSignalGaugeSvg(score) {
    const clampedScore = clamp(score, -100, 100);
    const normalized = (clampedScore + 100) / 200;
    const angle = Math.PI * (1 - normalized);
    const radius = 76;
    const centerX = 100;
    const centerY = 100;
    const markerX = centerX + Math.cos(angle) * radius;
    const markerY = centerY - Math.sin(angle) * radius;

    return `
        <svg viewBox="0 0 200 122" role="img" aria-label="Score técnico">
            <path class="gauge-track" d="M 24 100 A 76 76 0 0 1 176 100"></path>
            <path class="gauge-arc gauge-arc-negative" d="M 24 100 A 76 76 0 0 1 100 24"></path>
            <path class="gauge-arc gauge-arc-neutral" d="M 100 24 A 76 76 0 0 1 138 34"></path>
            <path class="gauge-arc gauge-arc-positive" d="M 138 34 A 76 76 0 0 1 176 100"></path>
            <circle class="gauge-marker" cx="${markerX.toFixed(2)}" cy="${markerY.toFixed(2)}" r="7"></circle>
            <text class="gauge-value" x="100" y="88" text-anchor="middle">${clampedScore.toFixed(0)}</text>
            <text class="gauge-caption" x="100" y="108" text-anchor="middle">Score técnico</text>
        </svg>
    `;
}

export function buildRsiGaugeSvg(rsi) {
    const safeRsi = clamp(Number.isFinite(rsi) ? rsi : 50, 0, 100);
    const normalized = safeRsi / 100;
    const angle = Math.PI * (1 - normalized);
    const radius = 76;
    const centerX = 100;
    const centerY = 100;
    const markerX = centerX + Math.cos(angle) * radius;
    const markerY = centerY - Math.sin(angle) * radius;

    return `
        <svg viewBox="0 0 200 122" role="img" aria-label="Indicador RSI">
            <path class="gauge-track" d="M 24 100 A 76 76 0 0 1 176 100"></path>
            <path class="gauge-arc gauge-arc-negative" d="M 24 100 A 76 76 0 0 1 69 45"></path>
            <path class="gauge-arc gauge-arc-neutral" d="M 69 45 A 76 76 0 0 1 131 45"></path>
            <path class="gauge-arc gauge-arc-positive" d="M 131 45 A 76 76 0 0 1 176 100"></path>
            <circle class="gauge-marker" cx="${markerX.toFixed(2)}" cy="${markerY.toFixed(2)}" r="7"></circle>
            <text class="gauge-value" x="100" y="88" text-anchor="middle">${safeRsi.toFixed(1)}</text>
            <text class="gauge-caption" x="100" y="108" text-anchor="middle">RSI 14</text>
        </svg>
    `;
}

export function buildMomentumBarsSvg(bars) {
    const values = (bars || []).filter((value) => Number.isFinite(value));
    if (!values.length) {
        return "";
    }

    const width = 260;
    const height = 92;
    const padding = 8;
    const baseline = height / 2;
    const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 0.5);
    const barWidth = (width - padding * 2) / values.length;

    const rects = values
        .map((value, index) => {
            const normalizedHeight = (Math.abs(value) / maxAbs) * ((height - padding * 2) / 2);
            const x = padding + index * barWidth + 1;
            const y = value >= 0 ? baseline - normalizedHeight : baseline;
            const tone = value >= 0 ? "positive" : "negative";
            return `<rect class="momentum-bar momentum-bar-${tone}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth - 2, 3).toFixed(2)}" height="${normalizedHeight.toFixed(2)}" rx="3"></rect>`;
        })
        .join("");

    return `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Momentum reciente">
            <line class="momentum-baseline" x1="${padding}" y1="${baseline}" x2="${width - padding}" y2="${baseline}"></line>
            ${rects}
        </svg>
    `;
}

export function buildRangeMeterSvg(snapshot) {
    if (!snapshot) {
        return "";
    }

    const position = clamp(snapshot.pricePositionPercent, 0, 100);
    return `
        <div class="range-meter-shell">
            <div class="range-meter-labels">
                <span>Soporte</span>
                <span>Resistencia</span>
            </div>
            <div class="range-meter-track">
                <div class="range-meter-fill" style="width:${position.toFixed(1)}%"></div>
                <div class="range-meter-pin" style="left:${position.toFixed(1)}%"></div>
            </div>
        </div>
    `;
}

function getNumericPoints(chart) {
    return (chart?.points || []).filter((point) => Number.isFinite(Number(point.value)));
}

function buildGeometry(points) {
    const values = points.map((point) => Number(point.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1e-6);
    const drawableWidth = CHART_WIDTH - CHART_PADDING_X * 2;
    const drawableHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;

    const yScale = (value) =>
        CHART_HEIGHT - CHART_PADDING_Y - ((Number(value) - min) / range) * drawableHeight;

    const mapped = points.map((point, index) => ({
        x: CHART_PADDING_X + (drawableWidth * index) / Math.max(points.length - 1, 1),
        y: yScale(Number(point.value)),
        value: Number(point.value),
        label: point.label,
    }));

    return { min, max, range, yScale, mapped };
}

function buildPathFromMapped(mapped) {
    return mapped
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
}

function buildAreaPath(mapped) {
    return (
        `${buildPathFromMapped(mapped)} ` +
        `L ${mapped[mapped.length - 1].x.toFixed(2)} ${(CHART_HEIGHT - CHART_PADDING_Y).toFixed(2)} ` +
        `L ${mapped[0].x.toFixed(2)} ${(CHART_HEIGHT - CHART_PADDING_Y).toFixed(2)} Z`
    );
}

function buildIndicatorPath(series, geometry) {
    const points = [];

    series.forEach((value, index) => {
        if (!Number.isFinite(value) || !geometry.mapped[index]) return;
        points.push({
            x: geometry.mapped[index].x,
            y: geometry.yScale(value),
        });
    });

    if (points.length < 2) {
        return "";
    }

    return points
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
        .join(" ");
}

function calculateMovingAverage(values, period) {
    if (!Array.isArray(values) || !values.length) {
        return [];
    }

    let runningTotal = 0;
    return values.map((value, index) => {
        runningTotal += value;
        if (index >= period) {
            runningTotal -= values[index - period];
        }
        if (index < period - 1) {
            return null;
        }
        return runningTotal / period;
    });
}

function calculateRsi(values, period) {
    if (!Array.isArray(values) || values.length <= period) {
        return null;
    }

    let gains = 0;
    let losses = 0;

    for (let index = 1; index <= period; index += 1) {
        const delta = values[index] - values[index - 1];
        if (delta >= 0) {
            gains += delta;
        } else {
            losses += Math.abs(delta);
        }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    for (let index = period + 1; index < values.length; index += 1) {
        const delta = values[index] - values[index - 1];
        const gain = delta > 0 ? delta : 0;
        const loss = delta < 0 ? Math.abs(delta) : 0;
        averageGain = ((averageGain * (period - 1)) + gain) / period;
        averageLoss = ((averageLoss * (period - 1)) + loss) / period;
    }

    if (averageLoss === 0) {
        return 100;
    }

    const relativeStrength = averageGain / averageLoss;
    return 100 - (100 / (1 + relativeStrength));
}

function calculateVolatility(values) {
    if (!values.length) return null;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
        values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
    return Math.sqrt(variance);
}

function calculateTrendScore({ lastPrice, firstPrice, smaFast, smaSlow, rsi, changePercent }) {
    let score = clamp(changePercent * 4, -40, 40);

    if (Number.isFinite(lastPrice) && Number.isFinite(smaFast)) {
        score += lastPrice >= smaFast ? 18 : -18;
    }

    if (Number.isFinite(smaFast) && Number.isFinite(smaSlow)) {
        score += smaFast >= smaSlow ? 22 : -22;
    }

    if (Number.isFinite(lastPrice) && Number.isFinite(firstPrice) && firstPrice) {
        score += clamp(((lastPrice - firstPrice) / firstPrice) * 100 * 1.6, -24, 24);
    }

    if (Number.isFinite(rsi)) {
        if (rsi > 70) score -= 8;
        else if (rsi < 30) score += 8;
        else if (rsi >= 55) score += 10;
        else if (rsi <= 45) score -= 10;
    }

    return clamp(score, -100, 100);
}

function getTrendLabel(score) {
    if (score >= 45) return "Momentum técnico fuerte";
    if (score >= 15) return "Bias positivo";
    if (score <= -45) return "Presión técnica fuerte";
    if (score <= -15) return "Bias defensivo";
    return "Equilibrio técnico";
}

function getStructureLabel(lastPrice, smaFast, smaSlow) {
    if (Number.isFinite(lastPrice) && Number.isFinite(smaFast) && Number.isFinite(smaSlow)) {
        if (lastPrice >= smaFast && smaFast >= smaSlow) return "Precio por encima de SMA20 y SMA50";
        if (lastPrice <= smaFast && smaFast <= smaSlow) return "Precio por debajo de SMA20 y SMA50";
        if (lastPrice >= smaFast && smaFast < smaSlow) return "Rebote corto con estructura aun debil";
        if (lastPrice < smaFast && smaFast >= smaSlow) return "Tendencia positiva con pullback";
    }
    return "Sin suficientes datos para una estructura completa";
}

function getLastDefinedValue(values) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
        if (Number.isFinite(values[index])) {
            return values[index];
        }
    }
    return null;
}

function sanitizeId(value) {
    return String(value || "chart").replace(/[^a-zA-Z0-9_-]/g, "-");
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

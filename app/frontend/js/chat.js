import {
    buildChartSvg,
    buildMomentumBarsSvg,
    buildRangeMeterSvg,
    buildRsiGaugeSvg,
    buildSignalGaugeSvg,
    formatCompactNumber,
    formatCurrency,
    formatPercent,
    getTechnicalSnapshot,
} from "./chart-utils.js";

export class ChatController {
    constructor(ui, avatar, apiUrl) {
        this.ui = ui;
        this.avatar = avatar;
        this.apiUrl = apiUrl;
        this.liveFeedUrl = "/live-feed";
        this.assetChartUrl = "/asset-chart";

        this.queue = [];
        this.processing = false;
        this.currentPhotos = [];
        this.currentIndex = 0;
        this.brokenPhotoUrls = new Set();
        this.conversationHistory = [];
        this.defaultScreenChannels = [];
        this.activeScreenChannels = [];
        this.activeScreenChannelIndex = 0;
        this.isShowingDefaultFeed = true;
        this.screenRotationTimer = null;
        this.liveFeedRefreshTimer = null;
        this.marketContextListener = null;

        this.ui.sendBtn.addEventListener("click", () => this.submitCurrentInput());
        this.ui.userInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            this.submitCurrentInput();
        });
        this.ui.setClearHandler(() => this.resetConversation());
        this.ui.setScreenResetHandler(() => this.resumeDefaultLiveFeed());

        this.setupViewerControls();
        this.setupChannelControls();
        void this.initializeLiveFeed();
    }

    async showWelcomeMessage() {
        const welcomeMessage =
            "Soy tu analista IA de inversión.\n\n" +
            "Puedo explicarte acciones, ETFs, índices y sectores, proponerte planes orientativos según tu perfil y mostrar gráficas cuando consultes un activo.";

        await this.ui.addBotMessageTyping(welcomeMessage);
        this.pushHistory("assistant", welcomeMessage);
    }

    setMarketContextListener(listener) {
        this.marketContextListener = typeof listener === "function" ? listener : null;
    }

    resetConversation() {
        this.queue = [];
        this.processing = false;
        this.currentPhotos = [];
        this.currentIndex = 0;
        this.brokenPhotoUrls.clear();
        this.conversationHistory = [];
        this.avatar.stopTalking();
        this.resumeDefaultLiveFeed();
        void this.showWelcomeMessage();
    }

    pushHistory(role, content) {
        const value = (content || "").trim();
        if (!value) return;

        this.conversationHistory.push({ role, content: value });
        this.conversationHistory = this.conversationHistory.slice(-12);
    }

    setupViewerControls() {
        const viewer = document.getElementById("imageViewer");
        const viewerImg = document.getElementById("viewerImg");
        const closeBtn = document.getElementById("closeViewer");
        const leftBtn = document.getElementById("viewerLeft");
        const rightBtn = document.getElementById("viewerRight");

        if (viewerImg) {
            viewerImg.addEventListener("error", () => {
                const failedPhoto = this.currentPhotos[this.currentIndex];
                if (failedPhoto) {
                    this.brokenPhotoUrls.add(failedPhoto);
                }

                const nextIndex = this.findNextAvailablePhoto(this.currentIndex + 1, 1);

                if (nextIndex === null || !viewer) {
                    viewer?.classList.add("hidden");
                    return;
                }

                this.currentIndex = nextIndex;
                viewerImg.src = this.currentPhotos[this.currentIndex];
            });
        }

        if (closeBtn && viewer) {
            closeBtn.addEventListener("click", () => viewer.classList.add("hidden"));
        }

        if (viewer) {
            viewer.addEventListener("click", (event) => {
                if (event.target === viewer) {
                    viewer.classList.add("hidden");
                }
            });
        }

        if (leftBtn) {
            leftBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this.showPrev();
            });
        }

        if (rightBtn) {
            rightBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this.showNext();
            });
        }

        document.addEventListener("keydown", (event) => {
            if (!viewer || viewer.classList.contains("hidden")) return;

            if (event.key === "ArrowRight") this.showNext();
            if (event.key === "ArrowLeft") this.showPrev();
            if (event.key === "Escape") viewer.classList.add("hidden");
        });
    }

    setupChannelControls() {
        if (this.ui.channelPrevBtn) {
            this.ui.channelPrevBtn.addEventListener("click", () => {
                this.showPrevScreenChannel({ manual: true });
            });
        }

        if (this.ui.channelNextBtn) {
            this.ui.channelNextBtn.addEventListener("click", () => {
                this.showNextScreenChannel({ manual: true });
            });
        }
    }

    async initializeLiveFeed() {
        await this.refreshLiveFeed({ forceDisplay: true });
        this.startLiveFeedRefresh();
    }

    async refreshLiveFeed({ forceDisplay = false } = {}) {
        try {
            const response = await fetch(this.liveFeedUrl);
            if (!response.ok) {
                throw new Error(`Live feed failed with status ${response.status}`);
            }

            const data = await response.json();
            const channels = this.normalizeChannels(data.channels);

            if (!channels.length) {
                throw new Error("Live feed returned no channels");
            }

            this.defaultScreenChannels = this.shuffleItems(channels);

            if (forceDisplay || this.isShowingDefaultFeed || !this.activeScreenChannels.length) {
                this.setActiveScreenChannels(this.defaultScreenChannels, { isDefault: true });
            }
        } catch (error) {
            if (this.activeScreenChannels.length) {
                return;
            }

            this.ui.showFeaturedState({
                eyebrow: "Conexión",
                title: "No he podido cargar el pulso del mercado",
                body: "Prueba de nuevo en unos segundos o usa el chat para pedir un activo concreto.",
            });
            this.ui.setChannelCounter(1, 1);
            this.ui.setChannelNavigationEnabled(false);
        }
    }

    startLiveFeedRefresh() {
        clearInterval(this.liveFeedRefreshTimer);
        this.liveFeedRefreshTimer = setInterval(() => {
            void this.refreshLiveFeed();
        }, 240000);
    }

    shuffleItems(items) {
        const result = [...items];

        for (let index = result.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
        }

        return result;
    }

    normalizeChannels(channels) {
        return (Array.isArray(channels) ? channels : [])
            .map((channel) => ({
                eyebrow: channel.eyebrow || "Mercado",
                title: channel.title || "Panel de mercado",
                body: channel.body || "Sin contenido disponible.",
                imageUrl: this.getCleanImageUrl(channel.imageUrl),
                linkUrl: channel.linkUrl || "",
                linkLabel: channel.linkLabel || "Ver activo",
                asset: channel.asset || null,
                chart: channel.chart || null,
            }))
            .filter((channel) => channel.title);
    }

    showLoadingState(query) {
        const searchLabel = this.truncateText(query);

        this.ui.showFeaturedState({
            eyebrow: "Analizando",
            title: `Preparando lectura de mercado sobre ${searchLabel}`,
            body:
                "**Estoy reuniendo el contexto**\n\n" +
                "- cotización y señal reciente\n" +
                "- noticias y catalizadores\n" +
                "- una respuesta prudente y útil",
            asset: null,
            chart: null,
            isLoading: true,
        });
        this.ui.setChannelCounter(1, 1);
        this.ui.setChannelNavigationEnabled(false);
    }

    truncateText(value, maxLength = 72) {
        const normalized = (value || "").trim().replace(/\s+/g, " ");

        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
    }

    setActiveScreenChannels(items, { isDefault = false } = {}) {
        if (!Array.isArray(items) || !items.length) {
            return false;
        }

        this.activeScreenChannels = items;
        this.activeScreenChannelIndex = 0;
        this.isShowingDefaultFeed = isDefault;
        this.showScreenChannel(this.activeScreenChannelIndex);
        this.resetScreenRotation();
        return true;
    }

    showScreenChannel(index) {
        const total = this.activeScreenChannels.length;

        if (!total) {
            return;
        }

        const safeIndex = ((index % total) + total) % total;
        const channel = this.activeScreenChannels[safeIndex];

        this.activeScreenChannelIndex = safeIndex;
        this.ui.showFeaturedState({
            eyebrow: channel.eyebrow,
            title: channel.title,
            body: channel.body,
            imageUrl: channel.imageUrl,
            linkUrl: channel.linkUrl,
            linkLabel: channel.linkLabel,
            chart: channel.chart,
            asset: channel.asset,
        });
        this.ui.setChannelCounter(safeIndex + 1, total);
        this.ui.setChannelNavigationEnabled(total > 1);
    }

    showNextScreenChannel({ manual = false } = {}) {
        if (!this.activeScreenChannels.length) {
            return;
        }

        this.showScreenChannel(this.activeScreenChannelIndex + 1);

        if (manual) {
            this.resetScreenRotation();
        }
    }

    showPrevScreenChannel({ manual = false } = {}) {
        if (!this.activeScreenChannels.length) {
            return;
        }

        this.showScreenChannel(this.activeScreenChannelIndex - 1);

        if (manual) {
            this.resetScreenRotation();
        }
    }

    resetScreenRotation() {
        clearInterval(this.screenRotationTimer);

        if (this.activeScreenChannels.length <= 1) {
            return;
        }

        this.screenRotationTimer = setInterval(() => {
            this.showNextScreenChannel();
        }, 9000);
    }

    resumeDefaultLiveFeed() {
        if (this.defaultScreenChannels.length) {
            this.setActiveScreenChannels(this.defaultScreenChannels, { isDefault: true });
            return;
        }

        this.ui.resetFeaturedState();
        void this.refreshLiveFeed({ forceDisplay: true });
    }

    submitCurrentInput() {
        const wasQueued = this.queueMessage(this.ui.userInput.value);

        if (wasQueued) {
            this.ui.userInput.value = "";
        }
    }

    getCleanImageUrl(url) {
        const value = (url || "").trim();
        if (!value) return "";
        if (!/^https?:\/\//i.test(value)) return "";
        return value;
    }

    sanitizeImageUrls(urls) {
        return Array.from(
            new Set(
                (urls || [])
                    .map((url) => this.getCleanImageUrl(url))
                    .filter(Boolean),
            ),
        );
    }

    decorateRemoteImage(image, onError) {
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";

        image.addEventListener("error", () => {
            const failedUrl = image.currentSrc || image.src;
            if (failedUrl) {
                this.brokenPhotoUrls.add(failedUrl);
            }

            if (typeof onError === "function") {
                onError();
            }
        });
    }

    findNextAvailablePhoto(startIndex = 0, direction = 1) {
        if (!this.currentPhotos.length) return null;

        for (let offset = 0; offset < this.currentPhotos.length; offset += 1) {
            const nextIndex =
                (startIndex + offset * direction + this.currentPhotos.length) % this.currentPhotos.length;
            const nextUrl = this.currentPhotos[nextIndex];

            if (!this.brokenPhotoUrls.has(nextUrl)) {
                return nextIndex;
            }
        }

        return null;
    }

    openViewer(index) {
        const viewer = document.getElementById("imageViewer");
        const viewerImg = document.getElementById("viewerImg");

        if (!viewer || !viewerImg || !this.currentPhotos.length) return;

        const safeIndex = this.findNextAvailablePhoto(index, 1);
        if (safeIndex === null) return;

        this.currentIndex = safeIndex;
        viewerImg.src = this.currentPhotos[this.currentIndex];
        viewer.classList.remove("hidden");
    }

    showNext() {
        if (!this.currentPhotos.length) return;

        const viewerImg = document.getElementById("viewerImg");
        if (!viewerImg) return;

        const nextIndex = this.findNextAvailablePhoto(this.currentIndex + 1, 1);
        if (nextIndex === null) return;

        this.currentIndex = nextIndex;
        viewerImg.src = this.currentPhotos[this.currentIndex];
    }

    showPrev() {
        if (!this.currentPhotos.length) return;

        const viewerImg = document.getElementById("viewerImg");
        if (!viewerImg) return;

        const nextIndex = this.findNextAvailablePhoto(this.currentIndex - 1, -1);
        if (nextIndex === null) return;

        this.currentIndex = nextIndex;
        viewerImg.src = this.currentPhotos[this.currentIndex];
    }

    queueMessage(text) {
        const message = text.trim();
        if (!message) return false;

        this.ui.addUserMessage(message);
        this.queue.push(message);
        void this.processQueue();
        return true;
    }

    publishMarketContext(payload) {
        if (typeof this.marketContextListener === "function") {
            this.marketContextListener(payload || {});
        }
    }

    buildAssetPanel(asset, outlook) {
        const panel = document.createElement("section");
        panel.className = "insight-panel asset-panel";

        const header = document.createElement("div");
        header.className = "panel-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "panel-title-group";

        const eyebrow = document.createElement("span");
        eyebrow.className = "panel-kicker";
        eyebrow.textContent = `${asset.quote_type_label || "Activo"} | ${asset.exchange || "Mercado"}`;

        const title = document.createElement("h3");
        title.textContent = `${asset.symbol} | ${asset.name || asset.symbol}`;

        titleGroup.append(eyebrow, title);

        const trend = document.createElement("div");
        trend.className = `trend-pill ${(asset.change_percent || 0) >= 0 ? "is-positive" : "is-negative"}`;
        trend.textContent = formatPercent(asset.change_percent);

        header.append(titleGroup, trend);

        const metrics = document.createElement("div");
        metrics.className = "metric-grid";

        [
            ["Precio", formatCurrency(asset.price, asset.currency)],
            ["Cambio diario", formatPercent(asset.change_percent)],
            ["52 semanas", `${formatCurrency(asset.fifty_two_week_low, asset.currency)} - ${formatCurrency(asset.fifty_two_week_high, asset.currency)}`],
            ["Volumen", formatCompactNumber(asset.volume)],
            ["Capitalización", formatCompactNumber(asset.market_cap)],
        ].forEach(([label, value]) => {
            metrics.appendChild(this.createMetricCard(label, value));
        });

        panel.append(header, metrics);

        if (outlook?.label || (outlook?.reasons || []).length) {
            const outlookBlock = document.createElement("div");
            outlookBlock.className = "panel-copy";

            const outlookTitle = document.createElement("h4");
            outlookTitle.textContent = "Escenario probable";

            const outlookText = document.createElement("p");
            outlookText.textContent = `${outlook.label || "Lectura mixta"}. ${outlook.disclaimer || ""}`.trim();

            outlookBlock.append(outlookTitle, outlookText);

            if ((outlook.reasons || []).length) {
                const list = document.createElement("ul");
                (outlook.reasons || []).forEach((reason) => {
                    const item = document.createElement("li");
                    item.textContent = reason;
                    list.appendChild(item);
                });
                outlookBlock.appendChild(list);
            }

            panel.appendChild(outlookBlock);
        }

        return panel;
    }

    createMetricCard(label, value) {
        const card = document.createElement("div");
        card.className = "metric-card";

        const title = document.createElement("span");
        title.className = "metric-card-label";
        title.textContent = label;

        const amount = document.createElement("strong");
        amount.className = "metric-card-value";
        amount.textContent = value;

        card.append(title, amount);
        return card;
    }

    buildChartPanel(chart, asset) {
        const panel = document.createElement("section");
        panel.className = "insight-panel chart-panel";
        panel.dataset.ticker = asset?.symbol || chart.symbol || "";

        const header = document.createElement("div");
        header.className = "panel-header panel-header-chart";

        const titleGroup = document.createElement("div");
        titleGroup.className = "panel-title-group";

        const eyebrow = document.createElement("span");
        eyebrow.className = "panel-kicker";
        eyebrow.textContent = "Gráfica";

        const title = document.createElement("h3");
        title.textContent = `${chart.symbol} | ${asset?.name || chart.name || chart.symbol}`;

        titleGroup.append(eyebrow, title);

        const rangeSelector = document.createElement("div");
        rangeSelector.className = "range-selector";

        (chart.available_ranges || []).forEach((rangeKey) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "range-chip";
            button.textContent = rangeKey;
            button.dataset.range = rangeKey;
            if (rangeKey === chart.range) {
                button.classList.add("is-active");
            }
            button.addEventListener("click", () => {
                void this.loadChartRange(panel, chart.symbol, rangeKey);
            });
            rangeSelector.appendChild(button);
        });

        header.append(titleGroup, rangeSelector);

        const chartCanvas = document.createElement("div");
        chartCanvas.className = "chart-canvas";

        const summary = document.createElement("div");
        summary.className = "chart-summary";

        const technicalBoard = document.createElement("div");
        technicalBoard.className = "technical-grid";

        panel.append(header, chartCanvas, summary, technicalBoard);
        this.renderChartPanel(panel, chart, asset);
        return panel;
    }

    renderChartPanel(panel, chart, asset) {
        const chartCanvas = panel.querySelector(".chart-canvas");
        const summary = panel.querySelector(".chart-summary");
        const technicalBoard = panel.querySelector(".technical-grid");
        if (!chartCanvas || !summary || !technicalBoard) return;

        chartCanvas.innerHTML = buildChartSvg(chart);
        summary.innerHTML = "";
        technicalBoard.innerHTML = "";

        const technical = getTechnicalSnapshot(chart);

        [
            ["Rango", chart.range],
            ["Cambio", formatPercent(chart.summary?.change_percent)],
            ["Maximo", formatCurrency(chart.summary?.high, chart.currency || asset?.currency)],
            ["Minimo", formatCurrency(chart.summary?.low, chart.currency || asset?.currency)],
        ].forEach(([label, value]) => {
            const item = document.createElement("div");
            item.className = "chart-summary-item";

            const itemLabel = document.createElement("span");
            itemLabel.textContent = label;

            const itemValue = document.createElement("strong");
            itemValue.textContent = value;

            item.append(itemLabel, itemValue);
            summary.appendChild(item);
        });

        if (technical) {
            const rsiValue = Number.isFinite(technical.rsi) ? technical.rsi.toFixed(1) : "n/d";
            technicalBoard.append(
                this.createTechnicalCard({
                    title: "Score de señal",
                    subtitle: technical.trendLabel,
                    value: `${technical.trendScore.toFixed(0)}`,
                    visual: buildSignalGaugeSvg(technical.trendScore),
                    copy: technical.structureLabel,
                }),
                this.createTechnicalCard({
                    title: "RSI 14",
                    subtitle: this.getRsiLabel(technical.rsi),
                    value: rsiValue,
                    visual: buildRsiGaugeSvg(technical.rsi),
                    copy: this.getRsiCopy(technical.rsi),
                }),
                this.createTechnicalCard({
                    title: "Momentum",
                    subtitle: this.getMomentumLabel(technical.momentumBars),
                    value: formatPercent(technical.momentumBars[technical.momentumBars.length - 1] || 0),
                    visual: buildMomentumBarsSvg(technical.momentumBars),
                    copy: `SMA20: ${formatCurrency(technical.smaFast, chart.currency || asset?.currency)} | SMA50: ${formatCurrency(technical.smaSlow, chart.currency || asset?.currency)}`,
                }),
                this.createTechnicalCard({
                    title: "Niveles",
                    subtitle: "Soporte y resistencia",
                    value: `${technical.pricePositionPercent.toFixed(0)}%`,
                    visual: buildRangeMeterSvg(technical),
                    copy: `Soporte a ${formatCurrency(technical.support, chart.currency || asset?.currency)} y resistencia a ${formatCurrency(technical.resistance, chart.currency || asset?.currency)}.`,
                    copySecondary: `Distancia al soporte: ${formatPercent(technical.supportDistance)} | a resistencia: ${formatPercent(technical.resistanceDistance)}`,
                }),
            );
        }
    }

    createTechnicalCard({ title, subtitle, value, visual, copy, copySecondary = "" }) {
        const card = document.createElement("article");
        card.className = "technical-card";

        const top = document.createElement("div");
        top.className = "technical-card-top";

        const titleWrap = document.createElement("div");
        titleWrap.className = "technical-card-title-wrap";

        const heading = document.createElement("h4");
        heading.className = "technical-card-title";
        heading.textContent = title;

        const headingSub = document.createElement("span");
        headingSub.className = "technical-card-subtitle";
        headingSub.textContent = subtitle;

        titleWrap.append(heading, headingSub);

        const strong = document.createElement("strong");
        strong.className = "technical-card-value";
        strong.textContent = value;

        top.append(titleWrap, strong);

        const visualWrap = document.createElement("div");
        visualWrap.className = "technical-visual";
        visualWrap.innerHTML = visual;

        const text = document.createElement("p");
        text.className = "technical-card-copy";
        text.textContent = copy;

        card.append(top, visualWrap, text);

        if (copySecondary) {
            const secondary = document.createElement("p");
            secondary.className = "technical-card-copy technical-card-copy-secondary";
            secondary.textContent = copySecondary;
            card.appendChild(secondary);
        }

        return card;
    }

    getRsiLabel(rsi) {
        if (!Number.isFinite(rsi)) return "Dato insuficiente";
        if (rsi >= 70) return "Sobrecompra";
        if (rsi <= 30) return "Sobreventa";
        if (rsi >= 55) return "Impulso sano";
        if (rsi <= 45) return "Impulso flojo";
        return "Zona neutral";
    }

    getRsiCopy(rsi) {
        if (!Number.isFinite(rsi)) return "No hay suficientes puntos para una lectura RSI fiable en este rango.";
        if (rsi >= 70) return "El activo llega exigido técnicamente; puede seguir subiendo, pero el riesgo de enfriamiento aumenta.";
        if (rsi <= 30) return "La lectura sugiere presión reciente fuerte; puede aparecer rebote, pero no hay garantía de giro.";
        if (rsi >= 55) return "Hay impulso comprador, aunque conviene vigilar si el precio pierde su media rápida.";
        if (rsi <= 45) return "La demanda es más frágil y el contexto técnico pide confirmación adicional.";
        return "No hay una lectura extrema; el mercado esta en una zona intermedia.";
    }

    getMomentumLabel(momentumBars) {
        const recentAverage =
            (momentumBars || []).reduce((sum, value) => sum + value, 0) /
            Math.max((momentumBars || []).length, 1);

        if (recentAverage > 0.35) return "Aceleración positiva";
        if (recentAverage < -0.35) return "Aceleración negativa";
        return "Flujo mixto";
    }

    async loadChartRange(panel, ticker, rangeKey) {
        const buttons = panel.querySelectorAll(".range-chip");
        buttons.forEach((button) => {
            button.disabled = true;
            button.classList.toggle("is-active", button.dataset.range === rangeKey);
        });
        panel.classList.add("is-loading");

        try {
            const response = await fetch(
                `${this.assetChartUrl}?ticker=${encodeURIComponent(ticker)}&range=${encodeURIComponent(rangeKey)}`,
            );

            if (!response.ok) {
                throw new Error(`Chart request failed with status ${response.status}`);
            }

            const chart = await response.json();
            this.renderChartPanel(panel, chart, { symbol: ticker, name: ticker, currency: chart.currency });
            this.syncChartToScreen(ticker, chart);
            this.publishMarketContext({
                asset: { symbol: ticker, name: ticker, currency: chart.currency },
                chart,
            });
        } catch (error) {
            const chartCanvas = panel.querySelector(".chart-canvas");
            if (chartCanvas) {
                chartCanvas.innerHTML = "<div class=\"chart-error\">No he podido cargar ese rango ahora mismo.</div>";
            }
        } finally {
            panel.classList.remove("is-loading");
            buttons.forEach((button) => {
                button.disabled = false;
            });
        }
    }

    syncChartToScreen(ticker, chart) {
        this.activeScreenChannels = this.activeScreenChannels.map((channel) => {
            if (channel.asset?.symbol === ticker || channel.chart?.symbol === ticker) {
                return { ...channel, chart };
            }
            return channel;
        });

        if (this.activeScreenChannels[this.activeScreenChannelIndex]?.asset?.symbol === ticker) {
            this.showScreenChannel(this.activeScreenChannelIndex);
        }
    }

    buildComparisonPanel(comparison) {
        const items = comparison.items || [];
        const panel = document.createElement("section");
        panel.className = "insight-panel comparison-panel";

        const header = document.createElement("div");
        header.className = "panel-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "panel-title-group";

        const eyebrow = document.createElement("span");
        eyebrow.className = "panel-kicker";
            eyebrow.textContent = "Comparación";

        const title = document.createElement("h3");
        title.textContent = "Comparativa de activos";

        titleGroup.append(eyebrow, title);
        header.appendChild(titleGroup);

        const grid = document.createElement("div");
        grid.className = "comparison-grid";

        items.forEach((item) => {
            const card = document.createElement("article");
            card.className = "comparison-card";

            const cardTitle = document.createElement("h4");
            cardTitle.textContent = `${item.symbol} | ${item.name || item.symbol}`;

            const meta = document.createElement("p");
            meta.textContent = `${item.quote_type_label || "Activo"} | ${item.exchange || "Mercado"}`;

            const list = document.createElement("ul");
            [
                `Precio: ${formatCurrency(item.price, item.currency)}`,
                `Cambio diario: ${formatPercent(item.change_percent)}`,
                `Rango 52 semanas: ${formatCurrency(item.fifty_two_week_low, item.currency)} - ${formatCurrency(item.fifty_two_week_high, item.currency)}`,
            ].forEach((line) => {
                const li = document.createElement("li");
                li.textContent = line;
                list.appendChild(li);
            });

            card.append(cardTitle, meta, list);
            grid.appendChild(card);
        });

        panel.append(header, grid);
        return panel;
    }

    buildInvestmentPlanPanel(plan) {
        const panel = document.createElement("section");
        panel.className = "insight-panel plan-panel";

        const header = document.createElement("div");
        header.className = "panel-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "panel-title-group";

        const eyebrow = document.createElement("span");
        eyebrow.className = "panel-kicker";
        eyebrow.textContent = `Plan ${plan.risk_profile}`;

        const title = document.createElement("h3");
        title.textContent = "Plan orientativo";

        titleGroup.append(eyebrow, title);
        header.appendChild(titleGroup);

        const overview = document.createElement("div");
        overview.className = "plan-overview";

        [
            ["Horizonte", plan.horizon],
            ["Aporte mensual", plan.monthly_amount ? `${plan.monthly_amount} EUR` : "Por porcentajes"],
            ["Enfoque", plan.focus],
        ].forEach(([label, value]) => {
            overview.appendChild(this.createMetricCard(label, value));
        });

        const allocations = document.createElement("div");
        allocations.className = "allocation-list";

        (plan.allocation || []).forEach((item) => {
            const row = document.createElement("div");
            row.className = "allocation-row";

            const top = document.createElement("div");
            top.className = "allocation-top";

            const label = document.createElement("strong");
            label.textContent = `${item.label}`;

            const value = document.createElement("span");
            value.textContent = `${item.percentage}%${item.monthly_amount ? ` | ${item.monthly_amount.toFixed(2)} EUR` : ""}`;

            top.append(label, value);

            const bar = document.createElement("div");
            bar.className = "allocation-bar";

            const fill = document.createElement("span");
            fill.style.width = `${item.percentage}%`;
            bar.appendChild(fill);

            const detail = document.createElement("p");
            detail.textContent = item.rationale;

            row.append(top, bar, detail);
            allocations.appendChild(row);
        });

        const footer = document.createElement("div");
        footer.className = "panel-copy";

        const footerTitle = document.createElement("h4");
        footerTitle.textContent = "Riesgos";

        const disclaimer = document.createElement("p");
        disclaimer.textContent = plan.disclaimer;

        footer.append(footerTitle, disclaimer);

        panel.append(header, overview, allocations, footer);
        return panel;
    }

    buildMarketNewsDeck(articles, topic) {
        const newsDeck = document.createElement("section");
        newsDeck.className = "insight-panel market-news-deck";

        const deckTop = document.createElement("div");
        deckTop.className = "panel-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "panel-title-group";

        const eyebrow = document.createElement("span");
        eyebrow.className = "panel-kicker";
        eyebrow.textContent = "Contexto";

        const title = document.createElement("h3");
        title.textContent = "Noticias que mueven el mercado";

        const subtitle = document.createElement("p");
        subtitle.className = "panel-subtitle";
        subtitle.textContent = topic || "mercado global";

        titleGroup.append(eyebrow, title, subtitle);
        deckTop.appendChild(titleGroup);

        const grid = document.createElement("div");
        grid.className = "news-grid";

        const photoUrls = [];

        articles.forEach((article) => {
            const card = document.createElement("article");
            card.className = "news-card";

            const articleImageUrl = this.getCleanImageUrl(article.image_url);
            if (articleImageUrl) {
                const viewerIndex = photoUrls.push(articleImageUrl) - 1;
                const mediaButton = document.createElement("button");
                mediaButton.type = "button";
                mediaButton.className = "news-card-media";
                mediaButton.setAttribute("aria-label", `Abrir imagen de ${article.title}`);
                mediaButton.addEventListener("click", () => this.openViewer(viewerIndex));

                const image = document.createElement("img");
                image.src = articleImageUrl;
                image.alt = article.title || "Imagen relacionada";
                this.decorateRemoteImage(image, () => {
                    mediaButton.remove();
                });

                mediaButton.appendChild(image);
                card.appendChild(mediaButton);
            }

            const body = document.createElement("div");
            body.className = "news-card-body";

            const meta = document.createElement("div");
            meta.className = "news-card-meta";
            meta.textContent = `${article.source || "Fuente"} | ${this.formatPublishedAt(article.published_at)}`;

            const cardTitle = document.createElement("h3");
            cardTitle.textContent = article.title;

            const description = document.createElement("p");
            description.textContent = article.description || "Sin extracto disponible.";

            const footer = document.createElement("div");
            footer.className = "news-card-footer";

            const link = document.createElement("a");
            link.href = article.url;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = "Abrir fuente";

            footer.appendChild(link);
            body.append(meta, cardTitle, description, footer);
            card.appendChild(body);
            grid.appendChild(card);
        });

        newsDeck.append(deckTop, grid);
        return { block: newsDeck, photoUrls: this.sanitizeImageUrls(photoUrls) };
    }

    formatPublishedAt(value) {
        if (!value) return "Fecha no disponible";

        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
            return value;
        }

        return new Intl.DateTimeFormat("es-ES", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
        }).format(parsedDate);
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        const text = this.queue.shift();
        const history = this.conversationHistory.slice(-8);

        this.avatar.startTalking();
        this.ui.setPendingState(true);
        this.ui.userInput.disabled = true;
        this.ui.sendBtn.disabled = true;
        this.ui.clearBtn.disabled = true;
        this.showLoadingState(text);

        try {
            const res = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_message: text,
                    history,
                }),
            });

            if (!res.ok) {
                throw new Error(`Request failed with status ${res.status}`);
            }

            const data = await res.json();
            const channels = this.normalizeChannels(data.channels);

            if (channels.length) {
                this.setActiveScreenChannels(channels, { isDefault: false });
            } else {
                this.resumeDefaultLiveFeed();
            }

            this.publishMarketContext(data);

            await this.ui.addBotMessageTyping(data.bot_message);

            this.pushHistory("user", text);
            this.pushHistory("assistant", data.bot_message);

            this.appendResponseBlocks(data);
        } catch (error) {
            const fallbackMessage = "No he podido conectar con el servicio de mercado ahora mismo.";
            this.ui.showFeaturedState({
                eyebrow: "Conexión",
                title: "Servicio temporalmente no disponible",
                body: "No he podido preparar esta lectura ahora mismo. Pulsa en `Pulso del mercado` para volver al panel general.",
            });
            this.ui.setChannelCounter(1, 1);
            this.ui.setChannelNavigationEnabled(false);
            await this.ui.addBotMessageTyping(fallbackMessage);
            this.pushHistory("user", text);
            this.pushHistory("assistant", fallbackMessage);
            this.avatar.avatarStatus.textContent = "Error";
        } finally {
            this.avatar.stopTalking();
            this.ui.setPendingState(false);
            this.ui.userInput.disabled = false;
            this.ui.sendBtn.disabled = false;
            this.ui.clearBtn.disabled = false;
            this.ui.userInput.focus();
            this.processing = false;
            void this.processQueue();
        }
    }

    appendResponseBlocks(data) {
        const appendedBlocks = [];

        if (data.asset) {
            const block = this.buildAssetPanel(data.asset, data.outlook);
            appendedBlocks.push(block);
            this.ui.appendBlock(block);
        }

        if (data.chart) {
            const block = this.buildChartPanel(data.chart, data.asset || data.chart);
            appendedBlocks.push(block);
            this.ui.appendBlock(block);
        }

        if (data.comparison?.items?.length) {
            const block = this.buildComparisonPanel(data.comparison);
            appendedBlocks.push(block);
            this.ui.appendBlock(block);
        }

        if (data.investment_plan) {
            const block = this.buildInvestmentPlanPanel(data.investment_plan);
            appendedBlocks.push(block);
            this.ui.appendBlock(block);
        }

        if (data.articles?.length) {
            const deck = this.buildMarketNewsDeck(data.articles, data.topic);
            this.currentPhotos = deck.photoUrls;
            this.brokenPhotoUrls.clear();
            appendedBlocks.push(deck.block);
            this.ui.appendBlock(deck.block);
            this.ui.focusBlock(appendedBlocks[0] || deck.block);
            return;
        }

        this.currentPhotos = [];
        this.brokenPhotoUrls.clear();

        if (appendedBlocks.length) {
            this.ui.focusBlock(appendedBlocks[0]);
        }
    }
}

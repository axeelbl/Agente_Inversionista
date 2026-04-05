import { formatCompactNumber, formatCurrency, formatPercent } from "./chart-utils.js";

const DEFAULT_WATCHLIST = ["SPY", "VOO", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA"];
const DEFAULT_RANGE = "6M";
const DEFAULT_PLANNER_DRAFT = {
    riskProfile: "moderado",
    monthlyContribution: 300,
    initialCapital: 1000,
    horizonYears: 10,
    scenarioRates: {
        prudente: 3,
        base: 6,
        dinamico: 9,
    },
    allocations: [],
};

const RISK_PROFILE_COPY = {
    conservador:
        "Enfoque estable: prioriza ETFs amplios, volatilidad contenida y una cartera que puedas mantener con disciplina.",
    moderado:
        "Busca equilibrio entre crecimiento y estabilidad. Suele encajar con combinaciones diversificadas de ETFs y algunas acciones de calidad.",
    agresivo:
        "Asume más volatilidad a cambio de mayor potencial de crecimiento. Conviene vigilar concentración, horizonte y capacidad real de soportar caídas.",
};

export class InvestorWorkspace {
    constructor(chat) {
        this.chat = chat;
        this.assetSearchUrl = "/asset-search";
        this.assetQuoteUrl = "/asset-quote";
        this.assetChartUrl = "/asset-chart";
        this.planLeadUrl = "/investment-plan-lead";
        this.state = {
            activeTab: "chat",
            selectedAsset: null,
            selectedChart: null,
            selectedRange: DEFAULT_RANGE,
            watchlist: [...DEFAULT_WATCHLIST],
            watchlistData: new Map(),
            compareSelection: [],
            plannerDraft: this.createDefaultPlannerDraft(),
        };
        this.searchState = {
            chart: { items: [], timer: null, requestId: 0 },
            planner: { items: [], timer: null, requestId: 0 },
        };
        this.refs = {
            tabButtons: Array.from(document.querySelectorAll("[data-workspace-tab]")),
            panels: Array.from(document.querySelectorAll("[data-workspace-panel]")),
            chartSearchInput: document.getElementById("chartSearchInput"),
            chartSearchResults: document.getElementById("chartSearchResults"),
            explorerStatus: document.getElementById("chartExplorerStatus"),
            explorerSummary: document.getElementById("explorerAssetSummary"),
            explorerPanel: document.getElementById("chartExplorerPanel"),
            watchlistContainer: document.getElementById("watchlistContainer"),
            compareTray: document.getElementById("compareTray"),
            compareActionBtn: document.getElementById("compareActionBtn"),
            plannerRiskProfile: document.getElementById("plannerRiskProfile"),
            plannerMonthlyContribution: document.getElementById("plannerMonthlyContribution"),
            plannerInitialCapital: document.getElementById("plannerInitialCapital"),
            plannerHorizonYears: document.getElementById("plannerHorizonYears"),
            plannerSearchInput: document.getElementById("plannerSearchInput"),
            plannerSearchResults: document.getElementById("plannerSearchResults"),
            plannerWeightStatus: document.getElementById("plannerWeightStatus"),
            plannerSummaryCards: document.getElementById("plannerSummaryCards"),
            plannerTableBody: document.getElementById("plannerTableBody"),
            plannerEmptyState: document.getElementById("plannerEmptyState"),
            plannerHelperCopy: document.getElementById("plannerHelperCopy"),
            plannerScenarioCards: document.getElementById("plannerScenarioCards"),
            plannerLeadName: document.getElementById("plannerLeadName"),
            plannerLeadEmail: document.getElementById("plannerLeadEmail"),
            plannerLeadConsent: document.getElementById("plannerLeadConsent"),
            plannerSubmitBtn: document.getElementById("plannerSubmitBtn"),
            plannerSubmitStatus: document.getElementById("plannerSubmitStatus"),
        };
    }

    createDefaultPlannerDraft() {
        return {
            riskProfile: DEFAULT_PLANNER_DRAFT.riskProfile,
            monthlyContribution: DEFAULT_PLANNER_DRAFT.monthlyContribution,
            initialCapital: DEFAULT_PLANNER_DRAFT.initialCapital,
            horizonYears: DEFAULT_PLANNER_DRAFT.horizonYears,
            scenarioRates: { ...DEFAULT_PLANNER_DRAFT.scenarioRates },
            allocations: [],
        };
    }

    async initialize() {
        this.bindTabs();
        this.bindChartExplorer();
        this.bindPlanner();
        this.bindPlanLeadCapture();
        this.chat.setMarketContextListener((payload) => this.handleMarketContext(payload));
        this.setPlannerControlValues();
        this.recalculatePlannerDraft();
        this.renderPlannerDerived();
        this.renderWatchlist();
        this.renderCompareTray();
        this.setExplorerStatus("Preparando el explorador de activos...", "neutral");
        await this.refreshWatchlistQuotes();
        this.renderWatchlist();
        await this.selectAsset(this.state.watchlist[0], { rangeKey: DEFAULT_RANGE, preserveTab: true });
    }

    bindTabs() {
        this.refs.tabButtons.forEach((button) => {
            button.addEventListener("click", () => {
                this.switchTab(button.dataset.workspaceTab || "chat");
            });
        });
    }

    switchTab(tab) {
        this.state.activeTab = tab;

        this.refs.tabButtons.forEach((button) => {
            button.classList.toggle("is-active", button.dataset.workspaceTab === tab);
        });

        this.refs.panels.forEach((panel) => {
            panel.classList.toggle("is-active", panel.dataset.workspacePanel === tab);
        });

        if (tab === "chat") {
            this.chat.ui.userInput.focus();
        }
    }

    bindChartExplorer() {
        this.attachAutocomplete({
            key: "chart",
            input: this.refs.chartSearchInput,
            results: this.refs.chartSearchResults,
            onSelect: (item) => {
                const query = item.symbol || item.name || "";
                if (!query) return;
                this.refs.chartSearchInput.value = item.symbol || item.name || "";
                void this.selectAsset(query, { preserveTab: true });
            },
        });

        this.refs.compareActionBtn?.addEventListener("click", () => {
            if (this.state.compareSelection.length < 2) return;
            this.switchTab("chat");
            this.chat.queueMessage(`Comparame ${this.state.compareSelection.join(" vs ")}`);
        });
    }

    bindPlanner() {
        this.refs.plannerRiskProfile?.addEventListener("change", (event) => {
            this.state.plannerDraft.riskProfile = event.target.value || "moderado";
            this.renderPlannerDerived();
        });

        this.refs.plannerMonthlyContribution?.addEventListener("input", (event) => {
            this.state.plannerDraft.monthlyContribution = this.parseMoneyValue(event.target.value, 0);
            this.recalculatePlannerDraft();
            this.renderPlannerDerived();
        });

        this.refs.plannerInitialCapital?.addEventListener("input", (event) => {
            this.state.plannerDraft.initialCapital = this.parseMoneyValue(event.target.value, 0);
            this.recalculatePlannerDraft();
            this.renderPlannerDerived();
        });

        this.refs.plannerHorizonYears?.addEventListener("input", (event) => {
            this.state.plannerDraft.horizonYears = this.parseMoneyValue(event.target.value, 0);
            this.recalculatePlannerDraft();
            this.renderPlannerDerived();
        });

        this.attachAutocomplete({
            key: "planner",
            input: this.refs.plannerSearchInput,
            results: this.refs.plannerSearchResults,
            onSelect: (item) => {
                if (!item.symbol) return;
                this.refs.plannerSearchInput.value = "";
                this.addAssetToPlanner(item);
            },
        });
    }

    bindPlanLeadCapture() {
        this.refs.plannerSubmitBtn?.addEventListener("click", () => {
            void this.submitPlannerLead();
        });
    }

    setPlannerControlValues() {
        if (this.refs.plannerRiskProfile) {
            this.refs.plannerRiskProfile.value = this.state.plannerDraft.riskProfile;
        }
        if (this.refs.plannerMonthlyContribution) {
            this.refs.plannerMonthlyContribution.value = String(this.state.plannerDraft.monthlyContribution);
        }
        if (this.refs.plannerInitialCapital) {
            this.refs.plannerInitialCapital.value = String(this.state.plannerDraft.initialCapital);
        }
        if (this.refs.plannerHorizonYears) {
            this.refs.plannerHorizonYears.value = String(this.state.plannerDraft.horizonYears);
        }
    }

    attachAutocomplete({ key, input, results, onSelect }) {
        if (!input || !results) return;

        results.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });

        input.addEventListener("input", () => {
            const query = input.value.trim();
            this.scheduleSearch(key, query, onSelect);
        });

        input.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.renderSearchResults(key, []);
                return;
            }

            if (event.key !== "Enter") return;
            event.preventDefault();

            const query = input.value.trim();
            if (!query) return;

            const firstMatch = this.searchState[key]?.items?.[0] || null;
            if (firstMatch) {
                onSelect(firstMatch);
                this.renderSearchResults(key, []);
                return;
            }

            onSelect({
                symbol: query.toUpperCase(),
                name: query,
                quote_type_label: "Activo",
                exchange: "Mercado",
            });
            this.renderSearchResults(key, []);
        });

        input.addEventListener("blur", () => {
            window.setTimeout(() => this.renderSearchResults(key, []), 120);
        });
    }

    scheduleSearch(key, query, onSelect) {
        const state = this.searchState[key];
        if (!state) return;

        clearTimeout(state.timer);

        if (query.length < 2) {
            this.renderSearchResults(key, []);
            return;
        }

        state.timer = window.setTimeout(async () => {
            const requestId = state.requestId + 1;
            state.requestId = requestId;

            try {
                const payload = await this.fetchJson(
                    `${this.assetSearchUrl}?q=${encodeURIComponent(query)}`,
                );
                if (state.requestId !== requestId) {
                    return;
                }

                const items = Array.isArray(payload?.items) ? payload.items : [];
                state.items = items;
                this.renderSearchResults(key, items, onSelect);
            } catch (error) {
                if (state.requestId !== requestId) {
                    return;
                }

                state.items = [];
                this.renderSearchResults(key, [], onSelect);
            }
        }, 180);
    }

    renderSearchResults(key, items, onSelect = null) {
        const results =
            key === "chart" ? this.refs.chartSearchResults : this.refs.plannerSearchResults;
        if (!results) return;

        results.innerHTML = "";
        results.classList.toggle("hidden", !items.length);

        items.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "asset-search-result";
            button.addEventListener("click", () => {
                if (typeof onSelect === "function") {
                    onSelect(item);
                }
                this.renderSearchResults(key, []);
            });

            const title = document.createElement("strong");
            title.textContent = `${item.symbol} | ${item.name || item.symbol}`;

            const meta = document.createElement("span");
            meta.textContent = `${item.quote_type_label || "Activo"} | ${item.exchange || "Mercado"}`;

            button.append(title, meta);
            results.appendChild(button);
        });
    }

    async refreshWatchlistQuotes() {
        const settled = await Promise.allSettled(
            this.state.watchlist.map((symbol) => this.fetchAssetQuote(symbol)),
        );

        settled.forEach((result, index) => {
            if (result.status !== "fulfilled" || !result.value?.symbol) return;
            this.state.watchlistData.set(
                this.state.watchlist[index],
                this.normalizeAsset(result.value),
            );
        });
    }

    async selectAsset(query, { rangeKey = null, preserveTab = false } = {}) {
        const targetRange = rangeKey || this.state.selectedRange || DEFAULT_RANGE;
        this.setExplorerStatus(`Cargando ${String(query).toUpperCase()}...`, "loading");

        try {
            const [assetResult, chartResult] = await Promise.allSettled([
                this.fetchAssetQuote(query),
                this.fetchAssetChart(query, targetRange),
            ]);

            const asset =
                assetResult.status === "fulfilled" && assetResult.value
                    ? this.normalizeAsset(assetResult.value)
                    : null;
            const chart =
                chartResult.status === "fulfilled" && chartResult.value
                    ? chartResult.value
                    : null;

            if (!asset && !chart) {
                throw new Error("No market data available");
            }

            const nextAsset = this.buildResolvedAsset(asset, chart, query);
            this.state.selectedAsset = nextAsset;
            this.state.selectedChart = chart;
            this.state.selectedRange = chart?.range || targetRange;
            this.state.watchlistData.set(nextAsset.symbol, nextAsset);
            this.ensureWatchlistSymbol(nextAsset.symbol);
            this.renderWatchlist();
            this.renderExplorer();
            this.setExplorerStatus(
                `${nextAsset.symbol} listo para explorar, comparar o llevar al planificador.`,
                "success",
            );

            if (!preserveTab) {
                this.switchTab("charts");
            }
        } catch (error) {
            this.setExplorerStatus(
                "No he podido cargar ese activo ahora mismo. Prueba con otro ticker o nombre.",
                "error",
            );
        }
    }

    buildResolvedAsset(asset, chart, fallbackQuery) {
        const symbol = asset?.symbol || chart?.symbol || String(fallbackQuery).toUpperCase();
        const name = asset?.name || chart?.name || symbol;
        const quoteTypeLabel =
            asset?.quote_type_label || this.formatInstrumentType(chart?.instrument_type) || "Activo";

        return {
            symbol,
            name,
            quote_type_label: quoteTypeLabel,
            quote_type: asset?.quote_type || chart?.instrument_type || null,
            exchange: asset?.exchange || chart?.exchange || "Mercado",
            currency: asset?.currency || chart?.currency || "USD",
            price: asset?.price ?? chart?.summary?.last_price ?? null,
            change_percent: asset?.change_percent ?? chart?.summary?.change_percent ?? null,
            market_cap: asset?.market_cap ?? null,
            volume: asset?.volume ?? null,
            fifty_two_week_low: asset?.fifty_two_week_low ?? null,
            fifty_two_week_high: asset?.fifty_two_week_high ?? null,
            asset_link: asset?.asset_link || "",
        };
    }

    normalizeAsset(asset) {
        return {
            ...asset,
            symbol: asset.symbol || "",
            name: asset.name || asset.symbol || "",
            quote_type_label: asset.quote_type_label || asset.quote_type || "Activo",
            exchange: asset.exchange || "Mercado",
        };
    }

    ensureWatchlistSymbol(symbol) {
        const cleanedSymbol = String(symbol || "").toUpperCase().trim();
        if (!cleanedSymbol) return;

        const current = this.state.watchlist.filter((item) => item !== cleanedSymbol);
        current.unshift(cleanedSymbol);
        this.state.watchlist = current.slice(0, 12);
    }

    setExplorerStatus(message, tone = "neutral") {
        if (!this.refs.explorerStatus) return;

        this.refs.explorerStatus.textContent = message;
        this.refs.explorerStatus.dataset.tone = tone;
        this.refs.explorerStatus.classList.toggle("is-hidden", !message);
    }

    renderExplorer() {
        this.renderExplorerSummary();
        this.renderExplorerChart();
    }

    renderExplorerSummary() {
        if (!this.refs.explorerSummary) return;

        const asset = this.state.selectedAsset;
        this.refs.explorerSummary.innerHTML = "";

        if (!asset) {
            const empty = document.createElement("div");
            empty.className = "workspace-empty-card";
            empty.innerHTML =
                "<h3>Busca un activo para empezar</h3><p>Escribe un ticker o nombre para cargar la ficha, la gráfica y la lectura técnica.</p>";
            this.refs.explorerSummary.appendChild(empty);
            return;
        }

        const shell = document.createElement("section");
        shell.className = "explorer-asset-card";

        const top = document.createElement("div");
        top.className = "explorer-asset-top";

        const titleGroup = document.createElement("div");
        titleGroup.className = "panel-title-group";

        const eyebrow = document.createElement("span");
        eyebrow.className = "panel-kicker";
        eyebrow.textContent = `${asset.quote_type_label || "Activo"} | ${asset.exchange || "Mercado"}`;

        const title = document.createElement("h2");
        title.className = "explorer-asset-title";
        title.textContent = `${asset.symbol} | ${asset.name || asset.symbol}`;

        const subtitle = document.createElement("p");
        subtitle.className = "panel-subtitle";
        subtitle.textContent = `Rango activo: ${this.state.selectedChart?.range || this.state.selectedRange}`;

        titleGroup.append(eyebrow, title, subtitle);

        const trend = document.createElement("div");
        trend.className = `trend-pill ${(asset.change_percent || 0) >= 0 ? "is-positive" : "is-negative"}`;
        trend.textContent = formatPercent(asset.change_percent);

        top.append(titleGroup, trend);

        const metrics = document.createElement("div");
        metrics.className = "metric-grid explorer-metric-grid";
        metrics.append(
            this.chat.createMetricCard("Precio", formatCurrency(asset.price, asset.currency)),
            this.chat.createMetricCard("Cambio diario", formatPercent(asset.change_percent)),
            this.chat.createMetricCard("Capitalización", formatCompactNumber(asset.market_cap)),
            this.chat.createMetricCard("Volumen", formatCompactNumber(asset.volume)),
        );

        const actions = document.createElement("div");
        actions.className = "explorer-action-row";

        const analyzeBtn = this.createActionButton("Analizar en chat", "primary");
        analyzeBtn.addEventListener("click", () => {
            this.switchTab("chat");
            this.chat.queueMessage(`Cómo ves ${asset.symbol} a ${this.state.selectedRange}`);
        });

        const compareBtn = this.createActionButton(
            this.state.compareSelection.includes(asset.symbol) ? "Quitar de la comparativa" : "Comparar",
            "ghost",
        );
        compareBtn.addEventListener("click", () => {
            this.toggleCompareAsset(asset.symbol);
            this.renderExplorerSummary();
            this.renderWatchlist();
        });

        const addToPlanBtn = this.createActionButton("Añadir al plan", "secondary");
        addToPlanBtn.addEventListener("click", () => {
            this.addAssetToPlanner(asset);
            this.switchTab("planner");
        });

        actions.append(analyzeBtn, compareBtn, addToPlanBtn);
        shell.append(top, metrics, actions);
        this.refs.explorerSummary.appendChild(shell);
    }

    renderExplorerChart() {
        if (!this.refs.explorerPanel) return;

        this.refs.explorerPanel.innerHTML = "";

        if (!this.state.selectedChart?.points?.length) {
            const empty = document.createElement("div");
            empty.className = "workspace-empty-card";
            empty.innerHTML =
                "<h3>Gráfica no disponible</h3><p>No he podido montar el histórico de este activo en este momento.</p>";
            this.refs.explorerPanel.appendChild(empty);
            return;
        }

        this.refs.explorerPanel.appendChild(
            this.chat.buildChartPanel(this.state.selectedChart, this.state.selectedAsset),
        );
    }

    renderWatchlist() {
        if (!this.refs.watchlistContainer) return;

        this.refs.watchlistContainer.innerHTML = "";

        this.state.watchlist.forEach((symbol) => {
            const asset = this.state.watchlistData.get(symbol) || {
                symbol,
                name: symbol,
                quote_type_label: "Activo",
                exchange: "Mercado",
            };
            const button = document.createElement("button");
            button.type = "button";
            button.className = "watchlist-card";
            if (this.state.selectedAsset?.symbol === symbol) {
                button.classList.add("is-active");
            }
            if (this.state.compareSelection.includes(symbol)) {
                button.classList.add("is-compared");
            }
            button.addEventListener("click", () => {
                void this.selectAsset(symbol, { preserveTab: true });
            });

            const top = document.createElement("div");
            top.className = "watchlist-card-top";

            const title = document.createElement("strong");
            title.textContent = symbol;

            const tone = document.createElement("span");
            tone.className = `watchlist-chip ${(asset.change_percent || 0) >= 0 ? "is-positive" : "is-negative"}`;
            tone.textContent = formatPercent(asset.change_percent);

            top.append(title, tone);

            const name = document.createElement("span");
            name.className = "watchlist-name";
            name.textContent = asset.name || symbol;

            const price = document.createElement("span");
            price.className = "watchlist-price";
            price.textContent = formatCurrency(asset.price, asset.currency);

            button.append(top, name, price);
            this.refs.watchlistContainer.appendChild(button);
        });
    }

    createActionButton(label, tone = "ghost") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `insight-button insight-button-${tone}`;
        button.textContent = label;
        return button;
    }

    toggleCompareAsset(symbol) {
        const cleanedSymbol = String(symbol || "").toUpperCase().trim();
        if (!cleanedSymbol) return;

        const current = [...this.state.compareSelection];
        const index = current.indexOf(cleanedSymbol);

        if (index >= 0) {
            current.splice(index, 1);
        } else {
            if (current.length >= 4) {
                current.shift();
            }
            current.push(cleanedSymbol);
        }

        this.state.compareSelection = current;
        this.renderCompareTray();
    }

    renderCompareTray() {
        if (!this.refs.compareTray || !this.refs.compareActionBtn) return;

        this.refs.compareTray.innerHTML = "";

        if (!this.state.compareSelection.length) {
            const empty = document.createElement("p");
            empty.className = "compare-empty";
            empty.textContent = "Marca activos para lanzar una comparativa rápida en el chat.";
            this.refs.compareTray.appendChild(empty);
        } else {
            this.state.compareSelection.forEach((symbol) => {
                const asset = this.state.watchlistData.get(symbol);
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = "compare-chip";
                chip.textContent = asset?.symbol || symbol;
                chip.addEventListener("click", () => {
                    this.toggleCompareAsset(symbol);
                    this.renderExplorerSummary();
                    this.renderWatchlist();
                });
                this.refs.compareTray.appendChild(chip);
            });
        }

        this.refs.compareActionBtn.disabled = this.state.compareSelection.length < 2;
    }

    handleMarketContext(payload) {
        const asset = payload?.asset ? this.normalizeAsset(payload.asset) : null;
        const chart = payload?.chart || null;

        if (asset?.symbol) {
            this.state.watchlistData.set(asset.symbol, {
                ...this.state.watchlistData.get(asset.symbol),
                ...asset,
            });
            this.ensureWatchlistSymbol(asset.symbol);
            this.renderWatchlist();
        }

        if (chart?.symbol && this.state.selectedAsset?.symbol === chart.symbol) {
            this.state.selectedChart = chart;
            this.state.selectedRange = chart.range || this.state.selectedRange;
            this.renderExplorerSummary();
        }
    }

    addAssetToPlanner(asset) {
        const normalized = this.normalizeAsset(asset);
        const exists = this.state.plannerDraft.allocations.some(
            (item) => item.symbol === normalized.symbol,
        );

        if (!exists) {
            this.state.plannerDraft.allocations.push({
                symbol: normalized.symbol,
                name: normalized.name || normalized.symbol,
                type: normalized.quote_type_label || "Activo",
                weightPercent: this.getSuggestedWeight(),
                monthlyAmount: 0,
                initialAmount: 0,
            });
        }

        this.recalculatePlannerDraft();
        this.renderPlannerDerived();
    }

    getSuggestedWeight() {
        const totalWeight = this.state.plannerDraft.allocations.reduce(
            (sum, item) => sum + this.parseMoneyValue(item.weightPercent, 0),
            0,
        );

        if (totalWeight <= 0) return 100;

        const remaining = Math.max(0, 100 - totalWeight);
        return Number(remaining.toFixed(2));
    }

    recalculatePlannerDraft() {
        const draft = this.state.plannerDraft;
        draft.allocations = draft.allocations.map((item) => {
            const weightPercent = this.parseMoneyValue(item.weightPercent, 0);
            return {
                ...item,
                weightPercent,
                monthlyAmount: Number(
                    ((draft.monthlyContribution * weightPercent) / 100).toFixed(2),
                ),
                initialAmount: Number(
                    ((draft.initialCapital * weightPercent) / 100).toFixed(2),
                ),
            };
        });
    }

    renderPlannerDerived() {
        this.recalculatePlannerDraft();
        this.renderPlannerWeightStatus();
        this.renderPlannerSummaryCards();
        this.renderPlannerAllocations();
        this.renderPlannerHelper();
        this.renderPlannerScenarios();
    }

    renderPlannerWeightStatus() {
        if (!this.refs.plannerWeightStatus) return;

        const totalWeight = this.getPlannerTotalWeight();
        const remaining = Number((100 - totalWeight).toFixed(2));

        this.refs.plannerWeightStatus.className = "planner-weight-status";

        if (!this.state.plannerDraft.allocations.length) {
            this.refs.plannerWeightStatus.textContent =
                "Añade acciones o ETFs para empezar a construir el plan.";
            return;
        }

        if (totalWeight > 100) {
            this.refs.plannerWeightStatus.classList.add("is-danger");
            this.refs.plannerWeightStatus.textContent = `Estás asignando ${totalWeight.toFixed(2)}%: ajusta pesos para no superar tu presupuesto.`;
            return;
        }

        if (remaining > 0) {
            this.refs.plannerWeightStatus.classList.add("is-warning");
            this.refs.plannerWeightStatus.textContent = `Tienes ${remaining.toFixed(2)}% sin asignar. Puedes dejarlo en liquidez o repartirlo.`;
            return;
        }

        this.refs.plannerWeightStatus.classList.add("is-success");
        this.refs.plannerWeightStatus.textContent =
            "Plan equilibrado al 100% del presupuesto definido.";
    }

    renderPlannerSummaryCards() {
        if (!this.refs.plannerSummaryCards) return;

        const totalWeight = this.getPlannerTotalWeight();
        const allocatedMonthly = this.state.plannerDraft.allocations.reduce(
            (sum, item) => sum + item.monthlyAmount,
            0,
        );
        const allocatedInitial = this.state.plannerDraft.allocations.reduce(
            (sum, item) => sum + item.initialAmount,
            0,
        );
        const totalContributed =
            allocatedInitial +
            allocatedMonthly * Math.max(this.state.plannerDraft.horizonYears, 0) * 12;

        this.refs.plannerSummaryCards.innerHTML = "";
        [
            ["Peso asignado", `${totalWeight.toFixed(2)}%`],
            ["Mensual asignado", formatCurrency(allocatedMonthly, "EUR")],
            ["Capital inicial", formatCurrency(allocatedInitial, "EUR")],
            ["Total aportado", formatCurrency(totalContributed, "EUR")],
        ].forEach(([label, value]) => {
            this.refs.plannerSummaryCards.appendChild(this.chat.createMetricCard(label, value));
        });
    }

    renderPlannerAllocations() {
        if (!this.refs.plannerTableBody || !this.refs.plannerEmptyState) return;

        this.refs.plannerTableBody.innerHTML = "";
        this.refs.plannerEmptyState.classList.toggle(
            "hidden",
            this.state.plannerDraft.allocations.length > 0,
        );

        this.state.plannerDraft.allocations.forEach((item, index) => {
            const row = document.createElement("tr");

            const assetCell = document.createElement("td");
            assetCell.className = "planner-asset-cell";

            const symbolButton = document.createElement("button");
            symbolButton.type = "button";
            symbolButton.className = "planner-symbol-button";
            symbolButton.textContent = item.symbol;
            symbolButton.addEventListener("click", () => {
                this.switchTab("charts");
                void this.selectAsset(item.symbol, { preserveTab: true });
            });

            const meta = document.createElement("div");
            meta.className = "planner-asset-meta";
            meta.innerHTML = `<strong>${item.name || item.symbol}</strong><span>${item.type || "Activo"}</span>`;

            assetCell.append(symbolButton, meta);

            const typeCell = document.createElement("td");
            typeCell.textContent = item.type || "Activo";

            const weightCell = document.createElement("td");
            const weightInput = document.createElement("input");
            weightInput.type = "number";
            weightInput.min = "0";
            weightInput.step = "0.5";
            weightInput.value = String(item.weightPercent);
            weightInput.className = "planner-weight-input";
            weightInput.addEventListener("change", (event) => {
                this.state.plannerDraft.allocations[index].weightPercent = this.parseMoneyValue(
                    event.target.value,
                    0,
                );
                this.renderPlannerDerived();
            });
            weightCell.appendChild(weightInput);

            const monthlyCell = document.createElement("td");
            monthlyCell.textContent = formatCurrency(item.monthlyAmount, "EUR");

            const initialCell = document.createElement("td");
            initialCell.textContent = formatCurrency(item.initialAmount, "EUR");

            const actionsCell = document.createElement("td");
            actionsCell.className = "planner-actions-cell";

            const chartButton = this.createActionButton("Gráfica", "ghost");
            chartButton.addEventListener("click", () => {
                this.switchTab("charts");
                void this.selectAsset(item.symbol, { preserveTab: true });
            });

            const removeButton = this.createActionButton("Quitar", "ghost");
            removeButton.addEventListener("click", () => {
                this.state.plannerDraft.allocations.splice(index, 1);
                this.renderPlannerDerived();
            });

            actionsCell.append(chartButton, removeButton);

            row.append(assetCell, typeCell, weightCell, monthlyCell, initialCell, actionsCell);
            this.refs.plannerTableBody.appendChild(row);
        });
    }

    renderPlannerHelper() {
        if (!this.refs.plannerHelperCopy) return;
        this.refs.plannerHelperCopy.textContent =
            RISK_PROFILE_COPY[this.state.plannerDraft.riskProfile] || RISK_PROFILE_COPY.moderado;
    }

    renderPlannerScenarios() {
        if (!this.refs.plannerScenarioCards) return;

        const scenarioLabels = {
            prudente: "Escenario prudente",
            base: "Escenario base",
            dinamico: "Escenario dinámico",
        };

        this.refs.plannerScenarioCards.innerHTML = "";

        Object.entries(this.state.plannerDraft.scenarioRates).forEach(([key, rate]) => {
            const projectedValue = this.simulateFutureValue(rate);
            const investedCapital = this.getPlannerInvestedCapital();
            const gain = projectedValue - investedCapital;

            const card = document.createElement("article");
            card.className = "scenario-card";

            const top = document.createElement("div");
            top.className = "scenario-card-top";

            const title = document.createElement("strong");
            title.textContent = scenarioLabels[key] || key;

            const inputWrap = document.createElement("label");
            inputWrap.className = "scenario-rate-label";
            inputWrap.innerHTML = "<span>Tasa anual</span>";

            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.step = "0.5";
            input.value = String(rate);
            input.className = "scenario-rate-input";
            input.addEventListener("change", (event) => {
                this.state.plannerDraft.scenarioRates[key] = this.parseMoneyValue(
                    event.target.value,
                    0,
                );
                this.renderPlannerScenarios();
            });
            inputWrap.appendChild(input);

            top.append(title, inputWrap);

            const value = document.createElement("strong");
            value.className = "scenario-value";
            value.textContent = formatCurrency(projectedValue, "EUR");

            const copy = document.createElement("p");
            copy.className = "scenario-copy";
            copy.textContent =
                "Simulación orientativa, no rentabilidad garantizada. Toda inversión implica riesgo.";

            const detail = document.createElement("p");
            detail.className = "scenario-copy scenario-copy-secondary";
            detail.textContent = `Capital aportado: ${formatCurrency(investedCapital, "EUR")} | Diferencia potencial: ${formatCurrency(gain, "EUR")}`;

            card.append(top, value, copy, detail);
            this.refs.plannerScenarioCards.appendChild(card);
        });
    }

    async submitPlannerLead() {
        const email = (this.refs.plannerLeadEmail?.value || "").trim();
        const name = (this.refs.plannerLeadName?.value || "").trim();
        const consent = Boolean(this.refs.plannerLeadConsent?.checked);

        if (!this.state.plannerDraft.allocations.length) {
            this.setPlannerSubmitStatus(
                "Primero añade al menos una acción o ETF al plan antes de enviarlo.",
                "error",
            );
            return;
        }

        if (!email) {
            this.setPlannerSubmitStatus("Necesitas indicar un email antes de enviar el plan.", "error");
            return;
        }

        if (!consent) {
            this.setPlannerSubmitStatus(
                "Hay que marcar el consentimiento antes de enviar el plan.",
                "error",
            );
            return;
        }

        const payload = {
            name,
            email,
            consent,
            risk_profile: this.state.plannerDraft.riskProfile,
            monthly_contribution: this.state.plannerDraft.monthlyContribution,
            initial_capital: this.state.plannerDraft.initialCapital,
            horizon_years: this.state.plannerDraft.horizonYears,
            total_weight: this.getPlannerTotalWeight(),
            scenario_rates: { ...this.state.plannerDraft.scenarioRates },
            allocations: this.state.plannerDraft.allocations.map((item) => ({
                symbol: item.symbol,
                name: item.name,
                type: item.type,
                weight_percent: item.weightPercent,
                monthly_amount: item.monthlyAmount,
                initial_amount: item.initialAmount,
            })),
            notes: "",
        };

        if (this.refs.plannerSubmitBtn) {
            this.refs.plannerSubmitBtn.disabled = true;
        }
        this.setPlannerSubmitStatus("Enviando plan...", "loading");

        try {
            const response = await fetch(this.planLeadUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            this.setPlannerSubmitStatus(
                "Plan enviado correctamente por correo.",
                "success",
            );
        } catch (error) {
            this.setPlannerSubmitStatus(
                "No he podido enviar este plan ahora mismo. Prueba de nuevo en unos segundos.",
                "error",
            );
        } finally {
            if (this.refs.plannerSubmitBtn) {
                this.refs.plannerSubmitBtn.disabled = false;
            }
        }
    }

    setPlannerSubmitStatus(message, tone = "neutral") {
        if (!this.refs.plannerSubmitStatus) return;
        this.refs.plannerSubmitStatus.textContent = message;
        this.refs.plannerSubmitStatus.dataset.tone = tone;
    }

    getPlannerTotalWeight() {
        return this.state.plannerDraft.allocations.reduce(
            (sum, item) => sum + this.parseMoneyValue(item.weightPercent, 0),
            0,
        );
    }

    getPlannerInvestedCapital() {
        const draft = this.state.plannerDraft;
        return (
            draft.allocations.reduce((sum, item) => sum + item.initialAmount, 0) +
            draft.allocations.reduce((sum, item) => sum + item.monthlyAmount, 0) *
                Math.max(draft.horizonYears, 0) *
                12
        );
    }

    simulateFutureValue(annualRate) {
        const draft = this.state.plannerDraft;
        const months = Math.max(Math.round(draft.horizonYears * 12), 0);
        const monthlyContribution = draft.allocations.reduce(
            (sum, item) => sum + item.monthlyAmount,
            0,
        );
        const initialCapital = draft.allocations.reduce((sum, item) => sum + item.initialAmount, 0);
        const rate = Math.max(this.parseMoneyValue(annualRate, 0), 0) / 100;

        if (months === 0) {
            return Number(initialCapital.toFixed(2));
        }

        if (rate === 0) {
            return Number((initialCapital + monthlyContribution * months).toFixed(2));
        }

        const monthlyRate = rate / 12;
        const capitalGrowth = initialCapital * Math.pow(1 + monthlyRate, months);
        const contributionsGrowth =
            monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
        return Number((capitalGrowth + contributionsGrowth).toFixed(2));
    }

    parseMoneyValue(value, fallback = 0) {
        const numeric = Number(String(value).replace(",", "."));
        if (!Number.isFinite(numeric)) return fallback;
        return Number(numeric.toFixed(2));
    }

    formatInstrumentType(value) {
        if (!value) return null;
        const normalized = String(value).toUpperCase();
        if (normalized === "EQUITY") return "Accion";
        if (normalized === "ETF") return "ETF";
        if (normalized === "INDEX") return "Indice";
        if (normalized === "CRYPTOCURRENCY") return "Cripto";
        return value;
    }

    async fetchAssetQuote(query) {
        return this.fetchJson(
            `${this.assetQuoteUrl}?ticker=${encodeURIComponent(String(query || "").trim())}`,
        );
    }

    async fetchAssetChart(query, rangeKey) {
        return this.fetchJson(
            `${this.assetChartUrl}?ticker=${encodeURIComponent(String(query || "").trim())}&range=${encodeURIComponent(rangeKey || DEFAULT_RANGE)}`,
        );
    }

    async fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return response.json();
    }
}

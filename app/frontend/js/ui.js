import { buildChartSvg, formatCompactNumber, formatCurrency, formatPercent, getChartDirection } from "./chart-utils.js";

const BOT_LABEL = "Analista IA";

export class ChatUI {
    constructor(chatContainer, userInput, sendBtn, clearBtn) {
        this.chatContainer = chatContainer;
        this.userInput = userInput;
        this.sendBtn = sendBtn;
        this.clearBtn = clearBtn;
        this.chatActivity = document.getElementById("chatActivity");
        this.chatActivityText = document.getElementById("chatActivityText");
        this.chatEmpty = document.getElementById("chatEmpty");
        this.featuredImage = document.getElementById("featuredImage");
        this.featuredImageLink = document.getElementById("featuredImageLink");
        this.featuredPlaceholder = document.getElementById("featuredPlaceholder");
        this.featuredChart = document.getElementById("featuredChart");
        this.featuredStats = document.getElementById("featuredStats");
        this.featuredEyebrow = document.getElementById("featuredEyebrow");
        this.featuredTitle = document.getElementById("featuredTitle");
        this.featuredBody = document.getElementById("featuredBody");
        this.featuredStage = this.featuredChart?.closest(".stage-screen") || null;
        this.screenCopy = document.getElementById("screenCopy");
        this.screenLoadingRail = document.getElementById("screenLoadingRail");
        this.featuredLink = document.getElementById("featuredLink");
        this.featuredResetBtn = document.getElementById("featuredResetBtn");
        this.channelPrevBtn = document.getElementById("channelPrevBtn");
        this.channelNextBtn = document.getElementById("channelNextBtn");
        this.channelCounter = document.getElementById("channelCounter");
        this.featuredRequestId = 0;
        this.afterClear = null;
        this.afterScreenReset = null;

        this.defaultFeaturedState = {
            eyebrow: "Panel IA",
            title: "Cargando el pulso del mercado",
            body: "Estoy preparando un resumen visual de activos, contexto y oportunidades para que puedas cambiar de panel sin salir del chat.",
            asset: null,
            chart: null,
        };

        this.clearBtn.addEventListener("click", () => this.clearChat());
        this.featuredResetBtn?.addEventListener("click", () => {
            if (typeof this.afterScreenReset === "function") {
                this.afterScreenReset();
            }
        });
        this.showFeaturedState(this.defaultFeaturedState);
        this.setChannelCounter();
        this.setChannelNavigationEnabled(false);
        this.toggleEmptyState();
    }

    setClearHandler(handler) {
        this.afterClear = handler;
    }

    setScreenResetHandler(handler) {
        this.afterScreenReset = handler;
    }

    createMessage(role, label = role === "user" ? "Tú" : BOT_LABEL) {
        const wrapper = document.createElement("article");
        wrapper.classList.add("message", role);

        const meta = document.createElement("div");
        meta.className = "message-meta";
        meta.textContent = `${label} | ${this.getTimeLabel()}`;

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";

        wrapper.append(meta, bubble);
        return { wrapper, bubble };
    }

    getTimeLabel() {
        return new Intl.DateTimeFormat("es-ES", {
            hour: "2-digit",
            minute: "2-digit",
        }).format(new Date());
    }

    scrollToBottom({ deferred = false } = {}) {
        const scroll = () => {
            if (!this.chatContainer) return;
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        };

        scroll();

        if (deferred) {
            requestAnimationFrame(() => {
                requestAnimationFrame(scroll);
            });
        }
    }

    appendBlock(node) {
        this.chatContainer.appendChild(node);
        this.toggleEmptyState();
        this.scrollToBottom({ deferred: true });

        node.querySelectorAll("img").forEach((image) => {
            image.addEventListener("load", () => this.scrollToBottom({ deferred: true }), {
                once: true,
            });
            image.addEventListener("error", () => this.scrollToBottom({ deferred: true }), {
                once: true,
            });
        });
    }

    focusBlock(node, { block = "start" } = {}) {
        if (!node) return;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                node.scrollIntoView({
                    behavior: "auto",
                    block,
                    inline: "nearest",
                });
            });
        });
    }

    addUserMessage(text) {
        const { wrapper, bubble } = this.createMessage("user");
        bubble.textContent = text;
        this.appendBlock(wrapper);
    }

    async addBotMessageTyping(text, speed = 4) {
        return new Promise((resolve) => {
            const { wrapper, bubble } = this.createMessage("bot");
            const source = text ?? "";
            let index = 0;

            bubble.classList.add("is-typing");
            this.renderRichText(bubble, "", { isTyping: true });
            this.appendBlock(wrapper);

            const typeChar = () => {
                index = Math.min(source.length, index + 1);
                this.renderRichText(bubble, source.slice(0, index), { isTyping: index < source.length });
                this.scrollToBottom();

                if (index >= source.length) {
                    bubble.classList.remove("is-typing");
                    resolve();
                    return;
                }

                setTimeout(typeChar, speed);
            };

            typeChar();
        });
    }

    renderRichText(container, text, options = {}) {
        const normalized = (text ?? "").replace(/\r\n/g, "\n");
        const content = normalized.replace(/^\n+/, "");

        container.innerHTML = "";
        container.classList.toggle("is-typing", Boolean(options.isTyping));

        if (!content.trim()) {
            const paragraph = document.createElement("p");
            if (options.isTyping) {
                paragraph.appendChild(this.createCaret());
            }
            container.appendChild(paragraph);
            return;
        }

        const blocks = content.split(/\n{2,}/);

        blocks.forEach((block) => {
            const lines = block.split("\n");
            const meaningfulLines = lines.filter((line) => line.trim().length > 0);

            if (!meaningfulLines.length) {
                return;
            }

            const isBulletList = meaningfulLines.every((line) => /^[*-]\s+/.test(line.trim()));
            const isNumberedList = meaningfulLines.every((line) => /^\d+\.\s+/.test(line.trim()));
            const isHeading = meaningfulLines.length === 1 && /^\*\*[^*][\s\S]*\*\*$/.test(meaningfulLines[0].trim());

            if (isHeading) {
                const heading = document.createElement("h4");
                heading.textContent = meaningfulLines[0].trim().slice(2, -2);
                container.appendChild(heading);
                return;
            }

            if (isBulletList || isNumberedList) {
                const list = document.createElement(isNumberedList ? "ol" : "ul");

                meaningfulLines.forEach((line) => {
                    const item = document.createElement("li");
                    const cleanedLine = isNumberedList
                        ? line.replace(/^\d+\.\s+/, "")
                        : line.replace(/^[*-]\s+/, "");
                    this.appendInlineFormatting(item, cleanedLine);
                    list.appendChild(item);
                });

                container.appendChild(list);
                return;
            }

            const paragraph = document.createElement("p");

            lines.forEach((line, lineIndex) => {
                this.appendInlineFormatting(paragraph, line);

                if (lineIndex < lines.length - 1) {
                    paragraph.appendChild(document.createElement("br"));
                }
            });

            container.appendChild(paragraph);
        });

        if (options.isTyping) {
            this.attachCaretToLastRenderable(container);
        }
    }

    appendInlineFormatting(container, text) {
        const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

        parts.forEach((part) => {
            if (!part) return;

            if (/^\*\*[^*]+\*\*$/.test(part)) {
                const strong = document.createElement("strong");
                strong.textContent = part.slice(2, -2);
                container.appendChild(strong);
                return;
            }

            if (/^`[^`]+`$/.test(part)) {
                const code = document.createElement("code");
                code.textContent = part.slice(1, -1);
                container.appendChild(code);
                return;
            }

            container.appendChild(document.createTextNode(part));
        });
    }

    createCaret() {
        const caret = document.createElement("span");
        caret.className = "typing-caret";
        caret.setAttribute("aria-hidden", "true");
        return caret;
    }

    attachCaretToLastRenderable(container) {
        const lastNode = container.lastElementChild;
        if (!lastNode) return;

        if (lastNode.matches("ul, ol")) {
            const lastItem = lastNode.lastElementChild;
            if (lastItem) {
                lastItem.appendChild(this.createCaret());
            }
            return;
        }

        lastNode.appendChild(this.createCaret());
    }

    showFeaturedState({
        eyebrow,
        title,
        body,
        imageUrl,
        linkUrl,
        linkLabel,
        chart,
        asset,
        isLoading = false,
    } = {}) {
        const nextState = {
            ...this.defaultFeaturedState,
            eyebrow,
            title,
            body: body ?? this.defaultFeaturedState.body,
            linkUrl,
            linkLabel,
            chart,
            asset,
            isLoading,
        };

        if (this.featuredEyebrow) {
            this.featuredEyebrow.textContent = nextState.eyebrow;
        }

        if (this.featuredTitle) {
            this.featuredTitle.textContent = nextState.title;
        }

        if (this.featuredBody) {
            this.renderRichText(this.featuredBody, nextState.body);
        }

        this.setFeaturedLoading(Boolean(nextState.isLoading));
        this.setFeaturedLink(nextState.linkUrl, nextState.linkLabel || "Ver activo");
        this.setFeaturedStats(asset, chart);

        if (chart?.points?.length) {
            this.showFeaturedChart(chart);
            return;
        }

        if (imageUrl) {
            this.showFeaturedImage(imageUrl);
            return;
        }

        this.hideFeaturedVisuals();
    }

    setFeaturedStats(asset, chart) {
        if (!this.featuredStats) return;

        const chips = [];

        if (asset?.price !== null && asset?.price !== undefined) {
            chips.push({
                label: "Precio",
                value: formatCurrency(asset.price, asset.currency),
                tone: "neutral",
            });
        }

        if (asset?.change_percent !== null && asset?.change_percent !== undefined) {
            const changeTone = asset.change_percent >= 0 ? "positive" : "negative";
            chips.push({
                label: "Día",
                value: formatPercent(asset.change_percent),
                tone: changeTone,
            });
        }

        if (chart?.summary?.change_percent !== null && chart?.summary?.change_percent !== undefined) {
            const chartTone = chart.summary.change_percent >= 0 ? "positive" : "negative";
            chips.push({
                label: chart.range || "Rango",
                value: formatPercent(chart.summary.change_percent),
                tone: chartTone,
            });
        }

        if (asset?.market_cap) {
            chips.push({
                label: "Cap.",
                value: formatCompactNumber(asset.market_cap),
                tone: "neutral",
            });
        }

        if (!chips.length) {
            this.featuredStats.innerHTML = "";
            this.featuredStats.classList.add("hidden");
            return;
        }

        this.featuredStats.innerHTML = "";
        chips.forEach((chip) => {
            const item = document.createElement("div");
            item.className = `stat-chip stat-chip-${chip.tone}`;

            const label = document.createElement("span");
            label.className = "stat-chip-label";
            label.textContent = chip.label;

            const value = document.createElement("strong");
            value.className = "stat-chip-value";
            value.textContent = chip.value;

            item.append(label, value);
            this.featuredStats.appendChild(item);
        });
        this.featuredStats.classList.remove("hidden");
    }

    setFeaturedVisualMode(mode = "default") {
        const hasChart = mode === "chart";
        this.featuredStage?.classList.toggle("has-chart", hasChart);
        this.screenCopy?.classList.toggle("has-chart", hasChart);
    }

    showFeaturedChart(chart) {
        if (!this.featuredChart) return;

        const direction = getChartDirection(chart);
        this.featuredChart.innerHTML = buildChartSvg(chart, { compact: true });
        this.featuredChart.classList.remove("hidden");
        this.featuredChart.dataset.direction = direction;
        this.setFeaturedVisualMode("chart");
        this.hideFeaturedImage();
        this.featuredPlaceholder?.classList.add("hidden");
    }

    showFeaturedImage(imageUrl) {
        if (!this.featuredImage || !this.featuredPlaceholder) return;

        this.setFeaturedVisualMode("image");
        this.featuredChart?.classList.add("hidden");
        this.featuredChart && (this.featuredChart.innerHTML = "");

        const requestId = ++this.featuredRequestId;

        this.featuredImage.onload = () => {
            if (requestId !== this.featuredRequestId) return;
            this.featuredImage.classList.remove("hidden");
            this.featuredImageLink?.classList.remove("hidden");
            this.featuredPlaceholder.classList.add("hidden");
        };

        this.featuredImage.onerror = () => {
            if (requestId !== this.featuredRequestId) return;
            this.hideFeaturedVisuals();
        };

        this.featuredImage.src = imageUrl;

        if (this.featuredImage.complete && this.featuredImage.naturalWidth > 0) {
            this.featuredImage.onload?.();
        }
    }

    hideFeaturedImage() {
        this.featuredRequestId += 1;

        if (this.featuredImage) {
            this.featuredImage.onload = null;
            this.featuredImage.onerror = null;
            this.featuredImage.classList.add("hidden");
            this.featuredImage.removeAttribute("src");
        }

        if (this.featuredImageLink) {
            this.featuredImageLink.classList.add("hidden");
        }
    }

    hideFeaturedVisuals() {
        this.setFeaturedVisualMode("default");
        this.hideFeaturedImage();
        if (this.featuredChart) {
            this.featuredChart.classList.add("hidden");
            this.featuredChart.innerHTML = "";
        }
        this.featuredPlaceholder?.classList.remove("hidden");
    }

    resetFeaturedState() {
        this.showFeaturedState(this.defaultFeaturedState);
        this.setChannelCounter();
        this.setChannelNavigationEnabled(false);
    }

    setFeaturedLink(linkUrl, linkLabel = "Ver activo") {
        if (!this.featuredLink) return;

        if (!linkUrl) {
            this.featuredLink.classList.add("hidden");
            this.featuredLink.removeAttribute("href");
            this.featuredImageLink?.removeAttribute("href");
            this.featuredImageLink?.classList.add("is-disabled");
            return;
        }

        this.featuredLink.href = linkUrl;
        this.featuredLink.textContent = linkLabel;
        this.featuredLink.classList.remove("hidden");
        this.featuredImageLink?.setAttribute("href", linkUrl);
        this.featuredImageLink?.classList.remove("is-disabled");
    }

    setFeaturedLoading(isLoading) {
        this.screenCopy?.classList.toggle("is-loading", isLoading);
        this.screenLoadingRail?.classList.toggle("hidden", !isLoading);
    }

    setChannelCounter(current = 1, total = 1) {
        if (!this.channelCounter) return;
        this.channelCounter.textContent = `${current} / ${total}`;
    }

    setChannelNavigationEnabled(isEnabled) {
        [this.channelPrevBtn, this.channelNextBtn].forEach((button) => {
            if (!button) return;
            button.disabled = !isEnabled;
        });
    }

    setPendingState(isPending) {
        if (this.chatActivity) {
            this.chatActivity.classList.toggle("is-thinking", isPending);
        }

        if (this.chatActivityText) {
            this.chatActivityText.textContent = isPending
                ? "Analizando mercado, contexto y riesgo"
                : "Pregunta por un activo, un ETF o un plan de inversión";
        }
    }

    toggleEmptyState() {
        if (!this.chatEmpty) return;
        this.chatEmpty.classList.toggle("hidden", this.chatContainer.children.length > 0);
    }

    clearChat() {
        if (!confirm("¿Seguro que quieres borrar la conversación?")) return;
        this.chatContainer.innerHTML = "";
        this.userInput.value = "";
        this.setPendingState(false);
        this.resetFeaturedState();
        this.toggleEmptyState();
        this.userInput.focus();

        if (typeof this.afterClear === "function") {
            this.afterClear();
        }
    }
}

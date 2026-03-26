export class ChatController {
    constructor(ui, avatar, apiUrl) {
        this.ui = ui;
        this.avatar = avatar;
        this.apiUrl = apiUrl;
        this.liveFeedUrl = "/live-feed";

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
            "Buenas, soy tu presentador IA.\n\n" +
            "Puedo darte titulares del d\u00eda, resumir noticias por tema, explicar la actualidad de forma sencilla y mostrar im\u00e1genes relacionadas cuando existan.";

        await this.ui.addBotMessageTyping(welcomeMessage);
        this.pushHistory("assistant", welcomeMessage);
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
            const channels = this.shuffleItems(
                this.buildChannelItemsFromArticles(data.articles, data.topic || "actualidad general"),
            );

            if (!channels.length) {
                throw new Error("Live feed returned no channels");
            }

            this.defaultScreenChannels = channels;

            if (forceDisplay || this.isShowingDefaultFeed || !this.activeScreenChannels.length) {
                this.setActiveScreenChannels(this.defaultScreenChannels, { isDefault: true });
            }
        } catch (error) {
            if (this.activeScreenChannels.length) {
                return;
            }

            this.ui.showFeaturedState({
                eyebrow: "Se\u00f1al",
                title: "No he podido cargar los temas en directo",
                body: "Prueba de nuevo en unos segundos o usa el chat para buscar una noticia concreta.",
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

    buildChannelItemsFromArticles(articles, topic) {
        const safeArticles = Array.isArray(articles) ? articles : [];
        const fallbackImageUrl =
            safeArticles
                .map((article) => this.getCleanImageUrl(article.image_url))
                .find(Boolean) || "";

        return safeArticles
            .map((article) => ({
                eyebrow: article.source || topic || "Actualidad general",
                title: article.title || topic || "Actualidad general",
                body: [
                    article.description || "Cambia de canal para seguir otra noticia de la emisi\u00f3n en directo.",
                    article.source ? `**Fuente:** ${article.source}` : "",
                    article.published_at ? `**Actualizado:** ${this.formatPublishedAt(article.published_at)}` : "",
                ]
                    .filter(Boolean)
                    .join("\n\n"),
                imageUrl: this.getCleanImageUrl(article.image_url) || fallbackImageUrl,
                linkUrl: article.url || "",
                linkLabel: "Abrir noticia",
            }))
            .filter((item) => item.title);
    }

    buildChannelItemsFromPhotos(photos, topic) {
        return this.sanitizeImageUrls(photos).map((imageUrl, index) => ({
            eyebrow: topic || "Galer\u00eda visual",
            title: topic ? `Im\u00e1genes de ${topic}` : `Imagen en directo ${index + 1}`,
            body: "Cambia de canal para ver otra imagen relacionada con la cobertura.",
            imageUrl,
        }));
    }

    truncateText(value, maxLength = 68) {
        const normalized = (value || "").trim().replace(/\s+/g, " ");

        if (normalized.length <= maxLength) {
            return normalized;
        }

        return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
    }

    parseScreenNarrative(text, fallbackTitle) {
        const normalized = (text || "").replace(/\r\n/g, "\n").trim();

        if (!normalized) {
            return {
                title: fallbackTitle,
                body: "Estoy siguiendo esta cobertura en directo.",
            };
        }

        const blocks = normalized
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);

        let title = fallbackTitle;
        let bodyBlocks = [...blocks];

        if (bodyBlocks.length) {
            const rawFirstBlock = bodyBlocks[0];
            const firstBlock = rawFirstBlock.replace(/^\*\*([^*]+)\*\*$/, "$1").trim();
            const looksLikeTitle =
                rawFirstBlock.split("\n").length === 1 &&
                firstBlock.length <= 96 &&
                !/^[*-]\s/.test(firstBlock) &&
                !/^\d+\.\s/.test(firstBlock);

            if (looksLikeTitle) {
                title = firstBlock;
                bodyBlocks = bodyBlocks.slice(1);
            }
        }

        return {
            title,
            body: bodyBlocks.join("\n\n") || normalized,
        };
    }

    buildChatScreenChannel(data) {
        const safeArticles = Array.isArray(data.articles) ? data.articles : [];
        const safePhotos = this.sanitizeImageUrls(data.photos);
        const featuredArticle =
            safeArticles.find((article) => this.getCleanImageUrl(article.image_url)) || safeArticles[0] || null;
        const fallbackTitle = featuredArticle?.title || data.topic || "Cobertura";
        const parsedNarrative = this.parseScreenNarrative(data.bot_message, fallbackTitle);

        return {
            eyebrow: featuredArticle?.source || data.topic || "Cobertura",
            title: parsedNarrative.title,
            body: parsedNarrative.body,
            imageUrl: this.getCleanImageUrl(featuredArticle?.image_url) || safePhotos[0] || "",
            linkUrl: featuredArticle?.url || "",
            linkLabel: "Abrir noticia",
        };
    }

    showLoadingState(query) {
        const currentChannel = this.activeScreenChannels[this.activeScreenChannelIndex] || this.defaultScreenChannels[0];
        const searchLabel = this.truncateText(query);

        this.ui.showFeaturedState({
            eyebrow: "Preparando bolet\u00edn",
            title: `Cargando noticias sobre ${searchLabel}`,
            body:
                "**Buscando fuentes fiables**\n\n" +
                "- reuniendo titulares y contexto\n" +
                "- ordenando la cobertura para pantalla\n" +
                "- preparando el resumen del chat",
            imageUrl: currentChannel?.imageUrl || "",
            isLoading: true,
        });
        this.ui.setChannelCounter(1, 1);
        this.ui.setChannelNavigationEnabled(false);
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

    buildImageGallery(photos) {
        const safePhotos = this.sanitizeImageUrls(photos);

        if (!safePhotos.length) {
            return null;
        }

        const galleryBlock = document.createElement("section");
        galleryBlock.className = "chat-gallery";

        const galleryTop = document.createElement("div");
        galleryTop.className = "gallery-top";

        const galleryHeading = document.createElement("div");
        galleryHeading.className = "gallery-heading";
        galleryHeading.textContent = "Im\u00e1genes relacionadas";

        const gallerySubtitle = document.createElement("div");
        gallerySubtitle.className = "gallery-subtitle";
        gallerySubtitle.textContent =
            safePhotos.length === 1
                ? "1 imagen disponible"
                : `${safePhotos.length} im\u00e1genes disponibles`;

        galleryTop.append(galleryHeading, gallerySubtitle);

        const gallery = document.createElement("div");
        gallery.className = "photo-gallery";

        safePhotos.forEach((src, index) => {
            const photoButton = document.createElement("button");
            photoButton.type = "button";
            photoButton.className = "photo-card";
            photoButton.setAttribute("aria-label", `Abrir imagen ${index + 1}`);

            const img = document.createElement("img");
            img.src = src;
            img.alt = `Imagen relacionada ${index + 1}`;
            img.className = "chat-photo";
            this.decorateRemoteImage(img, () => {
                photoButton.remove();
            });

            const copy = document.createElement("div");
            copy.className = "photo-card-copy";

            const title = document.createElement("span");
            title.textContent = `Imagen ${index + 1}`;

            const action = document.createElement("span");
            action.textContent = "Ampliar";

            copy.append(title, action);
            photoButton.append(img, copy);

            photoButton.addEventListener("click", () => {
                this.openViewer(index);
            });

            gallery.appendChild(photoButton);
        });

        galleryBlock.append(galleryTop, gallery);
        return galleryBlock;
    }

    buildNewsDeck(articles, topic) {
        const newsDeck = document.createElement("section");
        newsDeck.className = "news-deck";

        const deckTop = document.createElement("div");
        deckTop.className = "gallery-top";

        const deckHeading = document.createElement("div");
        deckHeading.className = "gallery-heading";
        deckHeading.textContent = "Cobertura";

        const deckSubtitle = document.createElement("div");
        deckSubtitle.className = "gallery-subtitle";
        deckSubtitle.textContent = topic || "Actualidad general";

        deckTop.append(deckHeading, deckSubtitle);

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
                image.alt = article.title || "Imagen de la noticia";
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

            const title = document.createElement("h3");
            title.textContent = article.title;

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
            body.append(meta, title, description, footer);
            card.appendChild(body);
            grid.appendChild(card);
        });

        const deckActions = document.createElement("div");
        deckActions.className = "deck-actions";

        [
            {
                label: "Resumen en 3 puntos",
                prompt: `Res\u00famelo en 3 puntos sobre ${topic || "estas noticias"}`,
            },
            {
                label: "Expl\u00edcamelo f\u00e1cil",
                prompt: `Expl\u00edcamelo f\u00e1cil sobre ${topic || "estas noticias"}`,
            },
        ].forEach(({ label, prompt }) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "quick-action";
            button.textContent = label;
            button.addEventListener("click", () => this.queueMessage(prompt));
            deckActions.appendChild(button);
        });

        newsDeck.append(deckTop, grid, deckActions);
        return { block: newsDeck, photoUrls: this.sanitizeImageUrls(photoUrls) };
    }

    showCoverageOnScreen(data) {
        const screenChannel = this.buildChatScreenChannel(data);
        this.setActiveScreenChannels([screenChannel], { isDefault: false });
    }

    showConversationalState() {
        this.resumeDefaultLiveFeed();
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

            if ((data.articles && data.articles.length) || (data.photos && data.photos.length) || data.topic) {
                this.showCoverageOnScreen(data);
            } else {
                this.showConversationalState();
            }

            await this.ui.addBotMessageTyping(data.bot_message);

            this.pushHistory("user", text);
            this.pushHistory("assistant", data.bot_message);

            if (data.articles && data.articles.length) {
                const deck = this.buildNewsDeck(data.articles, data.topic);
                this.currentPhotos = deck.photoUrls;
                this.brokenPhotoUrls.clear();
                this.ui.appendBlock(deck.block);
            } else if (data.photos && data.photos.length) {
                const safePhotos = this.sanitizeImageUrls(data.photos);
                this.currentPhotos = safePhotos;
                this.brokenPhotoUrls.clear();

                const gallery = this.buildImageGallery(safePhotos);
                if (gallery) {
                    this.ui.appendBlock(gallery);
                }
            } else {
                this.currentPhotos = [];
                this.brokenPhotoUrls.clear();
            }
        } catch (error) {
            const fallbackMessage = "No he podido conectar con el servicio de noticias ahora mismo.";
            this.ui.showFeaturedState({
                eyebrow: "Se\u00f1al",
                title: "Conexi\u00f3n no disponible",
                body: "No he podido preparar esta cobertura ahora mismo. Pulsa en `Noticias del d\u00eda` para volver al directo general.",
                imageUrl:
                    this.activeScreenChannels[this.activeScreenChannelIndex]?.imageUrl ||
                    this.defaultScreenChannels[0]?.imageUrl ||
                    "",
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
}

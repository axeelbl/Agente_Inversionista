import { AvatarController } from "./avatar.js?v=20260720-assets";
import { ChatController } from "./chat.js";
import { ChatUI } from "./ui.js";
import { InvestorWorkspace } from "./workspace.js";

document.addEventListener("DOMContentLoaded", () => {
    const avatar = new AvatarController(
        document.getElementById("baseFace"),
        document.getElementById("mouthOpenImg"),
        document.getElementById("avatarHalo"),
        document.getElementById("avatar"),
        document.getElementById("avatarStatus"),
    );

    const ui = new ChatUI(
        document.getElementById("chatContainer"),
        document.getElementById("userInput"),
        document.getElementById("sendBtn"),
        document.getElementById("clearBtn"),
    );

    const chat = new ChatController(ui, avatar, "/chat");
    const workspace = new InvestorWorkspace(chat);

    document.querySelectorAll("[data-prompt]").forEach((button) => {
        button.addEventListener("click", () => {
            chat.queueMessage(button.dataset.prompt || "");
        });
    });

    void workspace.initialize();

    setTimeout(() => {
        void chat.showWelcomeMessage();
    }, 300);
});

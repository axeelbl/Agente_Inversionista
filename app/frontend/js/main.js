import { AvatarController } from "./avatar.js";
import { ChatController } from "./chat.js";
import { ChatUI } from "./ui.js";

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

    document.querySelectorAll("[data-prompt]").forEach((button) => {
        button.addEventListener("click", () => {
            chat.queueMessage(button.dataset.prompt || "");
        });
    });

    setTimeout(() => {
        void chat.showWelcomeMessage();
    }, 300);
});

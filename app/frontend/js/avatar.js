export class AvatarController {
    constructor(baseFace, mouthOpenImg, avatarHalo, avatar, avatarStatus) {
        this.baseFace = baseFace;
        this.mouthOpenImg = mouthOpenImg;
        this.avatarHalo = avatarHalo;
        this.avatar = avatar;
        this.avatarStatus = avatarStatus;

        this.mouthOpen = false;
        this.talkingInterval = null;

        this.startBlinking();
    }

    startBlinking() {
        setInterval(() => {
            if (this.talkingInterval) return;

            this.baseFace.src = "/agents/inversionista/pictures/eyes_closed_mouth_closed.png";

            setTimeout(() => {
                this.baseFace.src = "/agents/inversionista/pictures/eyes_open_mouth_closed.png";
            }, 200);
        }, 4000);
    }

    startTalking() {
        if (this.talkingInterval) return;

        this.avatarHalo.style.opacity = "1";
        this.avatar.style.transform = "scale(1.03)";

        this.talkingInterval = setInterval(() => {
            this.mouthOpen = !this.mouthOpen;
            this.mouthOpenImg.style.opacity = this.mouthOpen ? "1" : "0";
        }, 300);

        this.avatarStatus.textContent = "Analizando";
    }

    stopTalking() {
        clearInterval(this.talkingInterval);
        this.talkingInterval = null;
        this.mouthOpen = false;
        this.mouthOpenImg.style.opacity = "0";
        this.avatarHalo.style.opacity = "0";
        this.avatar.style.transform = "scale(1)";
        this.avatarStatus.textContent = "Mercado listo";
    }
}

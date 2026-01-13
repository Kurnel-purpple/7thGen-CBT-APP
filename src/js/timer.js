/**
 * Timer Class
 * Handles countdown and events
 */

class Timer {
    constructor(durationMinutes, onTick, onExpire) {
        this.totalSeconds = durationMinutes * 60;
        this.remainingSeconds = this.totalSeconds;
        this.onTick = onTick;
        this.onExpire = onExpire;
        this.intervalId = null;
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.intervalId = setInterval(() => {
            this.remainingSeconds--;
            this.onTick(this.formatTime(this.remainingSeconds), this.remainingSeconds);

            if (this.remainingSeconds <= 0) {
                this.stop();
                this.onExpire();
            }
        }, 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;

        const pad = (num) => num.toString().padStart(2, '0');
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    setRemaining(seconds) {
        this.remainingSeconds = seconds;
    }
}

window.Timer = Timer;

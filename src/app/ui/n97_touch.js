import { bind_phone_touch } from "./phone_touch.js";
import { N97_TOUCH_WIDTH, N97_TOUCH_HEIGHT } from "../../symbian/n97_touch.js";

/** @param {HTMLElement} screen @param {(x: number, y: number, down: boolean) => void} send @param {() => boolean} ready */
export function n97_touch_surface(screen, send, ready)
{
    const stage = screen.parentElement;
    screen.classList.add("n97-touch-screen");
    screen.setAttribute("aria-label", "Nokia N97 display and touchscreen");
    stage.classList.add("n97-screen-stage");
    let landscape = false, scale = 1;
    const width = () => landscape ? N97_TOUCH_WIDTH : N97_TOUCH_HEIGHT;
    const height = () => landscape ? N97_TOUCH_HEIGHT : N97_TOUCH_WIDTH;
    const resize = () => stage.style.setProperty("--n97-display-width", width() * scale + "px");
    // Invert the portrait mode's SCR_ROTATION1=270 transform (WsPointer::HandleRawEvent).
    const release = bind_phone_touch(screen, () => ({ width: width(), height: height() }),
        (x, y) => landscape ? [x, y] : [y, N97_TOUCH_HEIGHT - 1 - x], send, ready);
    resize();
    return {
        release,
        set_fit(room_width, room_height)
        {
            scale = Math.max(0.1, Math.min(room_width / width(), room_height / height()));
            resize();
        },
        set_slider(open)
        {
            if(open === landscape) return;
            release();
            landscape = open;
            screen.dataset.landscape = String(open);
            resize();
        },
        set_scale(value) { scale = value; resize(); },
    };
}

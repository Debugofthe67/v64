// @ts-check
import { h, replace } from "./dom.js";
import { sis_card_files } from "../../symbian/sis_card.js";

/** @param {Awaited<ReturnType<typeof sis_card_files>>} packages */
export function package_paths(packages)
{
    return h("ul", null, packages.map(({ file, path }) => h("li", null, file.name, " → ", h("code", null, path))));
}

/** @param {(packages: Awaited<ReturnType<typeof sis_card_files>>) => Promise<void>} attach */
export function show_sis_transfer(attach)
{
    return new Promise(resolve => {
        const element = /** @type {HTMLDialogElement} */ (h("dialog.dialog.sis-transfer", { "aria-labelledby": "sis-transfer-title" }));
        const input = /** @type {HTMLInputElement} */ (h("input", { type: "file", accept: ".sis,.sisx", multiple: true }));
        const paths = h("div"), status = h("p", { role: "status" });
        let controller = new AbortController(), busy = false;
        /** @type {Awaited<ReturnType<typeof sis_card_files>>} */
        let packages = [];
        const close = () => { controller.abort(); element.close(); element.remove(); resolve(undefined); };
        const cancel = /** @type {HTMLButtonElement} */ (h("button", { type: "button", onclick: close }, "Cancel"));
        const use = /** @type {HTMLButtonElement} */ (h("button.primary", { type: "button", disabled: true, onclick: async () => {
            if(busy || !packages.length) return;
            busy = input.disabled = cancel.disabled = use.disabled = true;
            status.textContent = "Writing the new microSD and preparing to power off…";
            try
            {
                await attach(packages);
                close();
            }
            catch(error)
            {
                status.textContent = error.message;
                busy = input.disabled = cancel.disabled = false;
                use.disabled = false;
            }
        } }, "Prepare card and power off"));
        input.onchange = async () => {
            controller.abort();
            const { signal } = controller = new AbortController();
            const files = Array.from(input.files || []);
            packages = [];
            use.disabled = true;
            replace(paths);
            status.textContent = files.length ? "Checking packages…" : "";
            if(!files.length) return;
            try
            {
                const result = await sis_card_files(files, signal);
                if(signal.aborted) return;
                packages = result;
                replace(paths, package_paths(packages));
                status.textContent = "";
                use.disabled = false;
            }
            catch(error)
            {
                if(!signal.aborted) status.textContent = error.message;
            }
        };
        element.append(h("form", { method: "dialog", onsubmit: event => event.preventDefault() },
            h("h2#sis-transfer-title", null, "Send SIS/SISX to Nokia N97"),
            h("div.dialog-body", null,
                h("p", null, "The VM will power off and attach a new microSD for the next boot. Open the packages from F:\\INSTALL in the phone's file manager."),
                h("p.note", null, "Powering off discards unsaved guest work. Symbian handles installation and decides whether to accept each package."),
                h("label.field", null, h("span", null, "Local SIS/SISX packages"), input), paths, status),
            h("div.dialog-buttons", null, cancel, use)));
        element.addEventListener("cancel", event => { event.preventDefault(); if(!busy) close(); });
        document.body.append(element);
        element.showModal();
        input.focus();
    });
}

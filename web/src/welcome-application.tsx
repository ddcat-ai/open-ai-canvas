import "@/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getWelcomeAvailability } from "@/services/api/welcome";
import WelcomePage from "@/pages/welcome";
import { translate } from "@/i18n";
import { installSiteTrafficCollector } from "@/services/site-traffic";

let disposeTraffic: (() => void) | undefined;
let disposed = false;
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; disposeTraffic?.(); });

async function renderWelcome() {
    try {
        const { welcomeEnabled } = await getWelcomeAvailability();
        if (disposed) return;
        if (welcomeEnabled !== true) {
            window.location.replace("/");
            return;
        }
        createRoot(document.getElementById("root")!).render(<StrictMode><WelcomePage /></StrictMode>);
        disposeTraffic = installSiteTrafficCollector();
    } catch (error) {
        if (disposed) return;
        console.error("Welcome page initialization failed", error);
        createRoot(document.getElementById("root")!).render(
            <main role="alert">
                <p>{translate("account.welcome.openFailed")}</p>
                <button onClick={() => window.location.reload()}>{translate("common.retry")}</button>
                <a href="/">{translate("auth.backHome")}</a>
            </main>,
        );
    }
}

void renderWelcome();

import { runLocalRuntimeBootstrap } from "@/services/local-runtime-bootstrap";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";

runLocalRuntimeBootstrap(
    {
        get href() {
            return window.location.href;
        },
        replaceUrl(url) {
            window.history.replaceState(window.history.state, "", url);
        },
        removeStorageItem(key) {
            window.localStorage.removeItem(key);
        },
    },
    () => {
        void bootstrapAppearance().finally(() => import("./application"));
    },
);

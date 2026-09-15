import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { bootstrapAppearance } from "@/services/appearance-bootstrap";

// The public film entry checks its availability independently of workspace bootstrap.
if (/^\/welcome\/?$/.test(window.location.pathname)) void import("./welcome-application");
else void bootstrapAppearance().finally(() => import("./application"));

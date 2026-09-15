import { http } from "./request";

export function getWelcomeAvailability() {
    return http.get<{ welcomeEnabled: boolean }>("/public/welcome");
}

import { bootstrapAppearance } from "@/services/appearance-bootstrap";
import "./application";

// Mount the application immediately. Appearance is a background enhancement and
// must not leave the root empty while its public configuration request is pending.
void bootstrapAppearance();

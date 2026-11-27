/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_CHANGELOG__: string;

interface ImportMetaEnv {
    readonly VITE_AUDIO_STEM_MODEL_BASE_URL?: string;
    readonly VITE_APP_VERSION?: string;
    readonly VITE_BUILD_COMMIT?: string;
    readonly VITE_BUILD_TIME?: string;
}

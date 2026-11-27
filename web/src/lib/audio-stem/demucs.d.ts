declare module "demucs-web/processor" {
    export class DemucsProcessor {
        constructor(options: { ort: typeof import("onnxruntime-web"); sessionOptions: import("onnxruntime-web").InferenceSession.SessionOptions; onProgress: (event: { progress: number }) => void });
        loadModel(model: ArrayBuffer): Promise<void>;
        separate(left: Float32Array, right: Float32Array): Promise<import("./contracts").SeparationResult>;
    }
}

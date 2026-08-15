import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { stageReferences } from "../src/dreamina-cli-staging.js";
import { DreaminaCliError } from "../src/dreamina-cli-process.js";

type MediaCase = {
    kind: "image" | "video" | "audio";
    extension: string;
    header: Buffer;
    field: "referenceImages" | "referenceVideos" | "referenceAudios";
};

const mediaCases: MediaCase[] = [
    { kind: "image", extension: ".png", header: Buffer.from("89504e470d0a1a0a", "hex"), field: "referenceImages" },
    { kind: "video", extension: ".mp4", header: Buffer.from("000000106674797069736f6d", "hex"), field: "referenceVideos" },
    { kind: "audio", extension: ".mp3", header: Buffer.from("49443304", "hex"), field: "referenceAudios" },
];

function requestFor(media: MediaCase, reference: string) {
    return {
        operation: "multimodal2video",
        idempotencyKey: `dreamina-staging-${media.kind}-0001`,
        prompt: "fixture",
        modelVersion: "seedance2.5",
        ratio: "16:9",
        videoResolution: "720p",
        duration: 4,
        [media.field]: [reference],
    } as Parameters<typeof stageReferences>[0];
}

async function rejectedCode(
    media: MediaCase,
    reference: string,
    root: string,
    stateRoot: string,
) {
    let result: Awaited<ReturnType<typeof stageReferences>> | undefined;
    let error: unknown;
    try {
        result = await stageReferences(requestFor(media, reference), [root], stateRoot);
    } catch (caught) {
        error = caught;
    } finally {
        await result?.cleanup();
    }
    return error instanceof DreaminaCliError ? error.code : "accepted";
}

test("Dreamina safe staging rejects traversal, root escape, links, oversize, header mismatch, and TOCTOU for all media groups", async () => {
    const box = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-staging-security-"));
    const owned = path.join(box, "owned");
    const outside = path.join(box, "outside");
    const stateRoot = path.join(box, "state");
    await Promise.all([fs.mkdir(owned), fs.mkdir(outside)]);
    const failures: string[] = [];

    try {
        for (const media of mediaCases) {
            const valid = path.join(owned, `valid-${media.kind}${media.extension}`);
            await fs.writeFile(valid, media.header);

            const nested = path.join(owned, `nested-${media.kind}`);
            await fs.mkdir(nested);
            const traversal = `${nested}${path.sep}..${path.sep}${path.basename(valid)}`;
            if (await rejectedCode(media, traversal, owned, stateRoot) !== "dreamina_reference_invalid") {
                failures.push(`${media.kind}:traversal`);
            }

            const escaped = path.join(outside, `escaped-${media.kind}${media.extension}`);
            await fs.writeFile(escaped, media.header);
            if (await rejectedCode(media, escaped, owned, stateRoot) !== "dreamina_reference_invalid") {
                failures.push(`${media.kind}:root-escape`);
            }

            const symbolic = path.join(owned, `symbolic-${media.kind}${media.extension}`);
            await fs.symlink(valid, symbolic, "file");
            if (await rejectedCode(media, symbolic, owned, stateRoot) !== "dreamina_reference_invalid") {
                failures.push(`${media.kind}:symlink`);
            }

            const hardSource = path.join(owned, `hard-source-${media.kind}${media.extension}`);
            const hardLink = path.join(owned, `hard-link-${media.kind}${media.extension}`);
            await fs.writeFile(hardSource, media.header);
            await fs.link(hardSource, hardLink);
            if (await rejectedCode(media, hardLink, owned, stateRoot) !== "dreamina_reference_invalid") {
                failures.push(`${media.kind}:hardlink`);
            }

            const oversized = path.join(owned, `oversized-${media.kind}${media.extension}`);
            const oversizedHandle = await fs.open(oversized, "w");
            await oversizedHandle.write(media.header, 0, media.header.length, 0);
            await oversizedHandle.truncate((media.kind === "image" ? 32 : 512) * 1024 * 1024 + 1);
            await oversizedHandle.close();
            if (await rejectedCode(media, oversized, owned, stateRoot) !== "dreamina_reference_invalid") {
                failures.push(`${media.kind}:oversize`);
            }

            const mismatch = path.join(owned, `mismatch-${media.kind}${media.extension}`);
            await fs.writeFile(mismatch, Buffer.from("not-media-header"));
            if (await rejectedCode(media, mismatch, owned, stateRoot) !== "dreamina_reference_invalid") {
                failures.push(`${media.kind}:header-mismatch`);
            }

            const changing = path.join(owned, `changing-${media.kind}${media.extension}`);
            const changingHandle = await fs.open(changing, "w");
            await changingHandle.write(media.header, 0, media.header.length, 0);
            await changingHandle.truncate(16 * 1024 * 1024);
            await changingHandle.close();
            const staging = rejectedCode(media, changing, owned, stateRoot);
            const mutator = (async () => {
                for (let attempt = 0; attempt < 40; attempt += 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1));
                    await fs.appendFile(changing, Buffer.from([attempt]));
                }
            })();
            const [toctouCode] = await Promise.all([staging, mutator]);
            if (toctouCode !== "dreamina_reference_invalid") failures.push(`${media.kind}:toctou`);

            const exchange = path.join(owned, `exchange-${media.kind}${media.extension}`);
            const replacement = path.join(owned, `exchange-replacement-${media.kind}${media.extension}`);
            const parked = path.join(owned, `exchange-parked-${media.kind}${media.extension}`);
            for (const candidate of [exchange, replacement]) {
                const handle = await fs.open(candidate, "w");
                await handle.write(media.header, 0, media.header.length, 0);
                await handle.truncate(16 * 1024 * 1024);
                await handle.close();
            }
            const exchanging = rejectedCode(media, exchange, owned, stateRoot);
            await new Promise((resolve) => setTimeout(resolve, 1));
            await fs.rename(exchange, parked);
            await fs.rename(replacement, exchange);
            if (await exchanging !== "dreamina_reference_invalid") failures.push(`${media.kind}:path-exchange`);
        }
        assert.deepEqual(failures, []);
    } finally {
        await fs.rm(box, { recursive: true, force: true });
    }
});

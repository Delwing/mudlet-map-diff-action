import * as core from "@actions/core";
import * as github from "@actions/github";
import {createDiff} from "mudlet-map-diff";
import cloudinaryUpload, {Diff} from "./cloudinary-upload.js";
import * as fs from "fs";
import * as path from "path";

// GitHub rejects issue comments longer than this, so a long report has to be
// spread over several comments.
const COMMENT_BODY_LIMIT = 65536;
// Slack for the collapsible wrapper and for the header growing by a digit once the
// part count is known.
const COMMENT_BODY_MARGIN = 512;

// Breaks up a piece of text that does not fit on its own, preferring line boundaries.
function hardWrap(text: string, budget: number): string[] {
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > budget) {
        let cut = rest.lastIndexOf("\n", budget);
        if (cut <= 0) {
            cut = budget;
        }
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest !== "") {
        chunks.push(rest);
    }
    return chunks;
}

// Every entry of the report ends with a horizontal rule, so those are the natural
// places to break the report apart.
function splitIntoSections(body: string): string[] {
    const separator = "\n---\n";
    const parts = body.split(separator);
    const sections = parts
        .map((part, index) => (index < parts.length - 1 ? part + separator : part))
        .filter((part) => part !== "");
    return sections.length > 0 ? sections : [body];
}

function packSections(sections: string[], budget: number): string[] {
    const bodies: string[] = [];
    let current = "";
    for (const section of sections) {
        for (const piece of hardWrap(section, budget)) {
            if (current !== "" && current.length + piece.length > budget) {
                bodies.push(current);
                current = "";
            }
            current += piece;
        }
    }
    if (current !== "") {
        bodies.push(current);
    }
    return bodies;
}

function buildCommentBodies(
    body: string,
    header: (part: number, total: number) => string,
    wrap: (body: string) => string
): string[] {
    const sections = splitIntoSections(body);
    let bodies: string[] = [];
    let total = 1;
    // The header states how many comments there are, which changes its own length,
    // so let the part count settle over a few passes.
    for (let attempt = 0; attempt < 5; attempt++) {
        const budget = COMMENT_BODY_LIMIT - header(total, total).length - COMMENT_BODY_MARGIN;
        bodies = packSections(sections, budget);
        if (bodies.length === total) {
            break;
        }
        total = bodies.length;
    }
    return bodies.map((part, index) => header(index + 1, bodies.length) + wrap(part));
}

async function run() {
    try {
        const context = github.context;

        if (context.payload.pull_request == null) {
            core.setFailed("No pull request found.");
            return;

        }

        const github_token = core.getInput("github-token", { required: true });
        const octokit = github.getOctokit(github_token, {
            userAgent: "mudlet-map-diff-action",
        });

        const oldMapPath = core.getInput("old-map", {required: true});
        const newMapInput = core.getInput("new-map");
        const newMapPath = newMapInput || oldMapPath;

        const pullRequest = context.payload.pull_request;
        const baseRepo = pullRequest.base.repo;
        const headRepo = pullRequest.head.repo;

        const fetchFile = async (repo: any, ref: string, filePath: string, dest: string) => {
            console.log(`Fetching ${filePath} from ${repo.full_name} @ ${ref}`);
            try {
                const {data} = await octokit.rest.repos.getContent({
                    owner: repo.owner.login,
                    repo: repo.name,
                    path: filePath,
                    ref: ref,
                });

                if (Array.isArray(data)) {
                    throw new Error(`Path ${filePath} is a directory, not a file.`);
                }

                const response = await fetch(data.download_url!)
                const arrayBuffer = await response.arrayBuffer()
                const buffer = Buffer.from(arrayBuffer)

                fs.writeFileSync(dest, buffer);
            } catch (e: any) {
                if (e.status === 404) {
                    throw new Error(`File ${filePath} not found in ${repo.full_name} @ ${ref}. If this is a private repository, ensure the token has sufficient permissions.`);
                }
                if (e.status === 403) {
                    throw new Error(`Permission denied when fetching ${filePath} from ${repo.full_name}. If this is a fork, use 'pull_request_target' event or a PAT.`);
                }
                throw e;
            }
        };

        const pull_request_number = context.payload.pull_request.number;
        const repository = (context.payload.repository as any).name;
        const owner = (context.payload.repository as any).owner.login;

        const reuseComment = core.getInput("reuse-comment") === "true";
        const collapseDiff = core.getInput("collapse-diff") === "true";
        const incremental = core.getInput("incremental") === "true" && !reuseComment;

        const headSha: string = pullRequest.head.sha;

        // Every report states which commit it covers, so the next run can pick up from there.
        const reportedShaPattern = /Comparing \[?`([0-9a-f]{7,40})`/;

        let previousComments: any[] = [];
        if (reuseComment || incremental) {
            const comments = await octokit.paginate(octokit.rest.issues.listComments, {
                owner: owner,
                repo: repository,
                issue_number: pull_request_number,
                per_page: 100,
            });
            previousComments = (comments as any[]).filter(
                (comment: any) => comment.body && comment.body.includes("## Mudlet Map Diff")
            );
        }

        let previousSha: string | null = null;
        if (incremental) {
            for (const comment of previousComments) {
                const match = reportedShaPattern.exec(comment.body);
                if (match) {
                    previousSha = match[1];
                }
            }
            // The reported SHA is abbreviated, so compare it as a prefix of the current head.
            if (previousSha && headSha.startsWith(previousSha)) {
                core.info(`Previous report already covers ${headSha}, diffing against base branch instead.`);
                previousSha = null;
            }
        }

        const tempOldMap = path.join(process.cwd(), "old_map.dat");
        const tempNewMap = path.join(process.cwd(), "new_map.dat");

        let comparedAgainst = `base branch \`${pullRequest.base.ref}\``;
        let fetchedOld = false;
        if (previousSha) {
            try {
                await fetchFile(headRepo, previousSha, newMapPath, tempOldMap);
                comparedAgainst = `previously reported commit \`${previousSha.substring(0, 7)}\``;
                fetchedOld = true;
            } catch (e: any) {
                core.warning(
                    `Could not fetch map from previously reported commit ${previousSha} (${e.message}). Falling back to the base branch.`
                );
            }
        }
        if (!fetchedOld) {
            await fetchFile(baseRepo, pullRequest.base.ref, oldMapPath, tempOldMap);
        }
        await fetchFile(headRepo, headSha, newMapPath, tempNewMap);

        console.log("Old map -> ", oldMapPath, " (saved to ", tempOldMap, ")", fs.statSync(tempOldMap).size);
        console.log("New map -> ", newMapPath, " (saved to ", tempNewMap, ")", fs.statSync(tempNewMap).size);

        console.log("Creating diff...");
        core.startGroup("Rendering progress");
        const diff: Diff = (await createDiff(tempOldMap, tempNewMap, {
            outDir: "diff",
            html: false,
            onProgress: (completed, total) => {
                core.info(`Rendering: ${completed}/${total}`);
            },
        })) as unknown as Diff;
        core.endGroup();
        let message = "";
        console.log("Diff created successfully");

        const cloud_name = process.env.CLOUDINARY_NAME;
        const cloud_key = process.env.CLOUDINARY_KEY;
        const cloud_secret = process.env.CLOUDINARY_SECRET;

        const summaryInput = core.getInput("summary") === "true";

        let images: Record<string, string> = {};
        if (cloud_name && cloud_key && cloud_secret) {
            images = await cloudinaryUpload(
                diff,
                `${owner}/${repository}`,
                pull_request_number,
                cloud_name,
                cloud_key,
                cloud_secret
            );
        }

        const formatValue = (v: any): string => Buffer.isBuffer(v) ? "[buffer]" : JSON.stringify(v);
        const formatDiff = (d: Record<string, { from: any; to: any }>) => {
            let res = "";
            for (const prop in d) {
                const {from, to} = d[prop];
                if (Buffer.isBuffer(from) || Buffer.isBuffer(to)) {
                    res += `- **${prop}**: [buffer changed]\n`;
                } else {
                    res += `- **${prop}**: \`${formatValue(from)}\` -> \`${formatValue(to)}\` \n`;
                }
            }
            return res;
        };

        // Rooms
        for (const room of diff.rooms.added) {
            message += `### Room (Added): ${room.id}\n`;
            if (images[room.id + "_added"]) {
                message += `![${room.id}](${images[room.id + "_added"]})\n`;
            }
            message += "\n---\n";
        }
        for (const room of diff.rooms.deleted) {
            message += `### Room (Deleted): ${room.id}\n`;
            if (images[room.id + "_deleted"]) {
                message += `![${room.id}](${images[room.id + "_deleted"]})\n`;
            }
            message += "\n---\n";
        }
        for (const roomId in diff.rooms.updated) {
            message += `### Room (Updated): ${roomId}\n`;
            if (images[roomId + "_updated"]) {
                message += `![${roomId}](${images[roomId + "_updated"]})\n`;
            }
            message += formatDiff(diff.rooms.updated[roomId]);
            message += "\n---\n";
        }

        // Labels
        for (const label of diff.labels.added) {
            message += `### Label (Added): ${label.id} (Area: ${label.areaId})\n`;
            if (images[label.areaId + "_" + label.id + "_added_label"]) {
                message += `![${label.id}](${
                    images[label.areaId + "_" + label.id + "_added_label"]
                })\n`;
            }
            message += "\n---\n";
        }
        for (const label of diff.labels.deleted) {
            message += `### Label (Deleted): ${label.id} (Area: ${label.areaId})\n`;
            if (images[label.areaId + "_" + label.id + "_deleted_label"]) {
                message += `![${label.id}](${
                    images[label.areaId + "_" + label.id + "_deleted_label"]
                })\n`;
            }
            message += "\n---\n";
        }
        for (const compositeId in diff.labels.updated) {
            const [areaId, labelId] = compositeId.split("-");
            message += `### Label (Updated): ${labelId} (Area: ${areaId})\n`;
            if (images[areaId + "_" + labelId + "_updated_label"]) {
                message += `![${labelId}](${
                    images[areaId + "_" + labelId + "_updated_label"]
                })\n`;
            }
            message += formatDiff(diff.labels.updated[compositeId]);
            message += "\n---\n";
        }

        // Areas
        for (const area of diff.areas.added) {
            message += `### Area (Added): ${area.name} (${area.id})\n`;
            message += "\n---\n";
        }
        for (const area of diff.areas.deleted) {
            message += `### Area (Deleted): ${area.name} (${area.id})\n`;
            message += "\n---\n";
        }
        for (const areaId in diff.areas.updated) {
            message += `### Area (Updated): ${areaId}\n`;
            message += formatDiff(diff.areas.updated[areaId]);
            message += "\n---\n";
        }

        // Map
        if (Object.keys(diff.map).length > 0) {
            message += `### Map properties (Updated)\n`;
            message += formatDiff(diff.map);
            message += "\n---\n";
        }

        const empty = message === "";
        if (empty) {
            message = "No diff.";
        }

        // Every part repeats the header, so each comment is still recognised as a
        // report and carries the commit it covers.
        const header = (part: number, total: number) =>
            "## Mudlet Map Diff\n" +
            `_Comparing \`${headSha.substring(0, 7)}\` against ${comparedAgainst}._` +
            (total > 1 ? ` _(part ${part} of ${total})_` : "") +
            "\n\n";

        const wrap = (body: string) =>
            collapseDiff && !empty
                ? `<details>\n<summary>Diff details</summary>\n\n${body}\n</details>`
                : body;

        const bodies = buildCommentBodies(message, header, wrap);
        message = header(1, 1) + wrap(message);

        if (summaryInput) {
            await core.summary.addRaw(message).write();
        }

        console.log("===== Diff stats =====");
        console.log(
            `Rooms - Changed: ${Object.keys(diff.rooms.updated).length}, Added: ${
                diff.rooms.added.length
            }, Deleted: ${diff.rooms.deleted.length}`
        );
        console.log(
            `Labels - Changed: ${Object.keys(diff.labels.updated).length}, Added: ${
                diff.labels.added.length
            }, Deleted: ${diff.labels.deleted.length}`
        );
        console.log(
            `Areas - Changed: ${Object.keys(diff.areas.updated).length}, Added: ${
                diff.areas.added.length
            }, Deleted: ${diff.areas.deleted.length}`
        );

        core.setOutput("diff", JSON.stringify(diff));
        core.setOutput("markdown", message);

        let cm: any[] = [];
        if (reuseComment) {
            cm = previousComments
                .filter((comment: any) => comment.user && comment.user.login === "github-actions[bot]")
                .sort((a: any, b: any) => a.id - b.id);
        }

        if (bodies.length > 1) {
            core.info(`Report is ${message.length} characters long, posting it as ${bodies.length} comments.`);
        }

        try {
            for (let index = 0; index < bodies.length; index++) {
                if (index < cm.length) {
                    await octokit.rest.issues.updateComment({
                        owner: owner,
                        repo: repository,
                        comment_id: cm[index].id,
                        body: bodies[index],
                    });
                } else {
                    await octokit.rest.issues.createComment({
                        owner: owner,
                        repo: repository,
                        issue_number: pull_request_number,
                        body: bodies[index],
                    });
                }
            }
            // A shorter report than the previous one would otherwise leave stale parts behind.
            for (const stale of cm.slice(bodies.length)) {
                await octokit.rest.issues.deleteComment({
                    owner: owner,
                    repo: repository,
                    comment_id: stale.id,
                });
            }
        } catch (e: any) {
            if (e.status === 403) {
                core.warning("Failed to create comment: Permission denied. If this is a pull request from a fork, consider using 'pull_request_target' or a PAT with 'repo' scope.");
            } else {
                throw e;
            }
        }
    } catch (error: any) {
        core.setFailed(error.message);
    }
}

run();

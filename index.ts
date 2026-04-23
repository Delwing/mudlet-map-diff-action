import * as core from "@actions/core";
import * as github from "@actions/github";
import {createDiff} from "mudlet-map-diff";
import cloudinaryUpload, {Diff} from "./cloudinary-upload.js";
import * as fs from "fs";
import * as path from "path";

async function run() {
    try {
        const context = github.context;

        if (context.payload.pull_request == null) {
            core.setFailed("No pull request found.");
            return;
        }

        const octokit = github.getOctokit('github-token', {
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

        const tempOldMap = path.join(process.cwd(), "old_map.dat");
        const tempNewMap = path.join(process.cwd(), "new_map.dat");

        await fetchFile(baseRepo, pullRequest.base.ref, oldMapPath, tempOldMap);
        await fetchFile(headRepo, pullRequest.head.ref, newMapPath, tempNewMap);

        console.log("Old map -> ", oldMapPath, " (saved to ", tempOldMap, ")", fs.statSync(tempOldMap).size);
        console.log("New map -> ", newMapPath, " (saved to ", tempNewMap, ")", fs.statSync(tempNewMap).size);

        console.log("Creating diff...");
        const diff: Diff = (await createDiff(tempOldMap, tempNewMap, {
            outDir: "diff",
            html: false,
        })) as unknown as Diff;
        let message = "";
        console.log("Diff created successfully");

        const pull_request_number = context.payload.pull_request.number;
        const repository = (context.payload.repository as any).name;
        const owner = (context.payload.repository as any).owner.login;

        const reuseComment = core.getInput("reuse-comment") === "true";
        const collapseDiff = core.getInput("collapse-diff") === "true";

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

        const formatDiff = (d: Record<string, { from: any; to: any }>) => {
            let res = "";
            for (const prop in d) {
                const {from, to} = d[prop];
                res += `- **${prop}**: \`${JSON.stringify(from)}\` -> \`${JSON.stringify(
                    to
                )}\` \n`;
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
            message += formatDiff(diff.rooms.updated[roomId]);
            if (images[roomId + "_updated"]) {
                message += `![${roomId}](${images[roomId + "_updated"]})\n`;
            }
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
            message += formatDiff(diff.labels.updated[compositeId]);
            if (images[areaId + "_" + labelId + "_updated_label"]) {
                message += `![${labelId}](${
                    images[areaId + "_" + labelId + "_updated_label"]
                })\n`;
            }
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

        if (message === "") {
            message = "No diff.";
        } else if (collapseDiff) {
            message = `<details>${message}</details>`;
        }

        message = "## Mudlet Map Diff\n" + message;

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
            const comments = await octokit.rest.issues.listComments({
                owner: owner,
                repo: repository,
                issue_number: pull_request_number,
            });
            cm = (comments.data as any[]).filter(
                (comment: any) =>
                    comment.user &&
                    comment.user.login === "github-actions[bot]" &&
                    comment.body &&
                    comment.body.includes("## Mudlet Map Diff")
            );
        }

        if (cm.length > 0) {
            await octokit.rest.issues.updateComment({
                owner: owner,
                repo: repository,
                comment_id: cm[0].id,
                body: message,
            });
        } else {
            try {
                await octokit.rest.issues.createComment({
                    owner: owner,
                    repo: repository,
                    issue_number: pull_request_number,
                    body: message,
                });
            } catch (e: any) {
                if (e.status === 403) {
                    core.warning("Failed to create comment: Permission denied. If this is a pull request from a fork, consider using 'pull_request_target' or a PAT with 'repo' scope.");
                } else {
                    throw e;
                }
            }
        }
    } catch (error: any) {
        core.setFailed(error.message);
    }
}

run();

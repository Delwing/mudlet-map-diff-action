const core = require('@actions/core');
const github = require('@actions/github');
const cloudinaryUpload = require("./cloudinary-upload")
const createDiff = require("mudlet-map-diff")

async function run() {
  try {

    const context = github.context;
    if (context.payload.pull_request == null) {
      core.setFailed('No pull request found.');
      return;
    }

    const oldMap = process.argv[2]
    const newMap = process.argv[3]
    const github_token = process.argv[4]
    const tmpDir = process.argv[5]

    console.log("Old map -> " , oldMap)
    console.log("New map -> " , newMap)
    console.log("Tmp dir -> " , tmpDir)

    let diff = await createDiff(tmpDir + "/" + oldMap, newMap, "diff", tmpDir)
    core.setOutput(JSON.stringify(diff))

    let message = ""
    
    const pull_request_number = context.payload.pull_request.number;
    const repository = context.payload.repository.name;
    const owner = context.payload.repository.owner.login;

    const reuseComment = process.env.REUSE_COMMENT === "true"
    const collapseDiff = process.env.COLLAPSE_DIFF === "true"

    const cloud_name = process.env.CLOUDINARY_NAME
    const cloud_key = process.env.CLOUDINARY_KEY
    const cloud_secret = process.env.CLOUDINARY_SECRET

    if (cloud_name && cloud_key && cloud_secret) {
        let images = await cloudinaryUpload(diff, `${owner}/${repository}`, pull_request_number, cloud_name, cloud_key, cloud_secret)
        for (const roomId in images) {
            if (Object.hasOwnProperty.call(images, roomId)) {
                const element = images[roomId];
                message += `### Room: ${roomId}\n`
                if (diff.changed[roomId]) {
                    message += `\`\`\`js\n${JSON.stringify(diff.changed[roomId][1], null, 4)}\n\`\`\`\n`
                    message += "\n=>\n"
                    message += `\`\`\`js\n${JSON.stringify(diff.changed[roomId][0], null, 4)}\n\`\`\`\n`
                }
                if (diff.added.indexOf(roomId) > -1) {
                    message += "Created\n"
                }
                if (diff.deleted.indexOf(roomId) > -1) {
                    message += "Deleted\n"
                }
                message += `![${roomId}](${element})\n`
                message += "\n---\n"
                
            }
        }
    } else {
        message += `Diff:\n\`\`\`js\n${JSON.stringify(diff, null, 4)}\n\`\`\`\n`
    }

    if (message === "") {
        message = "No diff."
    } else if(collapseDiff) {
        message = `<details>${message}</details>`;
    }

    message = "## Mudlet Map Diff\n" + message

    console.log("===== Diff stats =====")
    console.log(`Changed: ${Object.keys(diff.changed).length}`)
    console.log(`Added: ${diff.added.length}`)
    console.log(`Deleted: ${diff.deleted.length}`)

    const octokit = github.getOctokit(github_token, {
        userAgent: 'mudlet-map-diff-action',
      })
  
      let cm = [];
  
      if (reuseComment) {
          let comments = await octokit.rest.issues.listComments({
              owner: owner,
              repo: repository,
              issue_number: pull_request_number
          })
          cm = comments.data.filter(comment => comment.user && comment.user.login === 'github-actions[bot]' && comment.body && comment.body.includes("## Mudlet Map Diff"))
      }
  
      if (cm.length > 0) {
          octokit.rest.issues.updateComment({
            owner: owner,
            repo: repository,
            comment_id: cm[0].id,
            body: message
          });
      } else {
          octokit.rest.issues.createComment({
            owner: owner,
            repo: repository,
            issue_number: pull_request_number,
            body: message
          });
      }

    core.setOutput("diff", JSON.stringify(diff))

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
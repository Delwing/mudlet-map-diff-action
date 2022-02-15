# mudlet-map-diff-action

Github action that allows to compare two Mudlet binary file maps.
It is to be used in pull requests. It will generate comment containing diff for map. If provided with Cloudinary access, it will upload images and post them in comment as well.
So far it requires additional step - checkout base branch as well.

## Usage example

```yml
on: [pull_request_target]

jobs:
  map-diff:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v2
        with:
          ref: ${{github.event.pull_request.head.ref}}
          repository: ${{github.event.pull_request.head.repo.full_name}}
          fetch-depth: 0
      - name: Create DIFF
        id: diff
        uses: Delwing/mudlet-map-diff-action@v2
        with:
          old-map: map/map.dat
        env:
          CLOUDINARY_NAME: ${{ secrets.CLOUDINARY_NAME }}
          CLOUDINARY_KEY: ${{ secrets.CLOUDINARY_KEY }}
          CLOUDINARY_SECRET: ${{ secrets.CLOUDINARY_SECRET }}
```

## Action inputs:

| Name | Description | Default |
| --- | --- | --- |
| `token` | `GITHUB_TOKEN` or a `repo` scoped [PAT](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token). | `GITHUB_TOKEN` |
| `old-map` | Path to map file in repository. | |
| `new-map` | New map file path. Use if differs from `old-map` |  |
| `tmp-dir` | Temp directory to save files| `tmp` |
| `reuse-comment` | Whether to reuse initial comment. | `false` |
| `collapse-diff` | Whether to collapse diff | `false` |

## Screenshots

![Diff Example](screenshot1.png)

# The judge's job image: Node, sql.js and the shared runner - nothing else. Each submission runs
# in a fresh container from this image, started by the worker with no network, a read-only root,
# no capabilities and limits on memory, processes and time (codevscode/judge/sandbox.py).
#
# Build from codevscode/:  docker build -t codevscode-judge -f judge/Dockerfile .

FROM node:24-slim

WORKDIR /judge

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY runner ./runner
COPY tools/challenge.mjs ./tools/challenge.mjs
COPY judge/entry.mjs ./judge/entry.mjs

# The image's unprivileged user. The worker also passes --user, so this is the second lock.
USER node

ENTRYPOINT ["node", "--frozen-intrinsics", "--max-old-space-size=192", "--permission", "--allow-fs-read=/judge", "--allow-fs-read=/work", "--disable-warning=ExperimentalWarning", "/judge/judge/entry.mjs"]

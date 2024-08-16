FROM --platform=linux/amd64 node:20-alpine as builder
WORKDIR /app

# copy sources
COPY package.json tsconfig.json yarn.lock ./
COPY src/ src/

# build application
RUN yarn install --frozen-lockfile
RUN yarn run build

# prepare for production
RUN rm -R node_modules && \
    yarn config set nmMode hardlinks-local && \
    yarn install --production --frozen-lockfile

FROM --platform=linux/amd64 node:20-alpine as runner

WORKDIR /app

# copy over minimal fileset
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
COPY --from=builder /app/build ./build

CMD ["node", "build/index.js"]

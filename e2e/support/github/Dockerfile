# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first so Docker layer caching short-circuits it
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn/
RUN corepack enable && yarn install --immutable

COPY . .

# Build and pack this module
RUN yarn build
RUN yarn pack -o /app/_openmrs_esm_report_builder.tgz

# Assemble the SPA from the manifest's default module set plus this module.
# Do not run `openmrs build` afterwards: rebuilding the shell here decouples it
# from the manifest-pinned modules and breaks module federation.
RUN npm_config_legacy_peer_deps=true npm install -g openmrs@next
ARG CACHE_BUST
RUN npm_config_legacy_peer_deps=true openmrs assemble --manifest --mode config --config e2e/support/github/spa-assemble-config.json --target /app/spa

FROM openmrs/openmrs-reference-application-3-frontend:nightly

# Keep the image's default index.html (the startup script patches it with
# SPA_PATH/API_URL at runtime); overlay the freshly assembled import map and
# modules after dropping the precompressed variants that would shadow them.
RUN rm -f /usr/share/nginx/html/importmap.json.br /usr/share/nginx/html/importmap.json.gz \
    /usr/share/nginx/html/routes.registry.json.br /usr/share/nginx/html/routes.registry.json.gz

COPY --from=build /app/spa/ /usr/share/nginx/html/

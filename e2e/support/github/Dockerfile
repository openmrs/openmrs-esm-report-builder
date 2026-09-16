# syntax=docker/dockerfile:1
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first so Docker layer caching short-circuits it
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

COPY . .

# Build the module, pack it, and assemble the SPA (shell + this app)
RUN yarn build
RUN yarn pack -o /app/_openmrs_esm_report_builder.tgz
RUN yarn openmrs assemble --manifest --mode config --config e2e/support/github/spa-assemble-config.json --target /app/spa
RUN yarn openmrs build --target /app/spa

FROM openmrs/openmrs-reference-application-3-frontend:nightly

RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/spa/ /usr/share/nginx/html/

# OpenMRS ESM Report Builder

**Package:** `@openmrs/esm-report-builder` *(currently being prepared for `@openmrs/esm-report-builder` packaging)*  
**Platform:** OpenMRS 3 (O3) Microfrontend  
**Status:** Active Development

---

## 📚 Documentation

| Document | Description | Audience |
|----------|-------------|----------|
| **[User Manual](USER_MANUAL.md)** | Complete guide for end users on using the application | Implementers, Report Developers |
| **[Technical Documentation](DOCUMENTATION.md)** | Architecture, API, and integration details | Developers, Technical Staff |
| **[Quick Reference](QUICK_REFERENCE.md)** | Quick lookup for routes, endpoints, and common patterns | All Users |
| **[Backend Support](BACKEND_SUPPORT_ANALYSIS.md)** | Backend API dependencies and requirements | Developers |
| **[Endpoint Migration](ENDPOINT_MIGRATION_SUMMARY.md)** | API migration details and status | Developers |

---

## Overview

The **OpenMRS ESM Report Builder** is an OpenMRS 3 frontend microfrontend (ESM) for **designing, managing, and structuring health reports** used in national and facility-level reporting.

It provides a unified environment where implementers, analysts, and developers can:

- Create and manage reports
- Design report layouts and sections
- Define reusable indicator logic
- Build structured, disaggregation-aware report templates
- Manage shared reporting metadata and catalogues
- Preview and export machine-consumable report definitions

The Report Builder intentionally separates **report design**, **indicator logic**, and **template mapping**, enabling reuse, governance, and long-term maintainability of reporting artifacts.

This project focuses on **report design and management**, not report execution. It helps teams create a clear source of truth for reporting structures that can later be evaluated by backend services, data pipelines, or reporting engines.

---

## Vision

The goal of this project is to provide a modern, modular, and maintainable report-authoring experience for OpenMRS implementations such as UgandaEMR, while aligning the work for broader reuse in the OpenMRS ecosystem. The module is intended to make report definitions easier to create, review, reuse, govern, and eventually share across implementations.

---

## What This App Is (and Is Not)

### What it is
- A **report design and configuration tool**
- A **template and indicator authoring environment**
- A **source of truth** for report definitions
- A bridge between reporting logic and downstream evaluators/renderers
- A reusable reporting workspace for structured health reporting metadata

### What it is not
- Not a report executor
- Not a data visualization runtime by itself
- Not responsible for evaluating indicators or querying data directly
- Not a data warehouse or backend reporting engine

Execution is delegated to backend services and reporting pipelines.

---

## Core Capabilities

### 1. Landing Experience
The application includes a landing page that introduces the report builder workspace and acts as the entry point for users navigating the module inside OpenMRS 3.

### 2. Reports Management
- Create new reports
- List existing reports
- Open and edit reports
- Duplicate and export reports *(planned/partial workflow support)*
- Manage report metadata such as name, description, and status

Each report is intended to encapsulate:
- A report design
- A report template
- References to reusable indicator definitions

### 3. Report Design
Design the **human-readable structure** of a report.

Current and planned report design capabilities include:
- Pages and sections
- Narrative text
- Indicator tables
- Section configuration and previews
- Future chart and visual elements

### 4. Indicator Library and Builder
The indicators module is one of the most developed parts of the project and is centered around reusable reporting logic.

Current work includes:
- Base indicator creation
- Composite indicator creation
- Final indicator creation
- Indicator status display
- Disaggregation-aware configuration
- SQL preview support
- Diagnosis filter support
- Preview table support
- Reusable indicator definitions across reports

This design helps separate indicator logic from final report layout so that indicators can be reused across multiple reports.

### 5. Report Sections
The report sections area supports building the structural layout of reports independently from indicator logic.

Current work includes:
- Section creation
- Section preview
- Section utilities
- Section type handling

### 6. Administrative Configuration
The admin area supports shared configuration and reusable catalogues needed by the report builder.

Current work includes:
- Report library page
- Data themes management
- Report categories page
- Age categories page
- Age groups page

These shared resources help improve consistency and reduce repeated setup across reports.

### 7. Run Reports Area
A run reports page is included as part of the product structure and can support future integrations for execution, preview, orchestration, or report delivery workflows.

### 8. AI Assistance Foundation
The codebase already includes AI support components and service definitions, creating a foundation for guided authoring, assisted SQL generation, and smarter report-building workflows.

---

## Current Functional Routes

The current application structure includes the following main routes:

- `/` — landing page
- `/reports` — reports dashboard
- `/new` — create report
- `/edit/:reportId` — edit report
- `/indicators` — indicators workspace
- `/sections` — report sections workspace
- `/run` — run reports page
- `/admin` — admin home
- `/admin/report-categories` — report categories
- `/admin/age-categories` — age categories
- `/admin/age-groups` — age groups
- `/admin/report-library` — report library
- `/admin/themes` — data themes

---

## Technical Stack

This frontend is built with:

- **OpenMRS 3 Microfrontend architecture**
- **React**
- **TypeScript**
- **Carbon Design System**
- **Sass**
- **Jest** for testing
- **ESLint** for linting
- **Yarn** for package management

---

## Package and Build Details

The project is currently packaged as an OpenMRS ESM and produces a browser bundle under `dist/openmrs-esm-report-builder.js`.

Available scripts include:

- `yarn start` — start local development
- `yarn build` — production build
- `yarn analyze` — build analysis
- `yarn lint` — lint source code
- `yarn test` — run tests
- `yarn coverage` — run test coverage
- `yarn typescript` — run TypeScript checks
- `yarn verify` — run lint, tests, and type checks together

---

## Project Structure

A simplified view of the project organization:

```text
src/
├── components/
│   ├── admin/
│   ├── ai-support/
│   ├── app-shell/
│   ├── data-themes/
│   ├── indicators/
│   ├── landing/
│   ├── report/
│   ├── report-sections/
│   └── run-reports/
├── resources/
├── routes/
├── types/
├── utils/
├── config-schema.ts
├── index.ts
├── root.component.tsx
├── sample-template.ts
└── template-utils.ts
```

---

## Build and Run

### Prerequisites
- Node.js 18+
- Yarn 1.x or Corepack-enabled Yarn
- OpenMRS 3 backend

### Install
```bash
yarn install
```

### Run
```bash
yarn start --backend=http://localhost:9098
```

### Access
- `http://localhost:8080/openmrs/spa/report-builder`

### Build
```bash
yarn build
```

### Verify
```bash
yarn verify
```

---

## Integration in OpenMRS

This application is structured as an OpenMRS ESM and is intended to plug into an OpenMRS 3 shell. It defines a root lifecycle and extension entry points so it can integrate cleanly into the broader frontend platform.

---

## Current Scope and Boundaries

### What this project currently covers
- Report authoring and configuration
- Reusable indicator design
- Structural report composition
- Shared reporting catalogues and metadata
- A foundation for future AI-assisted authoring

### What remains outside this module
- Indicator evaluation
- Data retrieval and backend execution
- Report scheduling and orchestration engines
- Advanced chart rendering and analytics runtime

---

## Publishing Direction

This work began under the UgandaEMR scope and is being prepared for broader OpenMRS-aligned packaging. The current direction is to align the package and module pathing for publication under the `@openmrs` scope.

---

## CI/CD Direction

The project is being prepared with a GitHub Actions workflow to support:

- Build validation on push and pull request
- Verification using lint, tests, and TypeScript checks
- Prerelease publishing
- Release publishing to npm-compatible package scopes

---

## Roadmap

Planned and likely next steps include:

- Completing more report editor workflows
- Strengthening report library and migration flows
- Expanding data theme configuration
- Improving execution handoff to backend/reporting services
- Adding richer preview capabilities
- Strengthening AI-assisted authoring experiences
- Finalizing package publication under `@openmrs`
- Adding documentation for extension slots and backend API expectations

---

## Contribution Notes

When contributing:

1. Keep report structure, indicator logic, and shared catalogues cleanly separated.
2. Prefer reusable components and configuration-driven approaches.
3. Run `yarn verify` before submitting changes.
4. Keep alignment with OpenMRS 3 frontend conventions.
5. Document any new routes, admin pages, or API contracts.

---

## Maintainers
- Hexam Creation Consult

---

## License
Mozilla Public License 2.0 (MPL-2.0)

---

## Documentation

For detailed documentation, see:
- **[User Manual](USER_MANUAL.md)** - How to use the Report Builder
- **[Technical Documentation](DOCUMENTATION.md)** - Architecture and implementation details
- **[Quick Reference](QUICK_REFERENCE.md)** - Quick lookup for common tasks

## Acknowledgements

This work builds on the OpenMRS 3 microfrontend platform and reflects implementation needs around structured health reporting, indicator management, and reporting governance within UgandaEMR and the wider OpenMRS ecosystem.

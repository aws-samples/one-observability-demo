<!--
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0
-->
# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for the One
Observability Demo. An ADR captures a single significant decision: the context
that forced a choice, the decision taken, and the consequences that follow from
it. ADRs are immutable once accepted; a later decision that changes course gets
its own record and supersedes the earlier one.

## Convention

- One file per decision, named `NNNN-short-title.md` (zero-padded sequence).
- Each ADR carries a status: `Proposed`, `Accepted`, `Superseded by NNNN`, or
  `Deprecated`.
- Keep the record short and factual. Link to the code and docs it affects rather
  than restating them.

## Records

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-deployment-template-split-and-safer-teardown.md) | Deployment template split and safer teardown | Accepted |

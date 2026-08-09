# Security Policy

## Supported versions

Security fixes are applied to the latest released minor version.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for a vulnerability before a fix is available.

Include the affected version, a minimal reproduction, the expected impact, and any suggested mitigation. Reports should receive an initial response within seven days.

## Scope

`okf-ts` parses untrusted YAML and Markdown but does not execute computations, attesters, links, or referenced resources. The Node bundle loader does not follow symbolic links.
